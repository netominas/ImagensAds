import test from 'node:test';
import assert from 'node:assert/strict';
import {gamMetrics} from '../apps/roi/public/gam-metrics.js';
import {dailyReport} from '../apps/roi/public/campaign-report.js';
import {revenueFacts,reconcile} from '../apps/roi/model.mjs';
const day='2026-10-24',rate={[day]:{rate:5}};
const fact=(extra={})=>({date:day,currency:'BRL',impressions:100,clicks:2,ecpm:10,cpc:.5,programmatic_responses:40,eligible_requests:50,...extra});
test('GAM monetary metrics decode micros once and preserve missing denominators',()=>{
 const r={'Dimension.DATE':day,'Dimension.DOMAIN':'exemplo.com.br','Dimension.CUSTOM_CRITERIA':'utm_campaign=abc','Column.AD_EXCHANGE_LINE_ITEM_LEVEL_REVENUE':'1000000','Column.AD_EXCHANGE_LINE_ITEM_LEVEL_IMPRESSIONS':'100','Column.AD_EXCHANGE_LINE_ITEM_LEVEL_CLICKS':'2','Column.AD_EXCHANGE_LINE_ITEM_LEVEL_AVERAGE_ECPM':'10000000','Column.AD_EXCHANGE_COST_PER_CLICK':'500000','Column.PROGRAMMATIC_RESPONSES_SERVED':'40','Column.TOTAL_PROGRAMMATIC_ELIGIBLE_AD_REQUESTS':'50'};
 const [parsed]=revenueFacts({mode:'CUSTOM_CRITERIA',rows:[r]},{id:'1',currency:'BRL'});assert.equal(parsed.ecpm,10);assert.equal(parsed.cpc,.5);assert.equal(parsed.clicks,2);assert.equal(parsed.eligible_requests,50);
 delete r['Column.AD_EXCHANGE_LINE_ITEM_LEVEL_CLICKS'];assert.equal(revenueFacts({mode:'CUSTOM_CRITERIA',rows:[r]},{id:'1'})[0].clicks,null);
});
test('GAM totals weight by impressions, clicks and programmatic requests across currencies',()=>{
 const rows=[fact(),fact({currency:'USD',impressions:900,clicks:8,ecpm:4,cpc:1,programmatic_responses:45,eligible_requests:450})];
 const metrics=gamMetrics(rows,rate);assert.equal(metrics.ecpm,19);assert.equal(metrics.cpc,4.1);assert.equal(metrics.pmr,.17);
 assert.deepEqual(gamMetrics([],rate),{ecpm:null,cpc:null,pmr:null});
 assert.equal(gamMetrics([fact({clicks:0})],rate).cpc,null);
 assert.equal(gamMetrics([fact({eligible_requests:null})],rate).pmr,null);
 assert.equal(gamMetrics([fact({currency:'USD'})],{}).ecpm,null);
 assert.equal(gamMetrics([fact({currency:'USD'})],{}).pmr,.8);
});
test('UTM joins retain metric bases for campaign, site and daily reports without changing ROI',()=>{
 const cost={account:'1',campaign:'2',name:'Campaign',site:'exemplo.com.br',utm:'abc',date:day,currency:'BRL',timezone:'America/Sao_Paulo',cost:2};
 const revenue={...fact(),revenue:1,network:'3',site:cost.site,utm:'abc',timezone:cost.timezone};
 const joined=reconcile([cost],[revenue],{}),row=joined.rows[0];assert.equal(row.gam_original.length,1);assert.equal(row.ecpm,10);assert.equal(row.cpc,.5);assert.equal(row.pmr,.8);assert.equal(row.profit,-1);assert.equal(joined.sites[0].pmr,.8);
 const daily=dailyReport([row],{},day,day);assert.equal(daily[0].ecpm,10);assert.equal(daily[0].cpc,.5);assert.equal(daily[0].pmr,.8);
 const ambiguous=reconcile([cost,{...cost,campaign:'9'}],[revenue],{});assert.equal(ambiguous.pending[0].cpc,.5);assert.ok(ambiguous.rows.every(r=>r.cpc===null&&r.profit===null));
 const legacy={...row};delete legacy.gam_original;assert.equal(dailyReport([legacy],{},day,day)[0].cpc,null);
});
