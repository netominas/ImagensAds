import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {openStorage} from '../lib/persistent.mjs';
import {createAppServer} from '../server.mjs';
import {hashPassword} from '../lib/auth.mjs';
import {createROIWarehouse} from '../apps/roi/warehouse.mjs';
import {today} from '../apps/roi/fx.mjs';

test('WhatsApp users see only their sites, retain independent grants, and lose access when revoked',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'whatsapp-access-'));
 const storage=openStorage(directory,'7'.repeat(64)),day=today();
 const env={ADMIN_EMAIL:'admin@example.test',ADMIN_PASSWORD_HASH:await hashPassword('whatsapp-admin-password')};
 const server=createAppServer({env,storage,authStore:storage.store('auth'),googleAds:{configured:()=>false},roiOptions:{autoSync:false}});
 const warehouse=createROIWarehouse(storage.db);
 warehouse.putMeta('catalog',{accounts:[],networks:[{id:'9',name:'SECRET NETWORK',currency:'BRL'}]});
 const fact=(site,revenue)=>({date:day,network:'9',site,utm:'grupocarros',traffic_source:'whats',campaign_detailed:true,currency:'BRL',revenue,impressions:20});
 warehouse.saveSource('gam-whatsapp','9',day,day,[fact('sitea.com.br',5),fact('secret.com.br',500)]);
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 let cookie='';
 const request=(path,body)=>fetch(base+path,{method:body?'POST':'GET',redirect:'manual',headers:{Cookie:cookie,Origin:base,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 const login=async(email,password)=>{
  const response=await request('/api/login',{email,password});
  if(response.ok)cookie=response.headers.get('set-cookie').split(';')[0];
  return response;
 };
 const path='/apps/roi/api/whatsapp?'+new URLSearchParams({start:day,end:day});
 let reader;
 try{
  assert.equal((await login(env.ADMIN_EMAIL,'whatsapp-admin-password')).status,200);
  const adminCookie=cookie;
  const input={name:'WhatsApp reader',email:'whatsapp@example.test',password:'whatsapp-reader-password',active:true,role:'reader',grants:[],whatsapp_sites:['sitea.com.br']};
  for(const sites of [null,['*'],['https://sitea.com.br'],['sitea.com.br','sitea.com.br']])
   assert.equal((await request('/api/users',{...input,whatsapp_sites:sites})).status,400);
  const created=await request('/api/users',input);
  assert.equal(created.status,200);reader=(await created.json()).user;
  const signedIn=await login(input.email,input.password);
  assert.equal((await signedIn.json()).home,'/apps/roi/whatsapp');
  const readerCookie=cookie;
  assert.equal((await request('/')).headers.get('location'),'/apps/roi/whatsapp');
  assert.equal((await request('/apps/roi/whatsapp')).status,200);
  const report=await (await request(path+'&site=secret.com.br&sites=secret.com.br')).json();
  assert.deepEqual(report.rows.map(row=>row.site),['sitea.com.br']);
  assert.equal(report.rows[0].revenue,5);
  assert.equal(report.readonly,true);
  assert.equal(report.job,null);
  assert.ok(!JSON.stringify(report).includes('secret.com.br'));
  assert.ok(!JSON.stringify(report).includes('SECRET NETWORK'));
  assert.equal((await request('/apps/roi/api/whatsapp/refresh',{start:day,end:day})).status,403);
  assert.equal((await request('/api/users')).status,403);

  cookie=adminCookie;
  const legacyEdit=await request('/api/users',{...input,whatsapp_sites:undefined,id:reader.id,revision:reader.revision,password:''});
  assert.equal(legacyEdit.status,200);
  reader=(await legacyEdit.json()).user;
  assert.deepEqual(reader.whatsapp_sites,['sitea.com.br']);
  cookie=readerCookie;
  assert.equal((await request(path)).status,401);

  cookie=adminCookie;
  const financeInput={...input,name:'Finance viewer',email:'finance-whatsapp@example.test',role:'finance-reader'};
  assert.equal((await request('/api/users',financeInput)).status,200);
  await login(financeInput.email,financeInput.password);
  assert.equal((await request('/apps/roi/whatsapp')).status,200);
  assert.equal((await request('/apps/roi/whatsapp.js')).status,200);
  assert.equal((await request(path)).status,200);
  assert.equal((await request('/apps/roi/api/whatsapp/refresh',{start:day,end:day})).status,403);
  assert.equal((await request('/apps/roi/api/push?start='+day+'&end='+day)).status,403);

  cookie=adminCookie;
  const revoked=await request('/api/users',{...input,id:reader.id,revision:reader.revision,password:'',whatsapp_sites:[]});
  assert.equal(revoked.status,200);
  await login(input.email,input.password);
  assert.equal((await request(path)).status,403);
  assert.equal((await request('/apps/roi/whatsapp')).status,403);
 }finally{
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));storage.close();
  assert.ok(resolve(directory).startsWith(resolve(tmpdir())+sep));
  await rm(directory,{recursive:true,force:true});
 }
});
