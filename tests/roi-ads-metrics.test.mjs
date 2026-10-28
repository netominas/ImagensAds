import test from 'node:test';
import assert from 'node:assert/strict';
import {adsMetrics} from '../apps/roi/public/ads-metrics.js';
import {costFacts} from '../apps/roi/ads.mjs';
import {reconcile} from '../apps/roi/model.mjs';
import {dailyReport} from '../apps/roi/public/campaign-report.js';
const date='2026-10-24',fact=(m,currency='BRL')=>({date,currency,ads_metrics:m});

test('Ads CPC weights native CPC by clicks, converts daily currency and preserves unknown legacy data',()=>{
 const metric={interactions:100,conversions:0,conversion_rate:0,cost_per_conversion:0};
 const facts=[fact({...metric,clicks:10,average_cpc:2}),fact({...metric,clicks:30,average_cpc:1},'USD')];
 assert.equal(adsMetrics(facts,{[date]:{rate:5}}).ads_cpc,4.25);
 assert.equal(adsMetrics(facts).ads_cpc,null);
 assert.equal(adsMetrics([fact(metric)]).ads_cpc,null);
 assert.equal(adsMetrics([fact({...metric,clicks:0,average_cpc:0})]).ads_cpc,null);
 assert.equal(adsMetrics([fact({...metric,clicks:1,average_cpc:0})]).ads_cpc,0);
 const cost={...facts[0],account:'1',campaign:'2',name:'Campaign',site:'exemplo.com.br',utm:'x',timezone:'America/Sao_Paulo',cost:20};
 const row=reconcile([cost],[],{}).rows[0];assert.equal(row.ads_cpc,2);assert.equal(row.cost,20);
 assert.equal(dailyReport([row],{},date,date)[0].ads_cpc,2);
});

test('collection stores CPC micros and clicks without counting campaign and ad totals twice',async()=>{
 const google={search:async(id,q)=>{if(q.includes('FROM customer'))return [{customer:{currencyCode:'BRL',timeZone:'America/Sao_Paulo'}}];assert.match(q,/metrics.average_cpc/);assert.match(q,/metrics.clicks/);
 const metrics={costMicros:'10000000',clicks:'20',averageCpc:500000,interactions:'20',conversions:0};
 return q.includes('FROM ad_group_ad')?[{campaign:{id:'2'},segments:{date},metrics,adGroupAd:{ad:{finalUrls:['https://exemplo.com.br/?utm_campaign=x']}}}]:[{campaign:{id:'2',name:'Campaign'},segments:{date},metrics}];}};
 const facts=await costFacts(google,{id:'1234567890'},date,date);assert.equal(facts.length,1);assert.equal(facts[0].cost,10);assert.equal(facts[0].ads_metrics.clicks,20);assert.equal(facts[0].ads_metrics.average_cpc,.5);
});
test('Google Ads rates use native eligible interactions, fractional conversions and daily currency conversion',()=>{
 const facts=[fact({interactions:10,conversions:1.5,conversion_rate:.1,cost_per_conversion:2}),fact({interactions:90,conversions:.5,conversion_rate:.2,cost_per_conversion:4},'USD')];
 const result=adsMetrics(facts,{[date]:{rate:5}});assert.equal(result.conversion_rate,.19);assert.equal(result.cost_per_conversion,6.5);
 assert.equal(adsMetrics(facts,{}).cost_per_conversion,null);assert.equal(adsMetrics(facts,{}).conversion_rate,.19);
 assert.deepEqual(adsMetrics([]),{conversion_rate:null,cost_per_conversion:null,ads_cpc:null});assert.equal(adsMetrics([fact({interactions:3,conversions:0,conversion_rate:0,cost_per_conversion:0})]).cost_per_conversion,null);
 assert.equal(adsMetrics([facts[0],{date,currency:'BRL',ads_metrics:null}]).conversion_rate,null);
});
test('conversion metrics persist into campaign and daily ROI without affecting financial totals',()=>{
 const metric={interactions:40,conversions:2.5,conversion_rate:.05,cost_per_conversion:4},cost={...fact(metric),account:'1',campaign:'2',name:'Campaign',site:'exemplo.com.br',utm:'x',timezone:'America/Sao_Paulo',cost:10};
 const joined=reconcile([cost],[],{}),row=joined.rows[0];assert.equal(row.conversion_rate,.05);assert.equal(row.cost_per_conversion,4);assert.equal(row.cost,10);assert.equal(row.profit,null);
 const [daily]=dailyReport([row],{},date,date);assert.equal(daily.conversion_rate,.05);assert.equal(daily.cost_per_conversion,4);assert.equal(daily.cost,10);
});
test('zero-cost conversion days survive collection, and unreconciled breakdowns do not duplicate conversions',async()=>{
 let mismatch=false;
 const google={async search(id,q){if(q.includes('FROM customer'))return [{customer:{currencyCode:'BRL',timeZone:'America/Sao_Paulo'}}];assert.ok(q.includes('metrics.conversions_from_interactions_rate'));assert.ok(q.includes('metrics.cost_per_conversion'));
 const metrics={costMicros:'0',conversions:'0.5',interactions:'2',conversionsFromInteractionsRate:.25,costPerConversion:0};
 if(q.includes('FROM ad_group_ad'))return [{campaign:{id:'2'},segments:{date},metrics:{...metrics,conversions:mismatch?'0.1':'0.5'},adGroupAd:{ad:{finalUrls:['https://exemplo.com.br/?utm_campaign=x']}}}];
 return [{campaign:{id:'2',name:'Campaign',advertisingChannelType:'SEARCH'},segments:{date},metrics}];}};
 const facts=await costFacts(google,{id:'1234567890'},date,date);assert.equal(facts.length,1);assert.equal(facts[0].site,'exemplo.com.br');assert.equal(facts[0].ads_metrics.conversions,.5);assert.equal(facts[0].cost,0);
 mismatch=true;const uncertain=await costFacts(google,{id:'1234567890'},date,date);assert.equal(uncertain[0].site,'exemplo.com.br');assert.equal(uncertain[0].cost,0);assert.equal(uncertain[0].ads_metrics,null);
});
