import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createROIAPI} from '../apps/roi/api.mjs';
import {daysBetween} from '../apps/roi/warehouse.mjs';
const account='1234567890',network='1234',origin='http://database.test',start='2026-10-23',end='2026-10-24';
test('changing cached periods never calls upstream APIs; missing periods import once and source failures preserve valid data',async()=>{
 const db=new DatabaseSync(':memory:');let calls=0,fail=false,income=15;const ranges=[];
 const google={configured:()=>true,accessible:async()=>{calls++;return {resourceNames:['customers/'+account]};},search:async()=>{calls++;return [{customer:{id:account,descriptiveName:'Account',manager:false,status:'ENABLED',currencyCode:'BRL',timeZone:'America/Sao_Paulo'}}];}};
 const gam={networks:async()=>{calls++;return [{id:network,name:'Network',currency:'BRL',timezone:'America/Sao_Paulo'}];},keys:async()=>{calls++;return [{id:'1',name:'utm_campaign',reportableType:'ON'}];},report:async(id,{start,end})=>{calls++;ranges.push(['gam',start,end]);return {mode:'CUSTOM_CRITERIA',key:'1',rows:daysBetween(start,end).map(date=>({'Dimension.DATE':date,'Dimension.DOMAIN':'exemplo.com.br','Dimension.CUSTOM_CRITERIA':'utm_campaign=u','Column.AD_EXCHANGE_LINE_ITEM_LEVEL_REVENUE':String(income*1e6),'Column.AD_EXCHANGE_LINE_ITEM_LEVEL_IMPRESSIONS':'100'}))};}};
 const api=createROIAPI({db},{google,admanager:gam,rates:async()=>{calls++;return {};},loadCosts:async(g,a,start,end)=>{calls++;ranges.push(['ads',start,end]);if(fail)throw Error('offline');return daysBetween(start,end).map(date=>({date,account,campaign:'1',name:'Campaign',site:'exemplo.com.br',utm:'u',currency:'BRL',timezone:'America/Sao_Paulo',cost:10}));}});
 const request=(path,body)=>api(new Request(origin+'/apps/roi/api'+path,{method:body?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}));
 const scope={start,end,accounts:[account],networks:[network]};
 async function collect(path,body){const r=await request(path,body);assert.equal(r.status,202);const {id}=await r.json();for(let i=0;i<100;i++){const run=await(await request('/run?id='+id)).json();if(run.status!=='running'){assert.equal(run.status,'done');await new Promise(setImmediate);return run;}await new Promise(r=>setTimeout(r,2));}throw Error('collection timed out');}
 try{
  const first=await collect('/sync',scope);assert.equal(first.result.totals.profit,10);const count=calls;
  for(const [a,b]of [[start,end],[start,start],[end,end]]){const r=await(await request('/report?'+new URLSearchParams({start:a,end:b}))).json();assert.equal(r.database,true);assert.equal(r.result.data_coverage.complete,true);assert.equal(r.result.totals.cost,a===b?10:20);}
  await request('/catalog');assert.equal(calls,count);assert.equal((await(await request('/ensure',scope)).json()).id,null);assert.equal(calls,count);
  fail=true;income=25;await collect('/sync',scope);const stale=await(await request('/report?'+new URLSearchParams({start,end}))).json();assert.equal(stale.result.rows[0].cost,20);assert.equal(stale.result.rows[0].revenue,50);assert.equal(stale.result.data_coverage.stale_days,2);assert.equal(stale.result.partial,false);
  assert.equal((await(await request('/run?id='+first.id)).json()).result.totals.profit,10);assert.equal(db.prepare('SELECT count(*) AS n FROM roi_daily_facts').get().n,4);
  fail=false;ranges.length=0;await collect('/ensure',{...scope,end:'2026-10-25'});assert.deepEqual(ranges.map(r=>r.slice(1)),[['2026-10-25','2026-10-25'],['2026-10-25','2026-10-25']]);const before=calls;await request('/report?start=2026-10-25&end=2026-10-25');assert.equal(calls,before);
 }finally{api.stopAuto();db.close();}
});
