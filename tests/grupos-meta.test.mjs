import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStorage} from '../lib/persistent.mjs';
import {createAppServer} from '../server.mjs';
import {hashPassword} from '../lib/auth.mjs';
import {createMeta} from '../apps/grupos/meta.mjs';

const TOKEN='EAAB-segredo-do-teste';

test('Meta client: needs token and account, reads pages, extracts Lead, caches, never leaks the token',async()=>{
 assert.equal(createMeta({}).configured,false);
 assert.equal(createMeta({META_ACCESS_TOKEN:TOKEN}).configured,false);
 assert.equal(createMeta({META_ACCESS_TOKEN:TOKEN,META_AD_ACCOUNT:'abc'}).configured,false);
 const calls=[];
 let mode='ok';
 const fetchImpl=async url=>{
  calls.push(url);
  const u=new URL(url);
  const reply=(body,status=200)=>({ok:status<400,status,json:async()=>body});
  if(mode==='limit')return reply({error:{code:17,message:`rate limit ${TOKEN}`}},400);
  if(mode==='down')throw new Error('rede '+TOKEN);
  if(u.pathname.endsWith('/campaigns'))return reply({data:[{id:'11',name:'Off-grid',effective_status:'ACTIVE'}]});
  if(!u.searchParams.get('after'))return reply({data:[{campaign_id:'11',campaign_name:'Off-grid',date_start:'2026-11-19',spend:'12.50',impressions:'900',actions:[{action_type:'link_click',value:'40'},{action_type:'lead',value:'7'}]}],paging:{cursors:{after:'P2'},next:'https://x/y?access_token='+TOKEN}});
  return reply({data:[{campaign_id:'11',campaign_name:'Off-grid',date_start:'2026-11-20',spend:'3',impressions:'100'}]});
 };
 let now=1000;
 const meta=createMeta({META_ACCESS_TOKEN:TOKEN,META_AD_ACCOUNT:'act_555555'},{fetchImpl,clock:()=>now});
 assert.equal(meta.configured,true);assert.equal(meta.account,'act_555555');
 assert.deepEqual(await meta.campaigns(),[{id:'11',name:'Off-grid',status:'ACTIVE'}]);
 const rows=await meta.insights('2026-11-19','2026-11-20');
 assert.deepEqual(rows,[{id:'11',name:'Off-grid',day:'2026-11-19',spend:12.5,impressions:900,leads:7},{id:'11',name:'Off-grid',day:'2026-11-20',spend:3,impressions:100,leads:0}]);
 const used=calls.length;
 await meta.insights('2026-11-19','2026-11-20');await meta.campaigns();
 assert.equal(calls.length,used,'second read comes from the cache');
 now+=30000;await meta.insights('2026-11-19','2026-11-20',{fresh:true});
 assert.equal(calls.length,used,'refresh is limited to once a minute');
 now+=61000;await meta.insights('2026-11-19','2026-11-20',{fresh:true});
 assert.equal(calls.length,used+2,'refresh after a minute asks Meta again');
 mode='limit';
 await assert.rejects(()=>meta.insights('2026-11-01','2026-11-02'),e=>e.status===429&&!e.message.includes(TOKEN));
 mode='down';
 await assert.rejects(()=>meta.insights('2026-11-03','2026-11-04'),e=>e.status===502&&!e.message.includes(TOKEN));
});

