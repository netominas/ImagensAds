import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {placementKey,contentFacts,placementReport} from '../apps/roi/placement-model.mjs';
import {createPlacements} from '../apps/roi/placements.mjs';
import {createROIWarehouse} from '../apps/roi/warehouse.mjs';
import {createROIAPI} from '../apps/roi/api.mjs';
import {today} from '../apps/roi/fx.mjs';
const account='9537482884',campaign='24148744957',day=today(),key=placementKey('portal.com'),network={id:'9',name:'Private network',currency:'BRL',timezone:'America/Sao_Paulo'};
const scope={account,campaign,start:day,end:day};
const ads=(patch={})=>({account,campaign,date:day,placement:'portal.com',placement_key:key,type:'WEBSITE',currency:'BRL',timezone:'America/Sao_Paulo',cost:10,impressions:100,clicks:10,ads_metrics:{clicks:10,average_cpc:1,interactions:10,conversions:2,conversion_rate:.2,cost_per_conversion:5},...patch});
const gam=(patch={})=>({campaign,date:day,network:'9',site:'destino.com.br',placement:'portal.com',placement_key:key,currency:'BRL',timezone:'America/Sao_Paulo',revenue:20,impressions:1000,clicks:100,ecpm:20,cpc:.2,programmatic_responses:800,eligible_requests:1000,...patch});
const csv=(patch={})=>({'Dimension.DATE':day,'Dimension.DOMAIN':'destino.com.br','Dimension.CUSTOM_CRITERIA':'utm_content='+campaign+'_portal.com','Column.AD_EXCHANGE_LINE_ITEM_LEVEL_REVENUE':'20000000','Column.AD_EXCHANGE_LINE_ITEM_LEVEL_IMPRESSIONS':'1000','Column.AD_EXCHANGE_LINE_ITEM_LEVEL_CLICKS':'100','Column.AD_EXCHANGE_LINE_ITEM_LEVEL_AVERAGE_ECPM':'20000000','Column.AD_EXCHANGE_COST_PER_CLICK':'200000','Column.PROGRAMMATIC_RESPONSES_SERVED':'800','Column.TOTAL_PROGRAMMATIC_ELIGIBLE_AD_REQUESTS':'1000',...patch});
test('content extraction splits only the campaign prefix, ignores other keys, preserves subdomains and exact paths',()=>{
 const f=contentFacts({mode:'CUSTOM_CRITERIA',rows:[csv(),csv({'Dimension.CUSTOM_CRITERIA':'utm_campaign='+campaign}),csv({'Dimension.CUSTOM_CRITERIA':'utm_content='+campaign+'_sub.portal.com/path_with_under'}),csv({'Dimension.CUSTOM_CRITERIA':'utm_content={campaignid}_{placement}'})]},network);
 assert.equal(f.length,2);assert.equal(f[0].revenue,20);assert.equal(f[1].placement,'sub.portal.com/path_with_under');assert.notEqual(placementKey('sub.portal.com'),key);assert.equal(placementKey('https://www.portal.com/'),key);assert.notEqual(placementKey('portal.com/a'),key);assert.equal(placementKey('Other'),null);assert.equal(placementKey('javascript:alert(1)'),null);
 const custom=contentFacts({mode:'CUSTOM_DIMENSION',key:'5',rows:[csv({'Dimension.TOP_LEVEL_DIMENSION_KEY[5]_VALUE':campaign+'_portal.com'})]},network);assert.equal(custom[0].placement,'portal.com');
});
test('placement ROI sums sources without multiplying cost, converts daily FX and keeps source metrics weighted',()=>{
 const result=placementReport({...scope,ads:[ads(),ads({account:'1111111111',cost:999})],revenues:[gam(),gam({network:'10',currency:'USD',revenue:2,ecpm:2,cpc:.02}),gam({campaign:'12',revenue:999})],totals:[ads({cost:12})],rates:{[day]:{rate:5}},complete:true});
 assert.equal(result.rows.length,1);assert.equal(result.rows[0].cost,10);assert.equal(result.rows[0].revenue,30);assert.equal(result.rows[0].profit,20);assert.equal(result.rows[0].roi,2);assert.equal(result.rows[0].ecpm,15);assert.equal(result.rows[0].pmr,.8);assert.equal(result.coverage.cost_difference,2);assert.equal(result.rows[0].ads_cpc,1);
});
test('unmatched, Other, missing FX, timezone, stale, incomplete and ambiguous records never invent profitability',()=>{
 const base={...scope,ads:[ads()],revenues:[gam()],totals:[ads()],complete:true};
 for(const patch of [{complete:false},{stale:true},{collision:true},{revenues:[gam({currency:'USD'})]},{revenues:[gam({timezone:'America/New_York'})]},{baseline:{revenue:10}}])assert.equal(placementReport({...base,...patch}).rows[0].profit,null);
 const r=placementReport({...base,ads:[ads({placement:'Other',placement_key:null}),ads({placement:'unmatched.com',placement_key:placementKey('unmatched.com')})]});assert.ok(r.rows.every(r=>r.profit===null));assert.equal(r.rows.find(r=>r.placement==='portal.com').cost,null);assert.equal(r.rows.find(r=>r.placement==='unmatched.com').revenue,null);
});
function fixture(type='DISPLAY'){
 const db=new DatabaseSync(':memory:'),warehouse=createROIWarehouse(db),calls=[],state={fail:false,type};
 const catalog=async()=>({accounts:[{id:account,mcc:'',status:'ENABLED'}],networks:[network]});
 const google={search:async(id,q)=>{calls.push(q);if(q.includes('FROM customer'))return [{customer:{currencyCode:'BRL',timeZone:'America/Sao_Paulo'}}];if(q.includes('FROM group_placement_view'))return [{campaign:{id:campaign},segments:{date:day},groupPlacementView:{placement:'portal.com',placementType:'WEBSITE'},metrics:{costMicros:'10000000',clicks:'10',impressions:'100',averageCpc:'1000000',conversions:'2',interactions:'10',conversionsFromInteractionsRate:.2,costPerConversion:'5000000'}}];if(!q.includes('segments.date'))return [{campaign:{id:campaign,name:'Target only',advertisingChannelType:state.type}}];return [{campaign:{id:campaign},segments:{date:day},metrics:{costMicros:'12000000',clicks:'10',impressions:'100'}}];}};
 const admanager={keys:async()=>[{id:'5',name:'utm_content',reportableType:'ON'}],report:async()=>{calls.push('gam');if(state.fail)throw Error('private-secret');return {mode:'CUSTOM_CRITERIA',rows:[csv(),csv({'Dimension.CUSTOM_CRITERIA':'utm_content=12_secret.com','Column.AD_EXCHANGE_LINE_ITEM_LEVEL_REVENUE':'999000000'})],report_id:'1'};}};
 const service=createPlacements(db,{google,admanager,catalog,settings:()=>({networks:['9']}),warehouse,loadRates:async()=>({}),baseline:()=>({revenue:20})});
 return {db,warehouse,calls,service,state,google,admanager};
}
async function done(f){for(let i=0;i<30;i++){const status=f.db.prepare('SELECT status FROM roi_placement_jobs ORDER BY created DESC LIMIT 1').get()?.status;if(status&&status!=='running')return;await new Promise(r=>setImmediate(r));}assert.fail('job did not complete');}
test('local cache persists daily data, GET never calls providers, missing data imports once and failures preserve facts',async()=>{
 const f=fixture();try{
  assert.equal((await f.service.read(scope)).rows.length,0);assert.equal(f.calls.length,0);await f.service.launch(scope);await done(f);let r=await f.service.read(scope);assert.equal(r.complete,true);assert.equal(r.rows.length,1);assert.equal(r.rows[0].profit,10);assert.ok(!JSON.stringify(r).includes('secret.com'));
  const n=f.calls.length;await f.service.read(scope);await f.service.launch(scope);assert.equal(f.calls.length,n);assert.equal(f.db.prepare('SELECT count(*) n FROM roi_placement_jobs').get().n,1);
  f.state.fail=true;await f.service.launch(scope,{force:true});await done(f);r=await f.service.read(scope);assert.equal(r.stale,true);assert.equal(r.rows[0].revenue,20);assert.equal(r.rows[0].profit,null);assert.ok(!JSON.stringify(r).includes('private-secret'));
 }finally{f.service.stop();f.db.close();}
});
test('readers get only authorized campaign placements and cannot launch collection; API rejects invalid IDs and origin',async()=>{
 const f=fixture(),api=createROIAPI({db:f.db},{google:f.google,admanager:f.admanager,autoSync:false}),reader={role:'reader',grants:[{account,campaigns:[campaign]}]},url='https://roi.test/apps/roi/api/placements';
 const req=(path='',body=null,origin='https://roi.test')=>new Request(url+path,{method:body?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 try{f.warehouse.putMeta('catalog',{accounts:[{id:account}],networks:[network]});f.db.prepare('INSERT OR REPLACE INTO roi_settings VALUES (1,?)').run(JSON.stringify({accounts:[account],networks:['9']}));await f.service.launch(scope);await done(f);
  const r=await api(req('?'+new URLSearchParams(scope)),reader);assert.equal(r.status,200);const result=await r.json();assert.equal(result.rows[0].placement,'portal.com');assert.ok(!JSON.stringify(result).includes('Private network'));assert.ok(!JSON.stringify(result).includes('secret.com'));
  assert.equal((await api(req('?'+new URLSearchParams({...scope,campaign:'12'})),reader)).status,403);assert.equal((await api(req('/refresh',scope),reader)).status,403);assert.equal((await api(req('/ensure',scope,'https://evil.test'))).status,403);assert.equal((await api(req('?'+new URLSearchParams({...scope,account:'bad'})))).status,400);
 }finally{api.stopAuto();f.service.stop();f.db.close();}
});

test('shared GAM cache is not exposed without Ads ownership and duplicate campaign IDs hide ambiguous reader revenue',async()=>{
 const f=fixture();try{await f.service.launch(scope);await done(f);assert.equal((await f.service.read({...scope,campaign:'12'},{reader:true})).rows.length,0);
 f.warehouse.saveSource('ads','1111111111',day,day,[{account:'1111111111',campaign,date:day,cost:1}]);const r=await f.service.read(scope,{reader:true});assert.ok(r.rows.every(row=>row.revenue===null&&row.profit===null));assert.ok(r.warnings.some(w=>w.includes('mais de uma conta')));
 }finally{f.service.stop();f.db.close();}
});

test('Demand Gen placements collect and reconcile with GAM while unsupported campaign types stay blocked',async()=>{
 const f=fixture('DEMAND_GEN');try{
  f.warehouse.saveSource('ads',account,day,day,[{account,campaign,campaign_type:'DEMAND_GEN',date:day,cost:12}]);
  await f.service.launch(scope);await done(f);const report=await f.service.read(scope);
  assert.equal(report.complete,true);assert.equal(report.rows[0].placement,'portal.com');assert.equal(report.rows[0].cost,10);assert.equal(report.rows[0].revenue,20);assert.equal(report.rows[0].profit,10);
  assert.equal(JSON.parse(f.db.prepare("SELECT data FROM roi_placement_days WHERE kind='ads'").get().data).type,'DEMAND_GEN');
  f.state.type='SEARCH';await f.service.launch(scope,{force:true});await done(f);const failed=await f.service.read(scope);assert.equal(failed.stale,true);assert.equal(failed.rows[0].profit,null);assert.ok(failed.sources.some(s=>s.error?.includes('Display e Geração de Demanda')));
 }finally{f.service.stop();f.db.close();}
 const unsupported=fixture('SEARCH');try{
  unsupported.warehouse.saveSource('ads',account,day,day,[{account,campaign,campaign_type:'SEARCH',date:day,cost:12}]);
  await assert.rejects(()=>unsupported.service.launch(scope),e=>e.status===400);assert.equal(unsupported.calls.length,0);
 }finally{unsupported.service.stop();unsupported.db.close();}
});
