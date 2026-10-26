import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createROIAPI} from '../apps/roi/api.mjs';

test('network discovery refreshes stored connections without Google Ads calls or changing selected ROI sources',async()=>{
 const db=new DatabaseSync(':memory:');let calls=0,fail=false,found=[{id:'1',name:'Primeira',currency:'BRL',timezone:'America/Sao_Paulo'},{id:'2',name:'Segunda',currency:'USD',timezone:'America/Sao_Paulo'},{id:'3',name:'Nova rede',currency:'USD',timezone:'America/Sao_Paulo'}];
 const api=createROIAPI({db},{google:{configured:()=>false,accessible:async()=>{throw Error('Google Ads must not be called');}},admanager:{networks:async()=>{calls++;if(fail)throw Error('offline');return found;}}});
 const account='1234567890',settings={accounts:[account],networks:['1','2']},initial={accounts:[{id:account,status:'ENABLED'}],networks:found.slice(0,2),updated_at:new Date().toISOString()};
 db.prepare('INSERT OR REPLACE INTO roi_metadata VALUES (?,?,?)').run('catalog',JSON.stringify(initial),new Date().toISOString());db.prepare('INSERT OR REPLACE INTO roi_settings VALUES (1,?)').run(JSON.stringify(settings));
 const origin='https://networks.test',request=(path,body,host=origin)=>api(new Request(origin+'/apps/roi/api'+path,{method:body?'POST':'GET',headers:{Origin:host,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}));
 try{
  assert.equal((await request('/networks/refresh',{},'https://evil.test')).status,403);assert.equal(calls,0);
  const refreshed=await request('/networks/refresh',{});assert.equal(refreshed.status,200);const data=await refreshed.json();assert.equal(data.networks.length,3);assert.ok(data.networks.every(n=>n.available));assert.deepEqual(data.settings,settings);assert.equal(calls,1);
  const cached=await(await request('/catalog')).json();assert.equal(cached.networks[2].name,'Nova rede');assert.equal(calls,1);assert.deepEqual(JSON.parse(db.prepare('SELECT data FROM roi_settings').get().data),settings);
  fail=true;assert.equal((await request('/networks/refresh',{})).status,502);assert.equal((await(await request('/catalog')).json()).networks.length,3);
  fail=false;found=found.slice(2);const retained=await(await request('/networks/refresh',{})).json();assert.equal(retained.networks.find(n=>n.id==='1').available,false);assert.equal(retained.networks.find(n=>n.id==='3').available,true);assert.deepEqual(retained.settings,settings);
 }finally{api.stopAuto();db.close();}
});
