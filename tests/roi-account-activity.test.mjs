import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createROIWarehouse} from '../apps/roi/warehouse.mjs';
import {createAccountActivity} from '../apps/roi/account-activity.mjs';

test('account activity reads all imported accounts without API calls and does not confuse missing history with inactivity',async()=>{
 const db=new DatabaseSync(':memory:');try{
  const warehouse=createROIWarehouse(db),id='1234567890',other='9876543210',day='2026-11-26',accounts=[{id,name:'Imported',currency:'BRL'},{id:other,name:'New',currency:'BRL'}];let calls=0,fail=false;
  const service=createAccountActivity(db,{warehouse,day:()=>day,catalog:async()=>({accounts}),google:{search:async()=>{calls++;if(fail)throw Error('quota');return [{campaign:{id:'1',status:'PAUSED'}},{campaign:{id:'2',status:'ENABLED'}},{campaign:{id:'2',status:'ENABLED'}}];}}});
  warehouse.saveSource('ads',id,day,day,[{account:id,campaign:'1',date:day,site:'example.com',currency:'BRL',cost:10,campaign_status:'ENABLED',campaign_checked_at:'2026-11-26T12:00:00Z'},{account:id,campaign:'1',date:day,site:'example.com',currency:'BRL',cost:5,campaign_status:'ENABLED',campaign_checked_at:'2026-11-26T12:00:00Z'}]);
  let report=service.read(accounts);assert.equal(calls,0);assert.equal(report.start,'2026-10-28');
  assert.equal(report.items[0].spend,15);assert.equal(report.items[0].spent_campaigns,1);assert.equal(report.items[0].active_campaigns,1);assert.equal(report.items[0].activity_scope,'observed');assert.equal(report.items[0].covered_days,1);
  assert.equal(report.items[1].covered_days,0);assert.equal(report.items[1].last_spend,null);assert.equal(report.items[1].active_campaigns,null);
  await service.refresh(other);report=service.read(accounts);assert.equal(calls,1);assert.equal(report.items[1].active_campaigns,1);assert.equal(report.items[1].activity_scope,'all');
  fail=true;await assert.rejects(service.refresh(other));assert.equal(service.read(accounts).items[1].active_campaigns,1);
  await assert.rejects(service.refresh('0000000000'));assert.equal(calls,2);
 }finally{db.close();}
});
