import test from 'node:test';
import assert from 'node:assert/strict';
import {placementKey,placementReport} from '../apps/roi/placement-model.mjs';
import {placementGrid} from '../apps/roi/placement-grid.mjs';
const account='1234567890',campaign='42',day='2026-11-25',scope={account,campaign,start:day,end:day};
const ads=(placement,cost)=>({account,campaign,date:day,placement,placement_key:'web:'+placement,type:'WEBSITE',currency:'BRL',timezone:'America/Sao_Paulo',cost,clicks:10,impressions:100});
const gam=(placement,revenue)=>({campaign,date:day,placement,placement_key:'web:'+placement,network:'1',site:'destination.com',currency:'BRL',timezone:'America/Sao_Paulo',revenue,impressions:1000});
test('placement grouping joins cached root costs to subdomain revenue once and keeps the daily grid consistent',()=>{
 const costs=[ads('kyanitez.com',16.74),ads('smartfashiontrend.com',11.05),ads('ads.smartfashiontrend.com/a',2)];
 const revenues=[gam('search.kyanitez.com',23.23),...['sft1','sft3','sft4'].map((sub,i)=>gam(sub+'.smartfashiontrend.com',[10.81,2.75,.59][i]))];
 const before=JSON.stringify({costs,revenues}),result=placementReport({...scope,ads:costs,revenues,complete:true});
 assert.equal(result.rows.length,2);const k=result.rows.find(r=>r.placement==='kyanitez.com'),s=result.rows.find(r=>r.placement==='smartfashiontrend.com');
 assert.equal(k.cost,16.74);assert.equal(k.revenue,23.23);assert.ok(Math.abs(k.profit-6.49)<1e-9);assert.equal(s.cost,13.05);assert.ok(Math.abs(s.revenue-14.15)<1e-9);assert.equal(s.clicks,20);assert.equal(s.impressions,200);assert.ok(Math.abs(result.coverage.detail_cost-29.79)<1e-9);assert.ok(Math.abs(result.coverage.tracked_revenue-37.38)<1e-9);assert.equal(JSON.stringify({costs,revenues}),before);
 const grid=placementGrid({...scope,days:[{date:day,report:result}]});assert.equal(grid.rows.length,2);assert.equal(grid.rows.find(r=>r.key===s.key).cells[0].revenue,s.revenue);
 assert.notEqual(placementKey('one.blogspot.com'),placementKey('two.blogspot.com'));assert.notEqual(placementKey('kyanitez.com','YOUTUBE_CHANNEL'),placementKey('kyanitez.com'));assert.equal(placementKey('https://sft1.smartfashiontrend.com/path?x=1'),'web:smartfashiontrend.com');
});
