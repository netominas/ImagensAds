import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {costFacts} from '../apps/roi/ads.mjs';
import {createROIWarehouse} from '../apps/roi/warehouse.mjs';
import {createBudgets} from '../apps/roi/budgets.mjs';
import {campaignTypeLabel} from '../apps/roi/public/campaign-report.js';

test('campaign types survive collection and daily storage without guessing from campaign names',async()=>{
 const date='2026-10-29',account='1234567890',db=new DatabaseSync(':memory:');
 const google={search:async(id,q)=>q.includes('FROM customer')?[{customer:{currencyCode:'BRL',timeZone:'America/Sao_Paulo'}}]:q.includes('FROM ad_group_ad')?[]:[{campaign:{id:'42',name:'Nome sem tipo',advertisingChannelType:'DEMAND_GEN'},segments:{date},metrics:{costMicros:'1000000'}}]};
 try{
  const facts=await costFacts(google,{id:account},date,date);assert.equal(facts[0].campaign_type,'DEMAND_GEN');
  const warehouse=createROIWarehouse(db);warehouse.saveSource('ads',account,date,date,facts);
  const report=warehouse.read({start:date,end:date,accounts:[account],networks:[]});assert.equal(report.rows[0].campaign_type,'DEMAND_GEN');assert.equal(report.rows[0].cost,1);
  for(const [type,label]of [['SEARCH','Pesquisa'],['PERFORMANCE_MAX','PMax'],['DISPLAY','Display'],['DEMAND_GEN','Geração de demanda'],['VIDEO','Vídeo']])assert.equal(campaignTypeLabel(type),label);
  assert.equal(campaignTypeLabel(null),'Não informado');assert.equal(campaignTypeLabel('FUTURE_CHANNEL'),'Não informado');
 }finally{db.close();}
});

test('legacy budget cache refreshes campaign type once and keeps types separate for shared budgets',async()=>{
 const db=new DatabaseSync(':memory:'),account='1234567890';let reads=0;
 const google={search:async()=>{reads++;return ['SEARCH','PERFORMANCE_MAX'].map((type,i)=>({campaign:{id:String(42+i),advertisingChannelType:type},customer:{currencyCode:'BRL'},campaignBudget:{resourceName:`customers/${account}/campaignBudgets/7`,period:'DAILY',amountMicros:'10000000',explicitlyShared:true}}));},mutate:()=>{throw Error('No writes allowed');}};
 try{
  const service=createBudgets(db,google,{accountFor:async id=>({id})});
  db.prepare('INSERT INTO roi_campaign_budgets VALUES (?,?,?,?)').run(account,'42',JSON.stringify({account,campaign:'42',micros:'10000000'}),new Date().toISOString());
  db.prepare('INSERT INTO roi_budget_catalog VALUES (?,?,NULL)').run(account,new Date().toISOString());
  const result=await service.listing([account]);assert.equal(reads,1);assert.deepEqual(result.items.map(r=>r.campaign_type),['SEARCH','PERFORMANCE_MAX']);
  await service.listing([account]);assert.equal(reads,1);assert.equal(db.prepare('SELECT count(*) n FROM roi_budget_operations').get().n,0);
 }finally{db.close();}
});
