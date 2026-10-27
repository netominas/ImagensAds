import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createAccountStatus} from '../apps/roi/account-status.mjs';
import {createPayments} from '../apps/roi/payments.mjs';

test('account states are batched through the manager, scoped to known accounts and never infer suspension from missing access',async()=>{
 const db=new DatabaseSync(':memory:');let calls=0,fail=false;
 const accounts=[{id:'1234567890',mcc:'9999999999'},{id:'1234567891',mcc:'9999999999'},{id:'1234567892',mcc:'9999999999'},{id:'1234567893',mcc:''}];
 const google={search:async(id,q,mcc)=>{calls++;if(fail)throw Error('permission denied');if(mcc){assert.equal(id,mcc);assert.equal(mcc,'9999999999');assert.match(q,/FROM customer_client WHERE/);return [{customerClient:{id:'1234567890',status:'ENABLED'}},{customerClient:{id:'1234567891',status:'SUSPENDED'}},{customerClient:{id:'9999999998',status:'CLOSED'}}];}return [{customer:{id:'1234567893',status:'CANCELED'}}];}};
 try{
  const states=createAccountStatus(db,google);await states.refresh(accounts);assert.equal(calls,2);assert.equal(states.read(accounts[0].id).account_status,'ENABLED');assert.equal(states.read(accounts[1].id).account_status,'SUSPENDED');assert.equal(states.read(accounts[2].id).account_status,null);assert.ok(states.read(accounts[2].id).status_error);assert.equal(states.read(accounts[3].id).account_status,'CANCELED');assert.equal(states.read('9999999998').account_status,null);
  const before=states.read(accounts[1].id);fail=true;await states.refresh(accounts);const retained=states.read(accounts[1].id);assert.equal(retained.account_status,'SUSPENDED');assert.equal(retained.status_updated,before.status_updated);assert.ok(retained.status_error);assert.equal(createAccountStatus(db,google).read(accounts[0].id).account_status,'ENABLED');
 }finally{db.close();}
});

test('confirmed account suspension remains available when billing is inaccessible',async()=>{
 const db=new DatabaseSync(':memory:'),account={id:'1234567890',mcc:'9999999999'},google={search:async(id,q)=>{if(q.includes('FROM customer_client'))return [{customerClient:{id:account.id,status:'SUSPENDED'}}];throw Error('Billing unavailable');}};
 try{const payments=createPayments(db,{google,admanager:{},catalog:async()=>({accounts:[account],networks:[]})});await payments.refresh();await payments.settled();const item=(await payments.list()).items[0];assert.equal(item.account_status,'SUSPENDED');assert.equal(item.status_error,null);assert.ok(item.error);assert.deepEqual(item.profiles,[]);}finally{db.close();}
});
