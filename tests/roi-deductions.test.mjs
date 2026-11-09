import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {applyDeductions,deductionDefaults,createDeductionSettings} from '../apps/roi/deductions.mjs';
import {reconcile} from '../apps/roi/model.mjs';
import {dailyReport} from '../apps/roi/public/campaign-report.js';
import {placementReport} from '../apps/roi/placement-model.mjs';
import {createROIAPI} from '../apps/roi/api.mjs';
import {createROIWarehouse} from '../apps/roi/warehouse.mjs';
import {today} from '../apps/roi/fx.mjs';
const account='1234567890',campaign='11',site='example.com',date='2026-10-01';
const cost=(d=date,value=50)=>({account,campaign,name:'Campanha',site,utm:campaign,date:d,cost:value,currency:'BRL',timezone:'America/Sao_Paulo'});
const gam=(network='1',value=100,d=date,currency='BRL')=>({network,site,utm:campaign,date:d,revenue:value,currency,timezone:'America/Sao_Paulo',impressions:100,clicks:10});
const config=()=>({...deductionDefaults(),enabled:true,tax_percent:10,networks:{'1':20,'2':10}});
function raw(costs=[cost()],revenues=[gam()],rates={}){return {...reconcile(costs,revenues,rates),rates,warnings:[]};}
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);