test('campaigns link to clusters and the report crosses Meta leads with real group joins',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'grupos-meta-'));
 const env={APP_ORIGIN:'https://workspace.example',ADMIN_EMAIL:'admin@example.com',ADMIN_PASSWORD_HASH:await hashPassword('grupos-test-password')};
 const storage=openStorage(dir,'c'.repeat(64));
 const rows=[];
 const day=d=>`2026-11-${String(d).padStart(2,'0')}`;
 for(const [d,spend,leads] of [[18,10,8],[19,20,16],[20,5,4]])rows.push({id:'111',name:'Off-grid A',day:day(d),spend,impressions:100,leads});
 rows.push({id:'222',name:'Off-grid B',day:day(19),spend:10,impressions:50,leads:4},{id:'333',name:'Outra',day:day(19),spend:7,impressions:50,leads:1});
 let configured=true;
 const meta={get configured(){return configured;},account:'act_1',
  campaigns:async()=>[{id:'111',name:'Off-grid A',status:'ACTIVE'},{id:'222',name:'Off-grid B',status:'PAUSED'},{id:'333',name:'Outra',status:'ACTIVE'}],
  insights:async(since,until)=>rows.filter(r=>r.day>=since&&r.day<=until)};
 const noMeta=createAppServer({env,storage,authStore:storage.store('auth'),googleAds:{configured:()=>false},roiOptions:{autoSync:false}});
 const server=createAppServer({env,storage,authStore:storage.store('auth'),googleAds:{configured:()=>false},roiOptions:{autoSync:false},meta});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 await new Promise(r=>noMeta.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port,baseOff='http://127.0.0.1:'+noMeta.address().port;
 let cookie;
 const send=(path,method='GET',body,root=base)=>fetch(root+path,{method,redirect:'manual',headers:{Origin:env.APP_ORIGIN,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const json=async(...args)=>(await send(...args)).json();
 const A='/apps/grupos/api/';
 const q='?days=3&date=2026-11-20';
 try{
  assert.equal((await send(A+'campaigns')).status,401);
  assert.equal((await send(A+'campaigns/111')).status,401);
  assert.equal((await send(A+'campaigns/111/cluster','POST',{cluster:null})).status,401);
  assert.equal((await send('/apps/grupos/campanhas')).headers.get('location'),'/login');
  assert.equal((await send('/apps/grupos/campanha')).headers.get('location'),'/login');
  for(const file of ['campanhas.js','campanha.js'])assert.equal((await send('/apps/grupos/'+file)).status,200,file);
  const login=await send('/api/login','POST',{email:env.ADMIN_EMAIL,password:'grupos-test-password'});
  cookie=login.headers.get('set-cookie').split(';')[0];
  for(const name of ['campanhas','campanha']){
   const page=await send('/apps/grupos/'+name);
   assert.equal(page.status,200,name);
   assert.match(await page.text(),/aria-current="page"><svg[^>]*>.*?<span>Campanhas/s);
   assert.equal((await send('/apps/grupos/'+name,'POST')).status,405);
  }
  for(const name of ['','grupo','numeros','agrupamentos','agrupamento'])assert.match(await (await send('/apps/grupos/'+name)).text(),/href="\/apps\/grupos\/campanhas"/,name+' menu');

  // sem configuração da Meta: lista vazia e vínculo recusado
  const off=await send(A+'campaigns'+q,'GET',undefined,baseOff);
  assert.equal(off.status,200);assert.equal((await off.json()).configured,false);

  // dados reais de grupos: g1 está em dois números (conta uma vez), g3 fica fora do agrupamento
  const db=storage.db;
  db.prepare("INSERT INTO wpp_accounts (name,created) VALUES ('Um',1),('Dois',1)").run();
  const group=db.prepare('INSERT INTO wpp_groups (account_id,id,name,size,is_admin,active,updated) VALUES (?,?,?,?,1,1,1)');
  group.run(1,'g1@g.us','Off-grid 1',100);group.run(2,'g1@g.us','Off-grid 1',50);group.run(1,'g2@g.us','Off-grid 2',30);group.run(1,'g3@g.us','Pesca',80);
  const event=db.prepare("INSERT INTO wpp_events (account_id,group_id,member_id,phone,kind,detail,source,ts,day) VALUES (?,?,'m','',?,'d','live',1,?)");
  const add=(account,g,kind,d,n)=>{for(let i=0;i<n;i++)event.run(account,g,kind,day(d));};
  add(1,'g1@g.us','join',19,3);add(2,'g1@g.us','join',19,3);add(1,'g2@g.us','join',19,2);add(1,'g2@g.us','leave',19,1);add(1,'g3@g.us','join',19,5);
  add(1,'g1@g.us','join',20,1);add(1,'g2@g.us','leave',20,1);

  const cluster=await json(A+'clusters','POST',{name:'Off-grid solar'});
  assert.equal((await json(A+`clusters/${cluster.id}/groups`,'POST',{add:['g1@g.us','g2@g.us']})).added,2);

  let list=await json(A+'campaigns'+q);
  assert.equal(list.configured,true);
  assert.deepEqual(list.campaigns.map(c=>c.id).sort(),['111','222','333']);
  const a=list.campaigns.find(c=>c.id==='111');
  assert.deepEqual([a.spend,a.leads,a.spendDay,a.leadsDay,a.cpl,a.clusterId],[35,28,5,4,1.25,null]);
  assert.equal(a.status,'ACTIVE');

  // vínculo: validações
  assert.equal((await send(A+'campaigns/abc/cluster','POST',{cluster:null})).status,404,'bad id never reaches the API');
  assert.equal((await send(A+'campaigns/111/cluster','POST',{cluster:999})).status,404,'unknown cluster');
  assert.equal((await send(A+'campaigns/999/cluster','POST',{cluster:cluster.id})).status,404,'unknown campaign');
  assert.equal((await send(A+'campaigns/111/cluster','POST',{cluster:'1'})).status,400);
  assert.equal((await send(A+'campaigns/111/cluster','POST',{})).status,400);

  // sem vínculo: só dados da Meta
  let report=await json(A+'campaigns/111'+q);
  assert.equal(report.cluster,null);assert.equal(report.totals.joined,0);assert.deepEqual(report.siblings,[]);
  assert.equal(report.totals.costPerJoin,null);assert.deepEqual(report.series.map(d=>d.day),[day(18),day(19),day(20)]);

  // com vínculo: entradas dos grupos (g1 uma vez só), custos e razão
  assert.deepEqual(await json(A+'campaigns/111/cluster','POST',{cluster:cluster.id}),{ok:true});
  report=await json(A+'campaigns/111'+q);
  assert.equal(report.cluster.id,cluster.id);assert.equal(report.groups,2);
  assert.deepEqual(report.series.map(d=>[d.joined,d.left,d.leads]),[[0,0,8],[5,1,16],[1,1,4]]);
  const t=report.totals;
  assert.deepEqual([t.spend,t.leads,t.joined,t.left,t.net,t.clusterSpend,t.clusterLeads],[35,28,6,2,4,35,28]);
  assert.equal(t.costPerJoin,35/6);assert.equal(t.costPerNet,35/4);assert.equal(t.joinsPerLead,6/28);
  assert.equal(report.siblings.length,1);

  // segunda campanha no mesmo agrupamento: custos usam a soma
  assert.deepEqual(await json(A+'campaigns/222/cluster','POST',{cluster:cluster.id}),{ok:true});
  report=await json(A+'campaigns/111'+q);
  assert.deepEqual([report.totals.spend,report.totals.clusterSpend,report.totals.clusterLeads,report.totals.leads],[35,45,32,28]);
  assert.equal(report.totals.costPerJoin,45/6);
  assert.equal(report.series[1].clusterLeads,20);
  assert.deepEqual(report.siblings.map(s=>s.id).sort(),['111','222']);
  const other=await json(A+'campaigns/333'+q);
  assert.equal(other.cluster,null,'campaign of another niche stays out');
  list=await json(A+'campaigns'+q);
  assert.deepEqual(list.campaigns.filter(c=>c.clusterId===cluster.id).map(c=>c.id).sort(),['111','222']);
  assert.equal(list.campaigns.find(c=>c.id==='111').clusterName,'Off-grid solar');
  assert.equal((await send(A+'campaigns/777'+q)).status,404);
  assert.equal((await send(A+'campaigns/111?days=0')).status,400);

  // a página do agrupamento mostra as campanhas ligadas
  const detail=await json(A+`clusters/${cluster.id}`+q);
  assert.deepEqual(detail.campaigns.map(c=>c.id).sort(),['111','222']);

  // soltar e excluir agrupamento
  assert.deepEqual(await json(A+'campaigns/222/cluster','POST',{cluster:null}),{ok:true});
  assert.equal((await json(A+'campaigns/111'+q)).siblings.length,1);
  assert.deepEqual(await json(A+`clusters/${cluster.id}`,'DELETE'),{ok:true});
  assert.equal(db.prepare('SELECT COUNT(*) n FROM wpp_campaign_links').get().n,0,'deleting a cluster drops its campaign links');
  assert.equal((await json(A+'campaigns/111'+q)).cluster,null);

  // a Meta fora do ar não derruba o resto do app
  configured=false;
  assert.equal((await send(A+'campaigns/111'+q)).status,409);
  assert.equal((await json(A+'campaigns'+q)).configured,false);
  assert.equal((await send(A+'summary')).status,200);
 }finally{
  for(const s of [server,noMeta])if(s.listening)await new Promise(r=>s.close(r));
  try{storage.close();}catch{}await rm(dir,{recursive:true,force:true}).catch(()=>{});
 }
});
