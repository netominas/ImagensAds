import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createROIWarehouse} from '../apps/roi/warehouse.mjs';
import {createROIScheduler} from '../apps/roi/scheduler.mjs';
import {dailyReport} from '../apps/roi/public/campaign-report.js';
const day='2026-10-24',account='1234567890',network='1234',scope={start:day,end:day,accounts:[account],networks:[network]};
const cost=(value=10)=>({date:day,account,campaign:'1',name:'Campaign',site:'exemplo.com.br',utm:'u',currency:'BRL',timezone:'America/Sao_Paulo',cost:value});
const revenue=(value=15)=>({date:day,network,site:'exemplo.com.br',utm:'u',currency:'BRL',timezone:'America/Sao_Paulo',revenue:value,impressions:100});
test('daily storage is idempotent, replaces successful zero-activity days and validates batches atomically',()=>{
 const db=new DatabaseSync(':memory:');try{const store=createROIWarehouse(db);for(let i=0;i<2;i++){store.saveSource('ads',account,day,day,[cost()]);store.saveSource('gam',network,day,day,[revenue()]);}
 assert.equal(store.read(scope).totals.profit,5);assert.equal(db.prepare('SELECT count(*) AS n FROM roi_daily_facts').get().n,2);
 assert.throws(()=>store.saveSource('ads',account,day,day,[{...cost(),account:'999'}]));assert.equal(store.read(scope).rows[0].cost,10);
 store.saveSource('ads',account,day,day,[]);assert.equal(store.read(scope).cost_records,0);assert.equal(store.read(scope).data_coverage.complete,true);
 }finally{db.close();}
});
test('failed source refresh preserves last valid facts and marks freshness without fabricating zeroes',()=>{
 const db=new DatabaseSync(':memory:');try{const store=createROIWarehouse(db);store.saveSource('ads',account,day,day,[cost()]);store.saveSource('gam',network,day,day,[revenue()]);store.failSource('ads',account,day,day,'API temporarily unavailable');
 const r=store.read(scope);assert.equal(r.rows[0].cost,10);assert.equal(r.rows[0].profit,5);assert.equal(r.partial,false);assert.equal(r.data_coverage.stale_days,1);assert.ok(r.warnings[0].includes('preservados'));
 const missing=store.read({...scope,end:'2026-10-25'});assert.equal(missing.partial,true);assert.equal(missing.data_coverage.missing_days,2);assert.equal(missing.rows[0].profit,null);
 const daily=dailyReport(missing.rows,missing.rates,day,'2026-10-25');assert.equal(daily[0].cost,10);assert.equal(daily[1].cost,null);assert.equal(daily[1].revenue,null);
 store.failSource('gam',network,'2026-10-25','2026-10-25','error');const plan=store.missingRanges({...scope,end:'2026-10-25'});assert.equal(plan.length,1);assert.equal(plan[0].kind,'ads');
 }finally{db.close();}
});
test('local queries isolate source and period and join multiple networks without duplicating ad cost',()=>{
 const db=new DatabaseSync(':memory:');try{const store=createROIWarehouse(db);store.saveSource('ads',account,day,day,[cost()]);store.saveSource('gam',network,day,day,[revenue()]);store.saveSource('gam','5678',day,day,[{...revenue(2),network:'5678',currency:'USD'}]);store.saveRates({[day]:{rate:5,quote_date:day}});
 assert.equal(store.read(scope).totals.revenue,15);const both=store.read({...scope,networks:[network,'5678']});assert.equal(both.totals.cost,10);assert.equal(both.totals.revenue,25);assert.equal(both.totals.profit,15);
 }finally{db.close();}
});
test('automatic collection runs every 30 minutes, revisits 30 days daily, and prevents overlapping work',async()=>{
 let time=Date.parse('2026-10-26T12:00:00Z'),state={},count=0,release;
 const scheduler=createROIScheduler({enabled:true,clock:()=>time,day:()=>new Date(time).toISOString().slice(0,10),read:()=>state,write:s=>state=s,isBusy:()=>false,run:async range=>{count++;assert.equal(range.start,count===1?'2026-09-27':'2026-10-20');if(count===1)await new Promise(r=>release=r);return {complete:true};}});
 const first=scheduler.tick();await Promise.resolve();await scheduler.tick();assert.equal(count,1);release();await first;time+=29*60000;await scheduler.tick();assert.equal(count,1);time+=60000;await scheduler.tick();assert.equal(count,2);assert.equal(scheduler.status().interval_minutes,30);scheduler.stop();
});
test('failed automatic collection retries with backoff and keeps the previous successful timestamp',async()=>{
 let time=Date.parse('2026-10-26T12:00:00Z'),state={last_success:'2026-10-25T12:00:00Z'},count=0;
 const scheduler=createROIScheduler({enabled:true,clock:()=>time,day:()=>day,read:()=>state,write:s=>state=s,isBusy:()=>false,run:async()=>{count++;throw Error('offline');}});await scheduler.tick();assert.equal(state.last_ok,false);assert.equal(state.last_success,'2026-10-25T12:00:00Z');time+=4*60000;await scheduler.tick();assert.equal(count,1);time+=60000;await scheduler.tick();assert.equal(count,2);scheduler.stop();
});