test('share per network precedes daily positive profit tax, FX is applied per fact, and native metrics stay gross',()=>{
 const source=raw([cost()],[gam(),gam('2',10,date,'USD')],{[date]:{rate:5}}),before=structuredClone(source),result=applyDeductions(source,config()),r=result.rows[0];
 // Gross 150; share 20+5; profit before tax 75; tax 7.5.
 near(r.revenue,117.5);near(r.profit,67.5);near(r.roi,1.35);near(r.revenue_share,25);near(r.company_tax,7.5);near(r.gross_revenue,150);
 assert.equal(r.ecpm,source.rows[0].ecpm);assert.equal(r.cpc,source.rows[0].cpc);assert.deepEqual(source,before);
 near(dailyReport(result.rows,result.rates,date,date)[0].revenue,117.5);
 near(result.sites[0].profit,67.5);near(result.totals.profit,67.5);
 near(applyDeductions(result,config()).rows[0].revenue,117.5);
 const disabled=applyDeductions(result,{...config(),enabled:false});near(disabled.rows[0].revenue,150);assert.deepEqual(disabled.rows[0].revenue_original,source.rows[0].revenue_original);
});
test('periods add daily taxes, loss days have no profit tax, zero-cost and 100% share stay defined',()=>{
 const d2='2026-10-02',source=raw([cost(),cost(d2,100)],[gam(),gam('1',50,d2)]),r=applyDeductions(source,config()).rows[0];
 near(r.company_tax,3);near(r.profit,-33);const daily=dailyReport([r],{},date,d2);near(daily.reduce((s,d)=>s+d.profit,0),r.profit);near(daily[1].profit,-60);
 near(applyDeductions(raw([cost(date,0)]),config()).rows[0].company_tax,8);
 const full=applyDeductions(raw(),{...config(),networks:{'1':100}}).rows[0];near(full.revenue,0);near(full.profit,-50);near(full.company_tax,0);
 const revenueTax=applyDeductions(raw(),{...config(),tax_base:'revenue'}).rows[0];near(revenueTax.company_tax,8);near(revenueTax.profit,22);
});
test('unknown FX, legacy data and missing cost prevent fabricated net ROI',()=>{
 const legacy=raw();delete legacy.rows[0].gam_original;const r=applyDeductions(legacy,config()).rows[0];assert.equal(r.roi,null);assert.equal(r.deductions_pending,true);
 const missing=raw();missing.rows[0].missing_cost_days=[date];assert.equal(applyDeductions(missing,config()).rows[0].company_tax,0);assert.equal(applyDeductions(missing,config()).rows[0].revenue,null);
 const fx=applyDeductions(raw([cost()],[gam('2',10,date,'USD')]),config()).rows[0];assert.equal(fx.roi,null);assert.equal(fx.revenue,null);
});
test('placement tax is allocated from parent campaign day instead of taxing winning placements twice',()=>{
 const parent=applyDeductions(raw([cost(date,100)],[gam('1',200)]),config()).rows[0],base={revenue:200,deductions:config(),deduction_days:parent.deduction_days};
 const ads=['a.com','b.com'].map((p,i)=>({...cost(date,i?80:20),placement:p,placement_key:'web:'+p,type:'WEBSITE',clicks:1,impressions:100}));
 const revenues=['a.com','b.com'].map((p,i)=>({...gam('1',i?50:150),campaign,placement:p,placement_key:'web:'+p}));
 const report=placementReport({account,campaign,start:date,end:date,ads,revenues,totals:[cost(date,100)],complete:true,baseline:base});
 near(report.totals.revenue,parent.revenue);near(report.totals.profit,parent.profit);assert.ok(report.rows.every(r=>r.status==='matched'));near(report.rows.reduce((s,r)=>s+r.company_tax,0),parent.company_tax);
 const pending=placementReport({account,campaign,start:date,end:date,ads,revenues,complete:true,baseline:{...base,deduction_days:[]}});assert.equal(pending.rows[0].roi,null);assert.equal(pending.rows[0].status,'deductions_pending');
});
test('settings validate percentages/networks, persist audit, and reject concurrent overwrite',()=>{
 const db=new DatabaseSync(':memory:'),settings=createDeductionSettings(db),networks=[{id:'1'},{id:'2'}];
 try{assert.equal(settings.read().enabled,false);for(const invalid of [{tax_percent:-1},{tax_percent:101},{tax_percent:'10'},{enabled:1},{networks:{'9':20}},{tax_base:'invalid'}])assert.throws(()=>settings.save({...config(),...invalid},networks));
 const saved=settings.save(config(),networks,'admin@test');assert.equal(saved.revision,1);assert.deepEqual(settings.read(),saved);assert.throws(()=>settings.save(config(),networks),e=>e.status===409);assert.equal(db.prepare('SELECT count(*) n FROM roi_deduction_audit').get().n,1);
 }finally{db.close();}
});
test('API protects configuration; current reports, saved reports and grid use discounts without modifying stored facts',async()=>{
 const db=new DatabaseSync(':memory:'),api=createROIAPI({db},{google:{configured:()=>false},admanager:{},autoSync:false}),wh=createROIWarehouse(db),d=today(),reader={role:'reader',grants:[{account,campaigns:[campaign]}]};
 const request=(path,body=null,origin='https://roi.test')=>new Request('https://roi.test/apps/roi/api'+path,{method:body?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 try{wh.putMeta('catalog',{accounts:[{id:account,status:'ENABLED'}],networks:[{id:'1'},{id:'2'}]});db.prepare('INSERT OR REPLACE INTO roi_settings VALUES(1,?)').run(JSON.stringify({accounts:[account],networks:['1']}));wh.saveSource('ads',account,d,d,[cost(d)]);wh.saveSource('gam','1',d,d,[gam('1',100,d)]);
 const snapshot={...raw([cost(d)],[gam('1',100,d)]),start:d,end:d},rid='a'.repeat(32),scope={accounts:[account],networks:['1']};db.prepare('INSERT INTO roi_runs VALUES(?,?,?,?,?,?,?,?,?,?)').run(rid,'done',d,d,JSON.stringify(scope),JSON.stringify(snapshot),'done',null,d,d);
 assert.equal((await api(request('/deductions'),reader)).status,403);assert.equal((await api(request('/deductions',config()),reader)).status,403);assert.equal((await api(request('/deductions',config(),'https://evil.test'))).status,403);
 const save=await api(request('/deductions',config()),{email:'admin@test'});assert.equal(save.status,200);
 const query='?start='+d+'&end='+d;const run=await(await api(request('/report'+query))).json();near(run.result.rows[0].profit,27);assert.equal(run.result.deductions.enabled,true);
 const allowed=await(await api(request('/report'+query),reader)).json();near(allowed.result.rows[0].profit,27);assert.equal(allowed.result.deductions.networks,undefined);
 const saved=await(await api(request('/run?id='+rid))).json();near(saved.result.rows[0].profit,27);assert.equal(JSON.parse(db.prepare('SELECT result FROM roi_runs WHERE id=?').get(rid).result).rows[0].revenue,100);
 const grid=await(await api(request('/roi-grid?site='+site+'&end='+d))).json();near(grid.rows[0].cells.at(-1).profit,27);
 const c=await(await api(request('/deductions'))).json();await api(request('/deductions',{...c,enabled:false}));near((await(await api(request('/report'+query))).json()).result.rows[0].revenue,100);
 }finally{api.stopAuto();db.close();}
});
