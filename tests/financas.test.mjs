import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStorage} from '../lib/persistent.mjs';
import {createAppServer} from '../server.mjs';
import {hashPassword} from '../lib/auth.mjs';
import {createUsers} from '../lib/users.mjs';

test('household expenses share login, restrict access, validate cents, survive restart and preserve studio data',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'finance-test-'));
 let storage,server;
 const env={APP_ORIGIN:'https://workspace.example',ADMIN_EMAIL:'admin@example.com',ADMIN_PASSWORD_HASH:await hashPassword('finance-test-password')};
 let base;
 async function start(){storage=openStorage(dir,'f'.repeat(64));server=createAppServer({env,storage,authStore:storage.store('auth')});await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;}
 async function stop(){await new Promise(r=>server.close(r));server=null;storage.close();storage=null;}
 let cookie;
 const send=(path,method='GET',body,origin=env.APP_ORIGIN)=>fetch(base+path,{method,redirect:'manual',headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const endpoint='/apps/financas/api/expenses',expense={description:'Supermercado',amount_cents:12345,category:'Alimentação',date:'2026-11-05',status:'paid'};
 try{
  await start();
  assert.equal((await send('/apps/financas/')).headers.get('location'),'/login');
  for(const method of ['GET','POST','PUT','DELETE'])assert.equal((await send(endpoint,method,method==='GET'?undefined:expense)).status,401);
  for(const path of ['/apps/financas/private/index.html','/apps/financas/api.mjs','/runtime.env','/data/adstudio.sqlite','/apps/financas/public/app.js'])assert.equal((await send(path)).status,404);
  assert.equal((await send('/apps/financas/app.js')).status,200);
  const login=await send('/api/login','POST',{email:env.ADMIN_EMAIL,password:'finance-test-password'});assert.equal(login.status,200);cookie=login.headers.get('set-cookie').split(';')[0];
  assert.equal((await send('/apps/financas')).headers.get('location'),'/apps/financas/');
  assert.match(await (await send('/apps/financas/')).text(),/Todas as aplicações/);
  assert.match(await (await send('/')).text(),/href="\/apps\/financas\/"/);
  assert.equal((await send('/apps/criativos/')).status,200);
  await storage.saveKeys({openai:'preserve-this-test-key'});await storage.saveSettings({templates:[{id:'home',name:'Saved',prompt:'Keep'}],models:{}});storage.addImage({id:'existing'},'image/png',Buffer.from([1,2,3]));
  assert.equal((await send(endpoint,'POST',expense,'https://evil.example')).status,403);
  for(const invalid of [{amount_cents:0},{amount_cents:1.23},{amount_cents:'123'},{date:'2026-02-30'},{category:'Invalid'},{status:'bad'},null])assert.equal((await send(endpoint,'POST',invalid===null?null:{...expense,...invalid})).status,400);
  const created=await send(endpoint,'POST',expense);assert.equal(created.status,201);const first=await created.json();
  await send(endpoint,'POST',{...expense,description:'Aluguel',category:'Moradia',amount_cents:200000,status:'pending'});
  await send(endpoint,'POST',{...expense,date:'2026-12-01'});
  let data=await (await send(endpoint+'?month=2026-11')).json();assert.equal(data.expenses.length,2);assert.equal(data.summary.total,212345);assert.equal(data.summary.paid,12345);assert.equal(data.summary.pending,200000);assert.equal(data.summary.categories.Moradia,200000);
  assert.equal((await send(endpoint+'?month=2026-13')).status,400);
  const changed=await send(endpoint+'/'+first.id,'PUT',{...expense,amount_cents:23456,revision:first.revision});assert.equal(changed.status,200);
  assert.equal((await send(endpoint+'/'+first.id,'PUT',{...expense,revision:1})).status,409);
  assert.equal((await send(endpoint+'/'+first.id,'DELETE',{revision:1})).status,409);
  await stop();await start();
  data=await (await send(endpoint+'?month=2026-11')).json();assert.equal(data.summary.paid,23456);assert.equal((await storage.keys()).openai,'preserve-this-test-key');assert.equal((await storage.settings()).templates[0].prompt,'Keep');assert.equal(storage.images().length,1);
  assert.equal((await send(endpoint+'/'+first.id,'DELETE',{revision:2})).status,200);
  assert.equal((await send(endpoint+'/'+first.id,'DELETE',{revision:2})).status,404);
  const reader=await serverReader();
  const adminCookie=cookie;cookie=reader;
  assert.equal((await send('/apps/financas/')).status,403);assert.equal((await send(endpoint+'?month=2026-11')).status,403);assert.equal((await send(endpoint,'POST',expense)).status,403);cookie=adminCookie;
  assert.equal((await send('/api/logout','POST')).status,200);assert.equal((await send(endpoint+'?month=2026-11')).status,401);
 }finally{if(server)await stop();await rm(dir,{recursive:true,force:true});}
 async function serverReader(){
  await createUsers(storage.db,env).save({name:'Reader',email:'reader@example.com',password:'reader-test-password',active:true,grants:[]},env.ADMIN_EMAIL,async()=>({accounts:[]}));
  const response=await send('/api/login','POST',{email:'reader@example.com',password:'reader-test-password'});assert.equal(response.status,200);return response.headers.get('set-cookie').split(';')[0];
 }
});
