import test from 'node:test';
import assert from 'node:assert/strict';
import {costFacts} from '../apps/roi/ads.mjs';
import {reconcile} from '../apps/roi/model.mjs';
const date='2026-11-07',account={id:'1234567890'},site='exemplo.com.br';
function client({type='DISPLAY',urls=[['https://exemplo.com.br/a?utm_campaign=first'],['https://exemplo.com.br/b?utm_campaign=second']],detail=4,none=false,fail=false}={}){
 const campaign={id:'11',name:'Campaign',advertisingChannelType:type},metrics={costMicros:'10000000',clicks:'10',averageCpc:1000000,conversions:'2',interactions:'20',conversionsFromInteractionsRate:.1,costPerConversion:5000000};
 const unit=(urls,i,metric)=>({campaign,segments:{date},...(metric?{metrics:{...metrics,costMicros:String(detail*1e6),conversions:'1'}}:{}),...(type==='PERFORMANCE_MAX'?{assetGroup:{id:String(i),finalUrls:urls}}:{adGroupAd:{ad:{finalUrls:urls}}})});
 const calls=[];return {calls,search:async(cid,q)=>{
  calls.push(q);if(q.includes('FROM customer'))return [{customer:{currencyCode:'BRL',timeZone:'America/Sao_Paulo'}}];
  if(q.includes('FROM campaign'))return [{campaign,segments:{date},metrics}];
  if((q.includes('FROM asset_group'))!==(type==='PERFORMANCE_MAX'))return [];
  if(q.includes('segments.date'))return none?[]:[unit(urls[0],0,true)];
  if(fail)throw Error('metadata unavailable');return urls.map((u,i)=>unit(u,i,false));
 }};
}
test('single-domain fallback preserves authoritative campaign cost and metrics despite missing/different detail',async()=>{
 for(const type of ['DISPLAY','DEMAND_GEN','PERFORMANCE_MAX'])for(const none of [false,true]){
  const google=client({type,none}),facts=await costFacts(google,account,date,date);assert.equal(facts.length,1);const f=facts[0];assert.equal(f.site,site);assert.equal(f.cost,10);assert.equal(f.cost_source,'campaign');assert.equal(f.ads_metrics.conversions,2);assert.equal(f.ads_metrics.clicks,10);assert.equal(f.final_urls.length,2);assert.deepEqual(f.attribution_utms,['first','second']);
  const revenues=['first','second'].map(utm=>({network:'9',site,utm,date,currency:'BRL',timezone:'America/Sao_Paulo',revenue:12,impressions:100}));
  const result=reconcile(facts,revenues,{});assert.equal(result.rows.length,1);assert.equal(result.rows[0].cost,10);assert.equal(result.rows[0].revenue,24);assert.equal(result.rows[0].profit,14);assert.equal(result.rows[0].ads_cpc,1);
 }
});
test('missing URLs, multiple configured domains and metadata failure keep the full cost unassigned',async()=>{
 for(const options of [{urls:[['https://exemplo.com.br/a'],['https://outro.com.br/b']]},{urls:[['https://exemplo.com.br/a'],[]]},{urls:[['https://exemplo.com.br/a'],['javascript:alert(1)']]},{fail:true}]){
  const f=(await costFacts(client(options),account,date,date))[0];assert.equal(f.site,'');assert.equal(f.cost,10);assert.equal(f.ads_metrics.conversions,2);assert.equal(reconcile([f],[],{}).rows[0].profit,null);
 }
});
test('observed destinations also have to agree with the complete configuration, and calls are batched by account',async()=>{
 const google=client();const original=google.search;google.search=async(cid,q)=>{const rows=await original(cid,q);if(q.includes('FROM ad_group_ad')&&q.includes('segments.date'))rows[0].adGroupAd.ad.finalUrls=['https://different.com/path'];return rows;};
 const f=(await costFacts(google,account,date,date))[0];assert.equal(f.site,'');assert.equal(f.cost,10);assert.equal(google.calls.filter(q=>q.includes('FROM ad_group_ad')&&!q.includes('segments.date')).length,1);
});
test('same-site multiple URL/UTM variations are not mistaken for multiple sites when costs reconcile',async()=>{
 const google=client({detail:10,urls:[['https://exemplo.com.br/a?utm_campaign=first','https://www.exemplo.com.br/b?utm_campaign=second']]}),f=(await costFacts(google,account,date,date))[0];assert.equal(f.site,site);assert.equal(f.cost,10);assert.deepEqual(f.attribution_utms,['first','second']);assert.equal(google.calls.length,3);
});
