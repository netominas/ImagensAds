import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {createCampaignChanges} from '../apps/roi/campaign-changes.mjs';
import {createROIAPI} from '../apps/roi/api.mjs';
const account='1234567890',campaign='42',other='9876543210';
const note={account,campaign,date:'2026-10-20',type:'budget_increase',description:'Orçamento de R$ 100 para R$ 150.\nAcompanhar ROI.'};

test('campaign changes persist, sort by event date, isolate account/campaign and update idempotently',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'roi-changes-')),path=join(dir,'data.sqlite');let db=new DatabaseSync(path);
 try{
  let store=createCampaignChanges(db);const first=store.save(note),id=first.id;store.save({...note,date:'2026-10-22',type:'pricing'});store.save({...note,account:other});store.save({...note,campaign:'43'});
  assert.deepEqual(store.list(account,campaign).map(n=>n.date),['2026-10-22','2026-10-20']);
  store.save({...note,id,description:'Revisado: R$ 160.'});assert.equal(store.list(account,campaign).length,2);assert.equal(store.list(account,campaign)[1].description,'Revisado: R$ 160.');
  assert.throws(()=>store.save({...note,id,account:other}),e=>e.status===404);assert.throws(()=>store.remove({...note,id,campaign:'43'}),e=>e.status===404);
  db.close();db=new DatabaseSync(path);store=createCampaignChanges(db);assert.equal(store.list(account,campaign).length,2);assert.equal(store.list(other,campaign).length,1);
  store.remove({account,campaign,id});assert.equal(store.list(account,campaign).length,1);assert.ok(db.prepare('SELECT deleted_at FROM roi_campaign_changes WHERE id=?').get(id).deleted_at);assert.throws(()=>store.save({...note,id}),e=>e.status===404);
 }finally{db.close();assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));await rm(dir,{recursive:true,force:true});}
});

test('change validation rejects impossible dates, unknown types, empty/oversized descriptions and malformed scope',()=>{
 const db=new DatabaseSync(':memory:');try{const store=createCampaignChanges(db);for(const patch of [{date:'2026-02-30'},{date:'2025-02-29'},{date:'26/10/2026'},{date:'1999-12-31'},{type:'unsupported'},{description:'  '},{description:'x'.repeat(4001)},{account:[]},{campaign:['42']},{id:'invalid'}])assert.throws(()=>store.save({...note,...patch}),e=>e.status===400);assert.equal(store.list(account,campaign).length,0);assert.equal(store.save({...note,date:'2024-02-29',description:' <script>alert(1)</script> '}).items[0].description,'<script>alert(1)</script>');}finally{db.close();}
});

test('change API reads local data only, enforces available accounts and rejects cross-origin writes',async()=>{
 const db=new DatabaseSync(':memory:');const api=createROIAPI({db},{google:{configured:()=>false},admanager:{}});
 db.prepare('INSERT OR REPLACE INTO roi_metadata VALUES (?,?,?)').run('catalog',JSON.stringify({accounts:[{id:account},{id:other}],networks:[]}),new Date().toISOString());
 const origin='https://roi.test',request=(method,body,host=origin)=>api(new Request(origin+'/apps/roi/api/campaign-changes'+(method==='GET'?'?account='+account+'&campaign='+campaign:''),{method,headers:{Origin:host,'Content-Type':'application/json'},...(method==='GET'?{}:{body:JSON.stringify(body)})}));
 try{
  assert.equal((await request('POST',note,'https://evil.test')).status,403);assert.equal((await request('POST',{...note,account:'1111111111'})).status,403);
  const created=await request('POST',note);assert.equal(created.status,200);const {id}=await created.json();const read=await(await request('GET')).json();assert.equal(read.items.length,1);assert.ok(read.types.some(t=>t.value==='landing_page'));
  assert.equal((await request('POST',{...note,id,date:'2026-02-31'})).status,400);assert.equal((await request('POST',{...note,id,type:'landing_page',description:'Nova página.'})).status,200);assert.equal((await(await request('GET')).json()).items[0].description,'Nova página.');
  assert.equal((await request('DELETE',{account,campaign,id},'https://evil.test')).status,403);assert.equal((await request('DELETE',{account,campaign,id})).status,200);assert.equal((await(await request('GET')).json()).items.length,0);
 }finally{api.stopAuto();db.close();}
});
