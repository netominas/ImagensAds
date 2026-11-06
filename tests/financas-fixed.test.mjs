import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStorage} from '../lib/persistent.mjs';
import {createAppServer} from '../server.mjs';
import {hashPassword} from '../lib/auth.mjs';
import {createUsers} from '../lib/users.mjs';

test('fixed monthly plans persist independently of dates and payments; authentication, origin, revisions and reader scope apply',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'finance-fixed-'));let storage,server,base,cookie;
 const env={APP_ORIGIN:'https://example.test',ADMIN_EMAIL:'admin@example.test',ADMIN_PASSWORD_HASH:await hashPassword('fixed-expenses-password')};
 const endpoint='/apps/financas/api/fixed',item={description:'Monthly service',amount_cents:12345,category:'Outros',area:'work'};
 async function start(){storage=openStorage(dir,'a'.repeat(64));server=createAppServer({env,storage,authStore:storage.store('auth')});await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;}
 async function stop(){await new Promise(r=>server.close(r));server=null;storage.close();storage=null;}
 const send=(path,method='GET',data,origin=env.APP_ORIGIN)=>fetch(base+path,{method,headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});
 try{
  await start();assert.equal((await send(endpoint)).status,401);assert.equal((await send(endpoint,'POST',item)).status,401);
  const login=await send('/api/login','POST',{email:env.ADMIN_EMAIL,password:'fixed-expenses-password'});assert.equal(login.status,200);cookie=login.headers.get('set-cookie').split(';')[0];
  assert.equal((await send(endpoint,'POST',item,'https://evil.test')).status,403);
  for(const change of [{amount_cents:0},{amount_cents:1.5},{amount_cents:100000001},{area:'other'},{category:'Invalid'},{description:''}])assert.equal((await send(endpoint,'POST',{...item,...change})).status,400);
  assert.equal((await send(endpoint,'POST',null)).status,400);
  const created=await send(endpoint,'POST',item);assert.equal(created.status,201);const row=await created.json();assert.equal(row.date,undefined);assert.equal(row.status,undefined);
  await send(endpoint,'POST',{...item,description:'Home service',amount_cents:20000,area:'home'});
  let list=await (await send(endpoint)).json();assert.equal(list.items.length,2);assert.equal(list.summary.total,32345);assert.equal(list.summary.home,20000);assert.equal(list.summary.work,12345);
  for(const month of ['2026-11','2026-12']){const actual=await (await send('/apps/financas/api/expenses?month='+month)).json();assert.equal(actual.expenses.length,0);assert.equal(actual.summary.paid,0);}
  assert.equal((await send(endpoint+'/'+row.id,'PUT',{...item,amount_cents:15000,revision:1})).status,200);
  assert.equal((await send(endpoint+'/'+row.id,'PUT',{...item,revision:1})).status,409);assert.equal((await send(endpoint+'/'+row.id,'DELETE',{revision:1})).status,409);
  assert.equal((await send(endpoint,'PATCH',item)).status,405);assert.equal((await send(endpoint+'/invalid')).status,404);
  await stop();await start();list=await (await send(endpoint)).json();assert.equal(list.summary.work,15000);
  assert.equal((await send(endpoint+'/'+row.id,'DELETE',{revision:2})).status,200);
  await createUsers(storage.db,env).save({name:'Reader',email:'reader@example.test',password:'reader-fixed-password',active:true,grants:[]},env.ADMIN_EMAIL,async()=>({accounts:[]}));
  const reader=await send('/api/login','POST',{email:'reader@example.test',password:'reader-fixed-password'});cookie=reader.headers.get('set-cookie').split(';')[0];assert.equal((await send(endpoint)).status,403);assert.equal((await send(endpoint,'POST',item)).status,403);
 }finally{if(server)await stop();await rm(dir,{recursive:true,force:true});}
});
