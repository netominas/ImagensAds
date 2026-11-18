import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createROIWarehouse} from '../apps/roi/warehouse.mjs';
import {createWhatsAppReport,whatsappFacts} from '../apps/roi/whatsapp.mjs';
import {createROIAPI} from '../apps/roi/api.mjs';

const day='2026-11-17',range={start:day,end:day};
const network={id:'1234',name:'Rede de teste',currency:'USD',timezone:'America/Sao_Paulo'};
const csv=(source='whats',campaign='grupoviagens',domain='sitea.com.br',revenue=2)=>({
 'Dimension.DATE':day,'Dimension.DOMAIN':domain,
 'Dimension.TOP_LEVEL_DIMENSION_KEY[1]_VALUE':campaign,'Dimension.TOP_LEVEL_DIMENSION_KEY[2]_VALUE':source,
 'Column.AD_EXCHANGE_LINE_ITEM_LEVEL_REVENUE':String(revenue*1e6),
 'Column.AD_EXCHANGE_LINE_ITEM_LEVEL_IMPRESSIONS':'100'
});
const queryReport=rows=>({key:'1',mode:'CUSTOM_DIMENSION',rows});
const dimensions=[{id:'1',name:'utm_campaign',reportableType:'CUSTOM_DIMENSION'},{id:'2',name:'utm_source',reportableType:'CUSTOM_DIMENSION'}];

test('WhatsApp attribution checks the source and preserves arbitrary campaigns and destination sites',()=>{
 const facts=whatsappFacts(queryReport([csv(),csv('email'),csv('whatsapp'),csv('whats','grupocarros','siteb.com.br'),csv('whats','','sitea.com.br')]),network,{sourceKey:'2',campaignKey:'1'});
 assert.equal(facts.length,3);
 assert.deepEqual(facts.map(fact=>[fact.site,fact.utm]),[['sitea.com.br','grupoviagens'],['siteb.com.br','grupocarros'],['sitea.com.br','(sem campanha)']]);
 assert.ok(facts.every(fact=>fact.campaign_detailed&&fact.traffic_source==='whats'));
 assert.throws(()=>whatsappFacts(queryReport([{}]),network,{sourceKey:'2',campaignKey:'1'}));
 const sourceOnly=whatsappFacts({mode:'CUSTOM_CRITERIA',key:'2',rows:[{...csv(),'Dimension.CUSTOM_CRITERIA':'utm_source=whats'}]},network,{sourceKey:'2'});
 assert.equal(sourceOnly[0].campaign_detailed,false);
 assert.equal(sourceOnly[0].utm,'');
 const currentColumns=queryReport([Object.fromEntries(Object.entries(csv()).map(([key,value])=>[key.replace('TOP_LEVEL_DIMENSION_KEY','TOP_LEVEL_CUSTOM_TARGETING_KEY'),value]))]);
 assert.equal(whatsappFacts(currentColumns,network,{sourceKey:'2',campaignKey:'1'})[0].utm,'grupoviagens');
 assert.equal(whatsappFacts({...currentColumns,key:'2'},network,{sourceKey:'2'})[0].campaign_detailed,false);
});

test('WhatsApp imports replace daily batches, retain successful data on failure, and apply each network discount',async()=>{
 const db=new DatabaseSync(':memory:');
 try{
  const warehouse=createROIWarehouse(db),second={...network,id:'5678',currency:'BRL'};
  warehouse.saveRates({[day]:{rate:5,quote_date:day}});
  let fail=false,calls=0;
  const deductions={enabled:true,revenue_share_enabled:true,tax_enabled:true,tax_percent:10,tax_base:'revenue',networks:{'1234':20,'5678':10}};
  const service=createWhatsAppReport(db,{warehouse,networks:()=>[network,second],deductions:{read:()=>deductions},
   admanager:{keys:async()=>dimensions,report:async(id,query)=>{
    calls++;assert.equal(query.key,'1');assert.deepEqual(query.additionalKeys,['2']);
    if(fail)throw Error('unavailable');
    return queryReport([csv(),csv('whats','grupoviagens','siteb.com.br',4),csv('email')]);
   }}});
  assert.deepEqual(service.report(range).rows,[]);
  assert.equal(calls,0);
  service.refresh(range);
  assert.throws(()=>service.refresh(range),error=>error.status===409);
  await new Promise(resolve=>setImmediate(resolve));
  let result=service.report(range);
  assert.equal(result.rows.length,2);
  assert.equal(result.rows.find(row=>row.site==='sitea.com.br').gross,12);
  assert.equal(result.rows.find(row=>row.site==='sitea.com.br').revenue,8.82);
  assert.ok(result.coverage.every(source=>source.days===1));
  const restricted=service.report(range,{sites:['sitea.com.br'],readonly:true});
  assert.equal(restricted.rows.length,1);
  assert.equal(restricted.rows[0].site,'sitea.com.br');
  assert.equal(restricted.job,null);
  assert.equal(restricted.coverage[0].name,'Ad Manager');
  assert.ok(!JSON.stringify(restricted).includes('Rede de teste'));
  assert.equal(service.report(range,{sites:[],readonly:true}).rows.length,0);
  service.refresh(range);await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(service.report(range).rows,result.rows);
  fail=true;service.refresh(range);await new Promise(resolve=>setImmediate(resolve));
  result=service.report(range);
  assert.equal(result.rows.length,2);
  assert.ok(result.coverage.every(source=>source.error));
  assert.equal(warehouse.read({...range,accounts:[],networks:[network.id]}).revenue_records,0);
 }finally{db.close();}
});

test('WhatsApp can import source-only revenue while marking campaign detail as unavailable',async()=>{
 const db=new DatabaseSync(':memory:');
 try{
  const warehouse=createROIWarehouse(db);
  const service=createWhatsAppReport(db,{warehouse,networks:()=>[{...network,currency:'BRL'}],deductions:{read:()=>({enabled:false})},
   admanager:{keys:async()=>[{id:'2',name:'utm_source',reportableType:'ON'}],report:async(id,query)=>{
    assert.equal(query.mode,'CUSTOM_CRITERIA');assert.equal(query.key,'2');
    return {mode:query.mode,key:query.key,rows:[{...csv(),'Dimension.CUSTOM_CRITERIA':'utm_source=whats'}]};
   }}});
  service.refresh(range);await new Promise(resolve=>setImmediate(resolve));
  const result=service.report(range);
  assert.equal(result.rows[0].detailed,false);
  assert.equal(result.rows[0].revenue,2);
 }finally{db.close();}
});

test('WhatsApp API enforces reader permissions, origin validation, and valid dates',async()=>{
 const db=new DatabaseSync(':memory:');
 try{
  const api=createROIAPI({db},{google:{},admanager:{},autoSync:false}),origin='https://roi.test';
  const request=(path,body,host=origin)=>new Request(origin+'/apps/roi/api'+path,{method:body?'POST':'GET',headers:{Origin:host,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  const url='/whatsapp?'+new URLSearchParams(range);
  assert.equal((await api(request(url),{role:'reader',grants:[]})).status,403);
  assert.equal((await api(request(url),{role:'admin'})).status,200);
  assert.equal((await api(request('/whatsapp/refresh',range,'https://other.test'),{role:'admin'})).status,403);
  assert.equal((await api(request('/whatsapp?start=invalid&end=invalid'),{role:'admin'})).status,400);
 }finally{db.close();}
});
