import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {AdsError} from '../apps/google-ads/client.mjs';
import {createCampaignChanges} from '../apps/roi/campaign-changes.mjs';
import {budgetAmount,createBudgets} from '../apps/roi/budgets.mjs';
const account='1234567890',campaign='42',resource=`customers/${account}/campaignBudgets/7`;
function fixture({shared=false,period='DAILY'}={}){
 const db=new DatabaseSync(':memory:'),notes=createCampaignChanges(db);let micros='100000000',members=shared?[{id:campaign,name:'Principal',status:'ENABLED'},{id:'43',name:'Outra',status:'PAUSED'}]:[{id:campaign,name:'Principal',status:'ENABLED'}],sendError=null,delay=null,invalidResponse=false;const calls=[];
 const google={search:async(cid,query,mcc)=>{assert.equal(cid,account);assert.equal(mcc,'9876543210');if(query.includes('campaign.campaign_budget ='))return members.map(campaign=>({campaign}));return [{campaign:{id:campaign,name:'Principal'},customer:{currencyCode:'BRL'},campaignBudget:{resourceName:resource,period,amountMicros:micros,totalAmountMicros:micros,explicitlyShared:shared}}];},mutate:async(cid,ops,options)=>{calls.push({cid,ops,options});if(!options.validateOnly){if(delay)await delay;if(sendError)throw sendError;micros=ops[0].campaignBudgetOperation.update[period==='DAILY'?'amountMicros':'totalAmountMicros'];return invalidResponse?{}:{mutateOperationResponses:[{campaignBudgetResult:{resourceName:resource}}]};}return {};}};
 const options={accountFor:async id=>{if(id!==account)throw new AdsError('Conta indisponível.',{status:403});return {id:account,mcc:'9876543210',currency:'BRL'};}},service=createBudgets(db,google,options);
 return {db,notes,google,options,service,calls,get micros(){return micros;},set micros(v){micros=v;},set members(v){members=v;},set sendError(v){sendError=v;},set delay(v){delay=v;},set invalidResponse(v){invalidResponse=v;},preview:(extra={})=>service.preview({account,campaign,expected:micros,mode:'increase_percent',value:'20',...extra})};
}
test('budgets accept exact amounts and percentage increases without accepting invalid or unchanged values',()=>{
 assert.equal(budgetAmount('100000000','increase_percent','20'),'120000000');assert.equal(budgetAmount('99990000','increase_percent','20'),'119990000');assert.equal(budgetAmount('100000000','amount','85,50'),'85500000');
 for(const [mode,value]of [['amount','0'],['amount','-20'],['amount','1e4'],['amount','1.234'],['amount','1000001'],['amount',100],['unknown','20'],['amount','100']])assert.throws(()=>budgetAmount('100000000',mode,value));
});
test('preview only validates, apply mutates only budget and writes immutable history once, including all shared campaigns',async()=>{
 const f=fixture({shared:true});try{const q=await f.preview();assert.equal(f.micros,'100000000');assert.equal(f.calls.length,1);assert.equal(f.calls[0].options.validateOnly,true);assert.equal(f.notes.list(account,campaign).length,0);
 assert.deepEqual(f.calls[0].ops,[{campaignBudgetOperation:{update:{resourceName:resource,amountMicros:'120000000'},updateMask:'amount_micros'}}]);
 await assert.rejects(f.service.apply({id:q.id}),e=>e.status===400);const applied=await f.service.apply({id:q.id,confirmShared:true});assert.equal(applied.status,'DONE');assert.equal(f.micros,'120000000');assert.equal(f.calls.filter(c=>!c.options.validateOnly).length,1);
 for(const id of [campaign,'43']){const items=f.notes.list(account,id);assert.equal(items.length,1);assert.equal(items[0].source,'google_ads');assert.match(items[0].description,/100,00.*120,00/);assert.match(items[0].description,/20%/);assert.throws(()=>f.notes.save({...items[0],description:'edited'}),e=>e.status===403);assert.throws(()=>f.notes.remove(items[0]),e=>e.status===403);}
 await f.service.apply({id:q.id,confirmShared:true});assert.equal(f.calls.filter(c=>!c.options.validateOnly).length,1);assert.equal(f.notes.list(account,campaign).length,1);
 }finally{f.db.close();}
});
test('stale budgets, changed shared membership, stale previews and missing account access never mutate',async()=>{
 const f=fixture();try{await assert.rejects(f.preview({expected:'90000000'}),e=>e.status===409);await assert.rejects(f.preview({account:'1111111111'}),e=>e.status===403);
 const q=await f.preview();f.micros='110000000';await assert.rejects(f.service.apply({id:q.id}),e=>e.status===409);
 const q2=await f.preview();f.members=[{id:campaign,name:'Principal',status:'ENABLED'},{id:'43',name:'Nova',status:'PAUSED'}];await assert.rejects(f.service.apply({id:q2.id}),e=>e.status===409);
 const q3=await f.preview();f.db.prepare('UPDATE roi_budget_operations SET created=? WHERE id=?').run('2020-01-01T00:00:00Z',q3.id);await assert.rejects(f.service.apply({id:q3.id,confirmShared:true}),e=>e.status===409);
 assert.equal(f.calls.filter(c=>!c.options.validateOnly).length,0);assert.equal(f.notes.list(account,campaign).length,0);
 }finally{f.db.close();}
});
test('concurrent confirmations are locked and uncertain writes survive reopen without replaying or inventing history',async()=>{
 const f=fixture();try{const q=await f.preview(),q2=await f.preview();let release;f.delay=new Promise(r=>release=r);const sending=f.service.apply({id:q.id});for(let i=0;i<20&&f.calls.filter(c=>!c.options.validateOnly).length===0;i++)await new Promise(setImmediate);
 await assert.rejects(f.service.apply({id:q2.id}),e=>e.status===409);await assert.rejects(f.service.apply({id:q.id}),e=>e.status===409);release();await sending;assert.equal(f.calls.filter(c=>!c.options.validateOnly).length,1);
 f.delay=null;const q3=await f.preview();f.sendError=Error('timeout');await assert.rejects(f.service.apply({id:q3.id}),e=>e.status===409);assert.equal((await f.service.status(q3.id)).status,'UNKNOWN');await assert.rejects(f.preview(),e=>e.status===409);
 const reopened=createBudgets(f.db,f.google,f.options);await assert.rejects(reopened.apply({id:q3.id}),e=>e.status===409);assert.equal(f.calls.filter(c=>!c.options.validateOnly).length,2);assert.equal(f.notes.list(account,campaign).length,1);
 }finally{f.db.close();}
});
test('definite Google rejection preserves history; total budgets use total_amount_micros and incomplete success is uncertain',async()=>{
 const f=fixture({period:'CUSTOM_PERIOD'});try{const q=await f.preview({mode:'amount',value:'80'});assert.equal(f.calls[0].ops[0].campaignBudgetOperation.updateMask,'total_amount_micros');f.sendError=new AdsError('denied',{definite:true});await assert.rejects(f.service.apply({id:q.id}),e=>e.status===422);assert.equal((await f.service.status(q.id)).status,'FAILED');assert.equal(f.notes.list(account,campaign).length,0);
 f.sendError=null;const q2=await f.preview({mode:'amount',value:'80'});f.invalidResponse=true;await assert.rejects(f.service.apply({id:q2.id}),e=>e.status===409);assert.equal(f.notes.list(account,campaign).length,0);
 }finally{f.db.close();}
});
