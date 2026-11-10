import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStorage} from '../lib/persistent.mjs';
import {createFinanceAPI} from '../apps/financas/api.mjs';

test('rename updates both ledgers atomically, preserves group IDs and amounts, detects stale edits and survives restart without reseeding',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'finance-rename-'));let storage,api;
 function start(){storage=openStorage(dir,'a'.repeat(64));api=createFinanceAPI(storage);}
 const send=(path,method='GET',data,origin='https://example.test')=>api(new Request('https://example.test/apps/financas/api/'+path,{method,headers:{Origin:origin,'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})}));
 try{
  start();const item={description:'Keep this expense',amount_cents:12345,category:'Moradia',area:'home'};
  const fixed=await (await send('fixed','POST',item)).json(),monthly=await (await send('expenses','POST',{...item,date:'2026-11-10',status:'paid'})).json();
  const catalog=await (await send('catalog')).json(),category=catalog.categoryItems.find(c=>c.name==='Moradia'),group=catalog.groups.find(g=>g.id==='home');
  const categoryPath='categories/'+category.id,groupPath='groups/home';
  assert.equal((await send(categoryPath,'PUT',{name:'Casa',revision:1},'https://evil.test')).status,403);
  assert.equal((await send(groupPath,'PUT',{name:'Casa',revision:1},'https://evil.test')).status,403);
  assert.equal((await send(categoryPath,'POST',{name:'Casa',revision:1})).status,405);
  assert.equal((await send('categories/'+ '0'.repeat(36),'PUT',{name:'Casa',revision:1})).status,404);
  for(const name of ['', '  ', 'x'.repeat(61),'bad\u0000name'])assert.equal((await send(categoryPath,'PUT',{name,revision:1})).status,400);
  assert.equal((await send(categoryPath,'PUT',{name:' TRANSPORTE ',revision:1})).status,409);
  assert.equal((await send(groupPath,'PUT',{name:'Trabalho',revision:1})).status,409);
  assert.equal((await send(categoryPath,'PUT',{name:'Casa'})).status,409);
  const renamed=await send(categoryPath,'PUT',{name:'  Casa   e imóveis ',revision:category.revision});assert.equal(renamed.status,200);const changed=await renamed.json();assert.equal(changed.item.name,'Casa e imóveis');assert.equal(changed.item.id,category.id);
  assert.equal((await send(categoryPath,'PUT',{name:'Stale',revision:1})).status,409);
  assert.equal((await send('fixed/'+fixed.id,'PUT',{...item,revision:1})).status,409);
  const savedFixed=storage.db.prepare('SELECT * FROM finance_fixed_expenses WHERE id=?').get(fixed.id),savedMonthly=storage.db.prepare('SELECT * FROM finance_expenses WHERE id=?').get(monthly.id);
  for(const saved of [savedFixed,savedMonthly]){assert.equal(saved.category,'Casa e imóveis');assert.equal(saved.amount_cents,12345);assert.equal(saved.revision,2);assert.equal(saved.area,'home');}assert.equal(savedMonthly.status,'paid');assert.equal(savedMonthly.date,'2026-11-10');
  assert.equal((await send(groupPath,'PUT',{name:'Família',revision:group.revision})).status,200);
  assert.equal(storage.db.prepare('SELECT area FROM finance_fixed_expenses').get().area,'home');
  assert.equal((await send(groupPath,'PUT',{name:'Stale',revision:1})).status,409);
  assert.equal((await send(groupPath,'PUT',{name:'Família',revision:2})).status,200);assert.equal((await (await send('catalog')).json()).groups.find(g=>g.id==='home').revision,2);
  storage.db.exec("CREATE TRIGGER fail_rename BEFORE UPDATE ON finance_fixed_expenses WHEN NEW.category='Fail category' BEGIN SELECT RAISE(ABORT, 'forced'); END");
  await assert.rejects(send(categoryPath,'PUT',{name:'Fail category',revision:2}));assert.equal(storage.db.prepare('SELECT name FROM finance_categories WHERE id=?').get(category.id).name,'Casa e imóveis');assert.equal(storage.db.prepare('SELECT category FROM finance_expenses').get().category,'Casa e imóveis');storage.db.exec('DROP TRIGGER fail_rename');
  storage.close();start();const after=await (await send('catalog')).json();assert.ok(!after.categories.includes('Moradia'));assert.equal(after.categories.length,catalog.categories.length);assert.equal(after.groups.find(g=>g.id==='home').name,'Família');assert.equal(after.groups.length,catalog.groups.length);
  const list=await (await send('fixed')).json();assert.equal(list.summary.categories['Casa e imóveis'],12345);assert.equal(list.summary.groups.home,12345);
 }finally{storage?.close();await rm(dir,{recursive:true,force:true});}
});
