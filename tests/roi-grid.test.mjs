import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {gridPeriod,roiGrid} from '../apps/roi/roi-grid.mjs';
import {createROIAPI} from '../apps/roi/api.mjs';
import {createROIWarehouse,daysBetween,shiftDay} from '../apps/roi/warehouse.mjs';
import {today} from '../apps/roi/fx.mjs';
const account='1234567890',other='9876543210',site='exemplo.com.br';
test('matrix period is ten inclusive calendar days, including month/year rollover and rejecting invalid/future scopes',()=>{
 assert.deepEqual(gridPeriod(site,'2026-01-05'),{site,start:'2025-12-27',end:'2026-01-05'});assert.throws(()=>gridPeriod('https://exemplo.com.br','2026-01-05'));assert.throws(()=>gridPeriod(site,'2026-02-30'));assert.throws(()=>gridPeriod(site,shiftDay(today(),1)));assert.throws(()=>gridPeriod('',today()));
});
test('matrix preserves zero ROI, flags missing/failed/unmatched days and includes campaigns active on any of the ten dates',()=>{
 const range=gridPeriod(site,'2026-11-07'),dates=daysBetween(range.start,range.end),row={account,campaign:'11',name:'Campanha',site,cost:10,revenue:20,profit:10,roi:1,comparable:true};
 const days=dates.map((date,i)=>({date,result:{rows:i===5?[]:[{...row,roi:i===0?0:i===1?-.5:1,profit:i===0?0:i===1?-5:10}],data_coverage:{complete:i!==2,stale_days:i===3?1:0}}}));days[4].result.rows[0].comparable=false;
 days[0].result.rows[0].final_urls=['https://exemplo.com.br/landing/','javascript:alert(1)'];days[1].result.rows[0].final_urls=['https://exemplo.com.br/landing/','https://exemplo.com.br/segunda/'];
 const grid=roiGrid({...range,days});assert.deepEqual(grid.rows[0].final_urls,['https://exemplo.com.br/landing/','https://exemplo.com.br/segunda/']);assert.equal(grid.dates.length,10);assert.equal(grid.rows.length,1);assert.equal(grid.rows[0].cells[0].roi,0);assert.equal(grid.rows[0].cells[1].roi,-.5);assert.equal(grid.rows[0].cells[2].status,'missing');assert.equal(grid.rows[0].cells[3].status,'stale');assert.equal(grid.rows[0].cells[4].status,'unlinked');assert.equal(grid.rows[0].cells[5].status,'no_activity');assert.equal(grid.rows[0].cells[6].roi,1);assert.ok(grid.rows[0].cells[2].roi===null);
});
test('grid API reconciles each day globally before applying site and campaign permissions; reads only stored facts',async()=>{
 const db=new DatabaseSync(':memory:'),api=createROIAPI({db},{google:{configured:()=>false},admanager:{},autoSync:false}),warehouse=createROIWarehouse(db),end=today(),range=gridPeriod(site,end),dates=daysBetween(range.start,end),url='https://roi.test/apps/roi/api/roi-grid';
 const reader={role:'reader',grants:[{account,campaigns:['11']}]},req=(query,body=null,origin='https://roi.test')=>new Request(url+(body?'/ensure':'?'+new URLSearchParams(query)),{method:body?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 const cost=(a,c,date,s=site,utm=c)=>({account:a,campaign:c,name:c==='12'?'PRIVATE_OTHER_CAMPAIGN':'Campaign '+c,site:s,utm,date,cost:10,currency:'BRL',timezone:'America/Sao_Paulo'}),revenue=(date,utm,s=site)=>({network:'9',site:s,utm,date,revenue:20,impressions:100,currency:'BRL',timezone:'America/Sao_Paulo'});
 try{
  warehouse.putMeta('catalog',{accounts:[{id:account},{id:other}],networks:[{id:'9'}]});db.prepare('INSERT OR REPLACE INTO roi_settings VALUES (1,?)').run(JSON.stringify({accounts:[account,other],networks:['9']}));
  for(const [i,date] of dates.entries()){
   warehouse.saveSource('ads',account,date,date,[cost(account,'11',date,site,i===0?'shared':'11'),cost(account,'13',date,'outro.com.br')]);warehouse.saveSource('ads',other,date,date,[cost(other,'12',date,site,i===0?'shared':'12')]);
   if(i<9)warehouse.saveSource('gam','9',date,date,[revenue(date,i===0?'shared':'11'),...(i===0?[]:[revenue(date,'12')]),revenue(date,'13','outro.com.br')]);
  }
  let response=await api(req({site,end}),reader);assert.equal(response.status,200);const grid=await response.json();assert.equal(grid.rows.length,1);assert.ok(!JSON.stringify(grid).includes('PRIVATE_OTHER_CAMPAIGN'));assert.equal(grid.rows[0].cells[0].status,'ambiguous');assert.equal(grid.rows[0].cells[1].roi,1);assert.equal(grid.rows[0].cells[9].status,'missing');assert.equal(grid.can_import,false);
  const admin=await(await api(req({site,end}))).json();assert.equal(admin.rows.length,2);assert.ok(admin.rows.every(r=>r.cells.length===10));assert.equal((await(await api(req({site:'outro.com.br',end}),reader)).json()).rows.length,0);
  assert.equal((await api(req({}, {site,end}),reader)).status,403);assert.equal((await api(req({}, {site,end},'https://evil.test'))).status,403);assert.equal((await api(req({site:'bad',end}))).status,400);
  assert.equal(db.prepare('SELECT count(*) n FROM roi_runs').get().n,0);
 }finally{api.stopAuto();db.close();}
});
