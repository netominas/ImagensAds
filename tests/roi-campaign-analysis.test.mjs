import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createCampaignAnalysis} from '../apps/roi/campaign-analysis.mjs';
import {createROIAPI} from '../apps/roi/api.mjs';
const account='1234567890',campaign='11',other='9876543210';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture({generate=async()=>({text:'Resumo\nCampanha com receita estimada.'}),complete=true,stale=0,key='private-key',hour=12}={}){
 const db=new DatabaseSync(':memory:'),calls=[];let now=new Date(`2026-11-04T${String(hour+3).padStart(2,'0')}:00:00Z`);
 const storage={db,keys:async()=>({openai:key}),store:()=>({get:async()=>null})};
 const service=createCampaignAnalysis(storage,{catalog:async()=>({accounts:[{id:account}]}),scope:()=>({accounts:[account,other],networks:['9']}),day:()=>now.toISOString().slice(0,10),clock:()=>now,changes:()=>[{date:'2026-11-03',type:'budget_increase',description:'Ajuste de orçamento',source:'manual'},{date:'2020-01-01',description:'old'}],
 report:scope=>({data_coverage:{complete,stale_days:stale},sources:[{collected_at:now.toISOString()}],rates:{},rows:[{account,campaign,name:'Campanha alvo',campaign_type:'DISPLAY',site:'test.com',cost:10,revenue:20,comparable:complete,cost_original:[{date:scope.start,currency:'BRL',amount:10}],revenue_original:[{date:scope.start,currency:'BRL',amount:20}]},{account:other,campaign:'12',name:'SEGREDO OUTRA CONTA'}]}),generate:async input=>{calls.push(input);return generate(input);}});
 return {db,storage,service,calls,nextDay:()=>{now=new Date(+now+86400000);}};
}
test('analysis isolates the campaign, saves source data and output, deduplicates requests and persists across reopening',async()=>{
 const f=fixture();try{
  assert.equal((await f.service.list(account,campaign)).enabled,false);
  await f.service.launch(account,campaign);await f.service.launch(account,campaign);await flush();
  assert.equal(f.calls.length,1);const input=f.calls[0];assert.equal(input.apiKey,'private-key');assert.ok(!input.prompt.includes('SEGREDO OUTRA CONTA'));assert.match(input.prompt,/Ajuste de orçamento/);assert.ok(!input.prompt.includes('"description":"old"'));assert.equal((await f.service.list(account,campaign)).items[0].day,'2026-11-03');assert.match((await f.service.list(account,campaign)).items[0].text,/Resumo/);
  const saved=JSON.parse(f.db.prepare('SELECT input FROM roi_campaign_analyses').get().input);assert.equal(saved.days.length,8);assert.equal(saved.type,'Display');assert.equal(saved.days[7].metrics.roi,1);assert.ok(!JSON.stringify(await f.service.list(account,campaign)).includes('private-key'));
  await f.service.launch(account,campaign);await flush();assert.equal(f.calls.length,1);
  const reopened=createCampaignAnalysis(f.storage,{catalog:async()=>({accounts:[{id:account}]})});assert.equal((await reopened.list(account,campaign)).items.length,1);reopened.stop();
 }finally{f.service.stop();f.db.close();}
});
test('daily opt-in runs once after 8h, survives settings and advances to the next day',async()=>{
 const f=fixture();try{await f.service.tick();assert.equal(f.calls.length,0);await f.service.enable(account,campaign,true);await f.service.tick();await flush();assert.equal(f.calls.length,1);await f.service.tick();assert.equal(f.calls.length,1);f.nextDay();await f.service.tick();await flush();assert.equal(f.calls.length,2);await f.service.enable(account,campaign,false);f.nextDay();await f.service.tick();assert.equal(f.calls.length,2);}finally{f.service.stop();f.db.close();}
 const early=fixture({hour:7});try{await early.service.enable(account,campaign,true);await early.service.tick();assert.equal(early.calls.length,0);}finally{early.service.stop();early.db.close();}
});
test('missing, stale data and absent key never start paid generation',async()=>{
 for(const options of [{complete:false},{stale:1},{key:''}]){const f=fixture(options);try{await assert.rejects(f.service.launch(account,campaign));assert.equal(f.calls.length,0);assert.equal(f.db.prepare('SELECT count(*) n FROM roi_campaign_analyses').get().n,0);}finally{f.service.stop();f.db.close();}}
});
test('failure is sanitized and is not retried automatically; manual retry is explicit and interrupted work is not repeated',async()=>{
 const f=fixture({generate:async()=>{throw Error('private-key secret provider response');}});try{
  await f.service.enable(account,campaign,true);await f.service.tick();await flush();await f.service.tick();assert.equal(f.calls.length,1);assert.equal((await f.service.list(account,campaign)).items[0].status,'error');assert.ok(!JSON.stringify(await f.service.list(account,campaign)).includes('private-key'));
  await f.service.launch(account,campaign);await flush();assert.equal(f.calls.length,2);
  f.db.prepare("UPDATE roi_campaign_analyses SET status='running'").run();const reopened=createCampaignAnalysis(f.storage,{catalog:async()=>({accounts:[{id:account}]})});assert.equal((await reopened.list(account,campaign)).items[0].status,'error');reopened.stop();
 }finally{f.service.stop();f.db.close();}
});
test('concurrent clicks reserve one slot and do not send duplicate provider requests',async()=>{
 let release;const held=new Promise(resolve=>{release=resolve;}),f=fixture({generate:()=>held});try{await Promise.allSettled([f.service.launch(account,campaign),f.service.launch(account,campaign)]);assert.equal(f.calls.length,1);assert.equal(f.service.activeJobs(),1);release({text:'Concluído'});await flush();assert.equal(f.service.activeJobs(),0);}finally{f.service.stop();f.db.close();}
});
test('analysis APIs enforce reader campaign scope, deny writes and validate origin without exposing source inputs',async()=>{
 const db=new DatabaseSync(':memory:'),storage={db,keys:async()=>({}),store:()=>({get:async()=>null})},api=createROIAPI(storage,{google:{configured:()=>false},admanager:{},autoSync:false});
 const reader={role:'reader',grants:[{account,campaigns:[campaign]}]},root='https://roi.test/apps/roi/api/campaign-analysis';
 const req=(path='',method='GET',body=null,origin='https://roi.test')=>new Request(root+path,{method,headers:{Origin:origin,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 try{
  db.prepare('INSERT INTO roi_metadata VALUES (?,?,?)').run('catalog',JSON.stringify({accounts:[{id:account}],networks:[]}),new Date().toISOString());
  db.prepare("INSERT INTO roi_campaign_analyses VALUES (?,?,?,'done','openai','model','PRIVATE_INPUT','Resumo',NULL,NULL,?,?)").run(account,campaign,'2026-11-03',new Date().toISOString(),new Date().toISOString());
  const result=await api(req(`?account=${account}&campaign=${campaign}`),reader);assert.equal(result.status,200);assert.ok(!(await result.text()).includes('PRIVATE_INPUT'));
  assert.equal((await api(req(`?account=${account}&campaign=12`),reader)).status,403);
  assert.equal((await api(req('', 'POST',{account,campaign}),reader)).status,403);
  assert.equal((await api(req('/settings','POST',{account,campaign,enabled:true}),reader)).status,403);
  assert.equal((await api(req('', 'POST',{account,campaign},'https://evil.test'))).status,403);
  assert.equal((await api(req('?account=bad&campaign=11'))).status,400);
 }finally{api.stopAuto();db.close();}
});
