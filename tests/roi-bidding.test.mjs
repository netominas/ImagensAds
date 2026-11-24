import test from 'node:test';
import assert from 'node:assert/strict';
import {campaignBidding,cpaIndicator,latestCampaignBidding} from '../apps/roi/public/campaign-bidding.js';
import {costFacts} from '../apps/roi/ads.mjs';
import {reconcile} from '../apps/roi/model.mjs';
const checked='2026-11-24T12:00:00.000Z';
test('campaign detail displays the latest target value with CPA label and clears a removed target',()=>{
 const old={type:'TARGET_CPA',target_cpa:.35,currency:'BRL',checked_at:checked},current={...old,target_cpa:.5,checked_at:'2026-11-24T13:00:00Z'};
 for(const rows of [[{bidding:old},{bidding:current}],[{bidding:current},{bidding:old}]]){
  const html=cpaIndicator(latestCampaignBidding(rows),{valueOnly:true});assert.match(html,/>CPA: R\$.*0,50<\/span>/);assert.doesNotMatch(html,/>CPA</);
 }
 assert.equal(cpaIndicator(latestCampaignBidding([{bidding:old},{bidding:{...current,target_cpa:null}}]),{valueOnly:true}),'');assert.equal(cpaIndicator(latestCampaignBidding([]),{valueOnly:true}),'');
});
test('CPA indicator reads standard and portfolio targets and hides absent or unrelated targets',()=>{
 for(const type of ['MAXIMIZE_CONVERSIONS','TARGET_CPA'])for(const portfolio of [false,true]){
  const scheme=type==='MAXIMIZE_CONVERSIONS'?{maximizeConversions:{targetCpaMicros:'500000'}}:{targetCpa:{targetCpaMicros:'500000'}};
  const row={campaign:{biddingStrategyType:type,...(portfolio?{biddingStrategy:'customers/1/biddingStrategies/2'}:scheme)},...(portfolio?{accessibleBiddingStrategy:scheme}:{})};
  const b=campaignBidding(row,'BRL',checked);assert.equal(b.target_cpa,.5);assert.equal(b.portfolio,portfolio);assert.match(cpaIndicator(b),/CPA alvo: R\$.*0,50/);assert.match(cpaIndicator(b),/Consultado em/);
 }
 for(const row of [{campaign:{}},{campaign:{biddingStrategyType:'MAXIMIZE_CONVERSIONS'}},{campaign:{biddingStrategyType:'TARGET_ROAS',targetCpa:{targetCpaMicros:'1000000'}}},{campaign:{biddingStrategyType:'TARGET_CPA',biddingStrategy:'portfolio',targetCpa:{targetCpaMicros:'1000000'}}}])assert.equal(cpaIndicator(campaignBidding(row,'BRL',checked)),'');
 for(const target of [0,-1,NaN,Infinity,null])assert.equal(cpaIndicator({type:'TARGET_CPA',target_cpa:target,currency:'BRL',checked_at:checked}),'');
 assert.match(cpaIndicator({type:'TARGET_CPA',target_cpa:.001,currency:'USD',checked_at:checked}),/0,001/);
});
test('CPA is collected within existing queries, propagated to ROI and cleared by a newer no-target observation',async()=>{
 const calls=[],campaign={id:'42',name:'Example',advertisingChannelType:'DISPLAY',biddingStrategyType:'TARGET_CPA',targetCpa:{targetCpaMicros:'750000'}},metrics={costMicros:'1000000'},date='2026-11-24';
 const google={search:async(cid,q)=>{calls.push(q);if(q.includes('FROM customer'))return [{customer:{currencyCode:'BRL',timeZone:'America/Sao_Paulo'}}];if(q.includes('FROM campaign'))return [{campaign,segments:{date},metrics}];return [{campaign,segments:{date},metrics,adGroupAd:{ad:{finalUrls:['https://example.com/?utm_campaign=42']}}}];}};
 const facts=await costFacts(google,{id:'1234567890'},date,date);assert.equal(calls.length,3);assert.match(calls[1],/accessible_bidding_strategy.target_cpa.target_cpa_micros/);assert.equal(facts[0].bidding.target_cpa,.75);
 const row=reconcile(facts,[],{}).rows[0];assert.equal(row.bidding.target_cpa,.75);
 const next={...facts[0],bidding:{...facts[0].bidding,target_cpa:null,checked_at:'2099-01-01T00:00:00Z'}};
 for(const ordered of [[next,...facts],[...facts,next]])assert.equal(cpaIndicator(reconcile(ordered,[],{}).rows[0].bidding),'');
 assert.equal(reconcile([{...facts[0],bidding:undefined}],[],{}).rows[0].bidding,undefined);
});
