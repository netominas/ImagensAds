import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {classifyPush,createPushReport} from '../apps/roi/push.mjs';
import {createROIWarehouse} from '../apps/roi/warehouse.mjs';
import {createROIAPI} from '../apps/roi/api.mjs';

test('Push uses the observed medium before the campaign name and normalizes provider aliases',()=>{
 assert.deepEqual(classifyPush('welc_alert_cidadeinternet_2'),{provider:'pushalert',type:'welcome',medium:null});
 assert.deepEqual(classifyPush('broad_news_cidadeinternet_3','ps_newst'),{provider:'pushnews',type:'broadcast',medium:'ps_newst'});
 assert.deepEqual(classifyPush('broad_alert_cidadeinternet_3','ps_aiweb'),{provider:'aiweb',type:'broadcast',medium:'ps_aiweb'});
 assert.equal(classifyPush('welc_alert_cidadeinternet_2','email'),null);
 assert.equal(classifyPush('organic_campaign'),null);
 assert.equal(classifyPush('broad_motorpress_73'),null);
 assert.equal(classifyPush('broad_motorpress_73','ps_aiweb').type,'broadcast');
 assert.equal(classifyPush('announcement','ps_another').type,'other');
});

test('Push reads historical GAM facts and replaces them with exact medium results without doubling revenue',async()=>{
 const db=new DatabaseSync(':memory:');
 try{
  const warehouse=createROIWarehouse(db),day='2026-11-13',scope={start:day,end:day};
  const network={id:'1234',name:'GAM',currency:'USD',timezone:'America/Sao_Paulo'},utm='welc_alert_cidadeinternet_1';
  warehouse.saveRates({[day]:{rate:5,quote_date:day}});
  warehouse.saveSource('gam',network.id,day,day,[{date:day,network:network.id,site:'cidadeinternet.com.br',utm,currency:'USD',revenue:10,impressions:100}]);
  let requests=0;
  const push=createPushReport(db,{warehouse,networks:()=>[network],deductions:{read:()=>({enabled:true,revenue_share_enabled:true,tax_enabled:true,tax_percent:5,tax_base:'revenue',networks:{'1234':20}})},
   admanager:{
    keys:async()=>[{id:'1',name:'utm_campaign',reportableType:'CUSTOM_DIMENSION'},{id:'2',name:'utm_medium',reportableType:'CUSTOM_DIMENSION'}],
    report:async(id,query)=>{
     requests++;assert.equal(id,'1234');assert.deepEqual(query.additionalKeys,['2']);
     return {mode:'CUSTOM_DIMENSION',key:'1',rows:[
      {'Dimension.DATE':day,'Dimension.DOMAIN':'www.cidadeinternet.com.br','Dimension.TOP_LEVEL_DIMENSION_KEY[1]_VALUE':utm,'Dimension.TOP_LEVEL_DIMENSION_KEY[2]_VALUE':'ps_aiweb','Column.AD_EXCHANGE_LINE_ITEM_LEVEL_REVENUE':'2000000','Column.AD_EXCHANGE_LINE_ITEM_LEVEL_IMPRESSIONS':'40'},
      {'Dimension.DATE':day,'Dimension.DOMAIN':'www.cidadeinternet.com.br','Dimension.TOP_LEVEL_DIMENSION_KEY[1]_VALUE':utm,'Dimension.TOP_LEVEL_DIMENSION_KEY[2]_VALUE':'email','Column.AD_EXCHANGE_LINE_ITEM_LEVEL_REVENUE':'8000000','Column.AD_EXCHANGE_LINE_ITEM_LEVEL_IMPRESSIONS':'60'}
     ]};
    }
   }});
  const initial=push.report(scope);
  assert.equal(initial.rows[0].gross,50);
  assert.equal(initial.rows[0].inferred,true);
  assert.equal(requests,0);
  assert.equal(push.refresh(scope).running,true);
  assert.throws(()=>push.refresh(scope),error=>error.status===409);
  await new Promise(resolve=>setImmediate(resolve));
  const updated=push.report(scope);
  assert.equal(updated.coverage[0].exactDays,1);
  assert.equal(updated.rows.length,1);
  assert.equal(updated.rows[0].provider,'aiweb');
  assert.deepEqual(updated.rows[0].mediums,['ps_aiweb']);
  assert.equal(updated.rows[0].gross,10);
  assert.equal(updated.rows[0].revenue,7.6);
  assert.equal(updated.rows[0].impressions,40);
  assert.equal(warehouse.read({...scope,accounts:[],networks:['1234']}).revenue_records,1);
 }finally{db.close();}
});

test('Push API is restricted to administrators',async()=>{
 const db=new DatabaseSync(':memory:');
 try{
  const api=createROIAPI({db},{google:{},admanager:{},autoSync:false});
  const url='https://roi.test/apps/roi/api/push?start=2026-11-13&end=2026-11-13';
  assert.equal((await api(new Request(url),{role:'reader',grants:[]})).status,403);
  assert.equal((await api(new Request(url),{role:'admin'})).status,200);
 }finally{db.close();}
});
