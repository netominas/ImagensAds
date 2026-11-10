import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {placementGridPeriod,placementGrid} from '../apps/roi/placement-grid.mjs';
import {createROIAPI} from '../apps/roi/api.mjs';
import {createROIWarehouse,daysBetween,shiftDay} from '../apps/roi/warehouse.mjs';
import {createDeductionSettings,deductionDefaults} from '../apps/roi/deductions.mjs';
import {today} from '../apps/roi/fx.mjs';
const account='1234567890',campaign='11',site='example.com';
test('placement matrix has ten inclusive days with rollover and validates campaign/end',()=>{
 assert.deepEqual(placementGridPeriod({account,campaign,end:'2026-01-05'}),{account,campaign,start:'2025-12-27',end:'2026-01-05'});
 for(const body of [{account:'bad',campaign,end:today()},{account,campaign:'bad',end:today()},{account,campaign,end:'2026-02-30'},{account,campaign,end:shiftDay(today(),1)}])assert.throws(()=>placementGridPeriod(body));
});
test('matrix joins daily placements by canonical key, preserves zero/negative ROI and never fills missing days with zero',()=>{
 const range=placementGridPeriod({account,campaign,end:'2026-11-07'}),dates=daysBetween(range.start,range.end),base={key:'web:portal.com',placement:'portal.com',type:'WEBSITE',cost:10,revenue:20,profit:10,roi:1,comparable:true,status:'matched'};
 const days=dates.map((date,i)=>({date,report:{complete:i!==3,stale:i===4,rows:i===5?[]:[{...base,roi:i===0?0:i===1?-.5:1,profit:i===0?0:i===1?-5:10}],warnings:[]}}));
 days[2].report.rows[0]={...base,cost:0,profit:20,roi:null};days[6].report.rows[0]={...base,comparable:false,status:'cost_only',revenue:null,profit:null,roi:null};days[9].report.rows.push({...base,key:'web:late.com',placement:'late.com'});
 const result=placementGrid({...range,days}),row=result.rows.find(r=>r.key===base.key);
 assert.equal(result.rows.length,2);assert.equal(row.cells.length,10);assert.equal(row.cells[0].roi,0);assert.equal(row.cells[1].roi,-.5);assert.equal(row.cells[2].status,'zero_cost');assert.equal(row.cells[2].profit,20);assert.equal(row.cells[3].status,'missing');assert.equal(row.cells[3].profit,null);assert.equal(row.cells[4].status,'stale');assert.equal(row.cells[5].status,'no_activity');assert.equal(row.cells[6].status,'cost_only');assert.equal(row.cells[6].roi,null);assert.equal(result.missing,true);
});
test('placement grid API reads daily cache with network deductions and isolates campaign readers; ensure requires admin and origin',async()=>{
 const db=new DatabaseSync(':memory:'),api=createROIAPI({db},{google:{configured:()=>false,search:()=>{throw Error('GET must not call Ads');}},admanager:{},autoSync:false}),wh=createROIWarehouse(db),range=placementGridPeriod({account,campaign,end:today()}),dates=daysBetween(range.start,range.end),reader={role:'reader',grants:[{account,campaigns:[campaign]}]};
 const request=(path,body=null,origin='https://roi.test')=>new Request('https://roi.test/apps/roi/api'+path,{method:body?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 try{
  wh.putMeta('catalog',{accounts:[{id:account,status:'ENABLED'}],networks:[{id:'9'}]});db.prepare('INSERT OR REPLACE INTO roi_settings VALUES(1,?)').run(JSON.stringify({accounts:[account],networks:['9']}));
  createDeductionSettings(db).save({...deductionDefaults(),enabled:true,networks:{'9':5},tax_percent:6,tax_base:'revenue'},[{id:'9'}]);
  for(const [i,date] of dates.entries()){
   const cost={account,campaign,site,utm:campaign,campaign_type:'DEMAND_GEN',name:'Authorized',date,cost:10,currency:'BRL',timezone:'America/Sao_Paulo'},revenue={network:'9',campaign,site,utm:campaign,date,revenue:20,currency:'BRL',timezone:'America/Sao_Paulo',impressions:100};
   wh.saveSource('ads',account,date,date,[cost]);wh.saveSource('gam','9',date,date,[revenue]);
   db.prepare('INSERT INTO roi_placement_days VALUES(?,?,?,?,?,NULL,?)').run('ads',account+':'+campaign,date,JSON.stringify({type:'DEMAND_GEN',placements:[{...cost,placement:'portal.com',placement_key:'web:portal.com',type:'WEBSITE',clicks:2,impressions:100}],totals:[cost]}),new Date().toISOString(),new Date().toISOString());
   if(i!==0)db.prepare('INSERT INTO roi_placement_days VALUES(?,?,?,?,?,NULL,?)').run('gam','9',date,JSON.stringify({facts:[{...revenue,placement:'portal.com',placement_key:'web:portal.com'}, {...revenue,campaign:'12',placement:'PRIVATE_OTHER_CAMPAIGN.com',placement_key:'web:PRIVATE_OTHER_CAMPAIGN.com'}]}),new Date().toISOString(),new Date().toISOString());
  }
  const query='?'+new URLSearchParams({account,campaign,end:range.end});
  const response=await api(request('/placement-grid'+query),reader);assert.equal(response.status,200);const grid=await response.json();assert.equal(grid.rows.length,1);assert.equal(grid.dates.length,10);assert.equal(grid.rows[0].cells[0].roi,null);assert.equal(grid.rows[0].cells[0].status,'missing');assert.ok(Math.abs(grid.rows[0].cells[1].revenue-17.86)<1e-9);assert.ok(Math.abs(grid.rows[0].cells[1].profit-7.86)<1e-9);assert.equal(grid.deductions.enabled,true);assert.ok(!JSON.stringify(grid).includes('PRIVATE_OTHER_CAMPAIGN'));assert.equal(grid.deductions.networks,undefined);
  assert.equal((await api(request('/placement-grid?'+new URLSearchParams({account,campaign:'12',end:range.end})),reader)).status,403);
  assert.equal((await api(request('/placement-grid/ensure',{account,campaign,end:range.end}),reader)).status,403);assert.equal((await api(request('/placement-grid/ensure',{account,campaign,end:range.end},'https://evil.test'))).status,403);
  assert.equal((await api(request('/placement-grid?'+new URLSearchParams({account,campaign,end:'bad'})))).status,400);
  assert.equal(db.prepare('SELECT count(*) n FROM roi_placement_jobs').get().n,0);
 }finally{api.stopAuto();db.close();}
});
