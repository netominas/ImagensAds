import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {openStorage} from '../lib/persistent.mjs';
import {createAppServer} from '../server.mjs';
import {hashPassword} from '../lib/auth.mjs';
import {createROIWarehouse} from '../apps/roi/warehouse.mjs';
import {canAccount,canCampaign} from '../lib/users.mjs';

test('read-only permissions distinguish entire accounts from explicit campaign IDs and deny missing scopes',()=>{
 const user={role:'reader',grants:[{account:'1234567890',campaigns:['11']},{account:'9876543210',campaigns:null}]};
 assert.equal(canCampaign(user,'1234567890','11'),true);assert.equal(canCampaign(user,'1234567890','12'),false);
 assert.equal(canCampaign(user,'9876543210','12'),true);assert.equal(canCampaign(user,'9876543210',undefined),false);
 assert.equal(canAccount(user,'1234567890'),true);assert.equal(canAccount(user,'1111111111'),false);assert.equal(canCampaign({role:'reader',grants:[]},'1234567890','11'),false);
});

test('users persist, isolate ROI including totals and exports, revoke sessions and cannot reach admin or mutation endpoints',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ak-users-')),storage=openStorage(dir,'8'.repeat(64)),account='1234567890',other='9876543210',date='2026-10-28';
 const env={ADMIN_EMAIL:'admin@example.test',ADMIN_PASSWORD_HASH:await hashPassword('admin-users-test-password')};let mutationCalls=0;
 const google={configured:()=>true,search:async(id,q)=>{
  if(q.includes('campaign_budget.amount_micros'))return ['11','12','13'].map(id=>({campaign:{id,advertisingChannelType:'SEARCH'},customer:{currencyCode:'BRL'},campaignBudget:{resourceName:`customers/${account}/campaignBudgets/7`,period:'DAILY',amountMicros:'10000000'}}));
  return [{campaign:{id:'11',name:'Campanha permitida',advertisingChannelType:'SEARCH',status:'ENABLED'}}];
 },mutate:()=>{mutationCalls++;throw Error('Must not mutate');}};
 const authStore=storage.store('auth'),server=createAppServer({env,storage,authStore,googleAds:google,roiOptions:{autoSync:false}}),warehouse=createROIWarehouse(storage.db);
 warehouse.putMeta('catalog',{accounts:[{id:account,name:'Conta permitida',status:'ENABLED'},{id:other,name:'SEGREDO-OUTRA-CONTA',status:'ENABLED'}],networks:[{id:'9',name:'SEGREDO-REDE'}],warnings:['SEGREDO-CATALOGO']});
 storage.db.prepare('INSERT INTO roi_settings VALUES (1,?)').run(JSON.stringify({accounts:[account,other],networks:['9']}));
 const cost=(account,campaign,name,utm,cost)=>({account,campaign,name,account_name:account===other?'SEGREDO-OUTRA-CONTA':'Conta permitida',site:'teste.com.br',utm,date,currency:'BRL',timezone:'America/Sao_Paulo',cost});
 warehouse.saveSource('ads',account,date,date,[cost(account,'11','Campanha permitida','ok',10),cost(account,'12','Ambiguidade permitida','shared',5),cost(account,'13','SEGREDO-CAMPANHA','shared',50)]);
 warehouse.saveSource('ads',other,date,date,[cost(other,'99','SEGREDO-OUTRA-CONTA','other',1000)]);
 warehouse.saveSource('gam','9',date,date,[{network:'9',site:'teste.com.br',utm:'ok',date,currency:'BRL',timezone:'America/Sao_Paulo',revenue:20,impressions:100},{network:'9',site:'teste.com.br',utm:'shared',date,currency:'BRL',timezone:'America/Sao_Paulo',revenue:100,impressions:100},{network:'9',site:'teste.com.br',utm:'other',date,currency:'BRL',timezone:'America/Sao_Paulo',revenue:9999,impressions:100}]);
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;let cookie='';
 const request=(path,body,method=body?'POST':'GET',origin=base)=>fetch(base+path,{method,redirect:'manual',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie},...(body?{body:JSON.stringify(body)}:{})});
 const signIn=async(email,password)=>{const r=await request('/api/login',{email,password});if(r.status===200)cookie=r.headers.get('set-cookie').split(';')[0];return r;};
 let user;
 try{
  assert.equal((await request('/usuarios')).status,303);assert.equal((await request('/api/users')).status,401);
  assert.equal((await signIn(env.ADMIN_EMAIL,'admin-users-test-password')).status,200);const adminCookie=cookie;
  assert.equal((await request('/usuarios')).status,200);
  const input={name:'Leitor',email:'reader@example.test',password:'reader-users-test-password',active:true,grants:[{account,campaigns:['11','12']}]};
  assert.equal((await request('/api/users',input,'POST','https://evil.example')).status,403);
  const created=await request('/api/users',input);assert.equal(created.status,200);user=(await created.json()).user;assert.equal(user.password_hash,undefined);assert.equal(user.password,undefined);
  assert.equal((await request('/api/users',{...input,email:'other@example.test',grants:[{account:'1111111111',campaigns:null}]})).status,400);
  const raw=storage.db.prepare('SELECT password_hash FROM workspace_users WHERE id=?').get(user.id);assert.match(raw.password_hash,/^scrypt-v1\$/);assert.ok(!raw.password_hash.includes(input.password));
  const readerLogin=await signIn(input.email,input.password);assert.equal((await readerLogin.json()).home,'/apps/roi/');const readerCookie=cookie;
  assert.equal((await request('/')).headers.get('location'),'/apps/roi/');assert.equal((await request('/apps/roi/?account='+account+'&campaign=11')).status,200);
  assert.equal((await request('/apps/roi/?account='+account+'&campaign=13')).status,403);
  for(const path of ['/usuarios','/api/users','/api/users/catalog','/api/users/campaigns?account='+account,'/apps/criativos/','/apps/google-ads/','/apps/google-ads/criar','/apps/roi/pagamentos','/apps/roi/redes','/apps/roi/vinculos','/api/data/settings','/apps/criativos/api/data/keys','/.netlify/functions/job?token=x'])assert.equal((await request(path)).status,403,path);
  const catalog=await (await request('/apps/roi/api/catalog')).json();assert.deepEqual(catalog.accounts.map(a=>a.id),[account]);assert.deepEqual(catalog.networks,[]);assert.deepEqual(catalog.links,[]);
  const reportPath=`/apps/roi/api/report?start=${date}&end=${date}&accounts=${account}&networks=`;
  const report=await(await request(reportPath)).json(),serialized=JSON.stringify(report);
  assert.ok(!serialized.includes('SEGREDO'));assert.deepEqual(report.result.rows.map(r=>r.campaign),['11','12']);assert.equal(report.result.rows[1].ambiguous,true);assert.equal(report.result.rows[1].revenue,null);
  assert.equal(report.result.totals.cost,10);assert.equal(report.result.totals.revenue,20);assert.equal(report.result.totals.profit,10);assert.equal(report.result.sites[0].campaigns,2);assert.deepEqual(report.result.pending,[]);
  assert.equal((await request(reportPath+'&campaign=13&account='+account)).status,403);assert.equal((await request(reportPath.replace(account,other))).status,403);
  const budgets=await(await request('/apps/roi/api/campaign-budgets?accounts='+account)).json();assert.deepEqual(budgets.items.map(r=>r.campaign),['11','12']);assert.equal(budgets.items[0].resource,undefined);
  for(const path of ['/apps/roi/api/run?id='+'a'.repeat(32),'/apps/roi/api/budget?account='+account+'&campaign=13','/apps/roi/api/budget-operation?id='+'a'.repeat(32),'/apps/roi/api/payments','/apps/roi/api/campaign-changes?account='+account+'&campaign=13'])assert.equal((await request(path)).status,403,path);
  for(const path of ['/apps/roi/api/budget-preview','/apps/roi/api/budget-apply','/apps/roi/api/campaign-changes','/apps/roi/api/sync','/apps/roi/api/ensure','/apps/roi/api/settings','/apps/roi/api/links','/apps/roi/api/payments/refresh','/apps/google-ads/api/drafts/new','/.netlify/functions/generate-background'])assert.equal((await request(path,{account,campaign:'11'})).status,403,path);
  assert.equal((await(await request('/apps/roi/api/history')).json()).runs.length,0);assert.equal((await(await request('/apps/roi/api/status')).json()).running,null);assert.equal(mutationCalls,0);
  cookie=adminCookie;const updated=await request('/api/users',{...input,id:user.id,revision:user.revision,password:'',grants:[{account,campaigns:null}]});assert.equal(updated.status,200);user=(await updated.json()).user;
  cookie=readerCookie;assert.equal((await request('/apps/roi/api/catalog')).status,401);
  await signIn(input.email,input.password);const full=await(await request(reportPath)).json();assert.equal(full.result.rows.length,3);assert.ok(JSON.stringify(full).includes('SEGREDO-CAMPANHA'));assert.ok(!JSON.stringify(full).includes('SEGREDO-OUTRA-CONTA'));
  cookie=adminCookie;const reset=await request('/api/users',{...input,id:user.id,revision:user.revision,password:'reader-replacement-password',grants:[]});assert.equal(reset.status,200);user=(await reset.json()).user;
  assert.equal((await signIn(input.email,input.password)).status,401);assert.equal((await signIn(input.email,'reader-replacement-password')).status,200);
  const empty=await(await request('/apps/roi/api/report?start='+date+'&end='+date)).json();assert.equal(empty.result.rows.length,0);assert.equal(empty.result.sites.length,0);assert.equal(empty.result.totals.revenue,0);assert.equal(JSON.stringify(empty).includes('SEGREDO'),false);
  const activeCookie=cookie;cookie=adminCookie;const blocked=await request('/api/users',{...input,id:user.id,revision:user.revision,password:'',active:false,grants:user.grants});assert.equal(blocked.status,200);
  assert.equal((await request('/api/users',{...input,id:user.id,revision:user.revision,password:''})).status,409);
  cookie=activeCookie;assert.equal((await request('/apps/roi/api/report?start='+date+'&end='+date)).status,401);assert.equal((await signIn(input.email,'reader-replacement-password')).status,401);
  assert.equal(storage.db.prepare('SELECT count(*) n FROM workspace_user_audit').get().n,4);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));storage.close();}
 try{const reopened=openStorage(dir,'8'.repeat(64));assert.equal(reopened.db.prepare('SELECT active FROM workspace_users WHERE id=?').get(user.id).active,0);reopened.close();}finally{assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));await rm(dir,{recursive:true,force:true});}
});
