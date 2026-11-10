import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStorage} from '../lib/persistent.mjs';
import {createAppServer} from '../server.mjs';
import {hashPassword} from '../lib/auth.mjs';
import {createUsers} from '../lib/users.mjs';

test('catalog migration preserves existing rows; custom categories and groups persist and work in both ledgers',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'finance-catalog-'));let storage,server,base,cookie;
 const env={APP_ORIGIN:'https://example.test',ADMIN_EMAIL:'admin@example.test',ADMIN_PASSWORD_HASH:await hashPassword('catalog-test-password')};
 const fixed={id:'a'.repeat(36),description:'Existing fixed',amount_cents:12345,category:'Moradia',area:'home',revision:3,created:'original',updated:'updated'};
 storage=openStorage(dir,'a'.repeat(64));
 storage.db.exec(`CREATE TABLE finance_fixed_expenses(id TEXT PRIMARY KEY,description TEXT NOT NULL,amount_cents INTEGER NOT NULL CHECK(amount_cents>0),category TEXT NOT NULL,area TEXT NOT NULL CHECK(area IN ('home','work')),revision INTEGER NOT NULL DEFAULT 1,created TEXT NOT NULL,updated TEXT NOT NULL);
 CREATE TABLE finance_expenses(id TEXT PRIMARY KEY,description TEXT NOT NULL,amount_cents INTEGER NOT NULL,category TEXT NOT NULL,date TEXT NOT NULL,status TEXT NOT NULL,revision INTEGER NOT NULL,created TEXT NOT NULL,updated TEXT NOT NULL);`);
 storage.db.prepare('INSERT INTO finance_fixed_expenses VALUES (?,?,?,?,?,?,?,?)').run(...Object.values(fixed));
 storage.db.prepare('INSERT INTO finance_expenses VALUES (?,?,?,?,?,?,1,?,?)').run('old','Existing monthly',500,'Outros','2026-11-01','paid','original','original');storage.close();storage=null;
 async function start(){storage=openStorage(dir,'a'.repeat(64));server=createAppServer({env,storage,authStore:storage.store('auth')});await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;}
 async function stop(){await new Promise(r=>server.close(r));server=null;storage.close();storage=null;}
 const send=(path,method='GET',data,origin=env.APP_ORIGIN)=>fetch(base+'/apps/financas/api/'+path,{method,headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});
 try{
  await start();assert.deepEqual({...storage.db.prepare('SELECT * FROM finance_fixed_expenses').get()},fixed);assert.equal(storage.db.prepare('SELECT area FROM finance_expenses').get().area,'home');
  for(const [path,method,body] of [['catalog','GET'],['categories','POST',{name:'Pet'}],['groups','POST',{name:'Farm'}],['groups/home','PUT',{name:'Renamed',revision:1}],['categories/'+ 'a'.repeat(36),'PUT',{name:'Renamed',revision:1}]])assert.equal((await send(path,method,body)).status,401);
  const login=await fetch(base+'/api/login',{method:'POST',headers:{Origin:env.APP_ORIGIN,'Content-Type':'application/json'},body:JSON.stringify({email:env.ADMIN_EMAIL,password:'catalog-test-password'})});cookie=login.headers.get('set-cookie').split(';')[0];
  assert.equal((await send('categories','POST',{name:'No'},'https://evil.test')).status,403);assert.equal((await send('groups','POST',{name:'No'},'https://evil.test')).status,403);
  for(const name of ['', ' '.repeat(4), 'x'.repeat(61), 'bad\u0000name'])assert.equal((await send('categories','POST',{name})).status,400);
  assert.equal((await send('groups','POST',null)).status,400);
  const cat=await send('categories','POST',{name:'  Animais   de estimação  '});assert.equal(cat.status,201);assert.equal((await cat.json()).item.name,'Animais de estimação');
  assert.equal((await send('categories','POST',{name:'ANIMAIS DE ESTIMAÇÃO'})).status,409);
  assert.equal((await send('groups','POST',{name:' trabalho '})).status,409);
  const responses=await Promise.all([send('groups','POST',{name:'Chácara'}),send('groups','POST',{name:'Chácara'})]);assert.deepEqual(responses.map(r=>r.status).sort(),[201,409]);
  const catalog=await (await send('catalog')).json(),group=catalog.groups.find(g=>g.name==='Chácara');assert.ok(group);assert.ok(catalog.groups.some(g=>g.id==='home'));assert.ok(catalog.groups.some(g=>g.id==='work'));
  const expense={description:'Pet food',amount_cents:1000,category:'Animais de estimação',area:group.id};
  assert.equal((await send('fixed','POST',expense)).status,201);assert.equal((await send('expenses','POST',{...expense,date:'2026-11-06',status:'pending'})).status,201);
  assert.equal((await send('fixed','POST',{...expense,area:'nonexistent'})).status,400);assert.equal((await send('expenses','POST',{...expense,area:'nonexistent',date:'2026-11-06',status:'paid'})).status,400);
  let data=await (await send('fixed')).json();assert.equal(data.summary.groups[group.id],1000);assert.equal(data.summary.home,12345);assert.equal(data.summary.total,13345);
  data=await (await send('expenses?month=2026-11')).json();assert.equal(data.summary.groups[group.id],1000);assert.equal(data.summary.groups.home,500);
  await stop();await start();data=await (await send('catalog')).json();assert.equal(data.groups.filter(g=>g.name==='Chácara').length,1);assert.ok(data.categories.includes('Animais de estimação'));assert.deepEqual({...storage.db.prepare('SELECT * FROM finance_fixed_expenses WHERE id=?').get(fixed.id)},fixed);
  await createUsers(storage.db,env).save({name:'Reader',email:'reader@example.test',password:'catalog-reader-password',active:true,grants:[]},env.ADMIN_EMAIL,async()=>({accounts:[]}));
  const reader=await fetch(base+'/api/login',{method:'POST',headers:{Origin:env.APP_ORIGIN,'Content-Type':'application/json'},body:JSON.stringify({email:'reader@example.test',password:'catalog-reader-password'})});cookie=reader.headers.get('set-cookie').split(';')[0];
  assert.equal((await send('catalog')).status,403);assert.equal((await send('categories','POST',{name:'Denied'})).status,403);assert.equal((await send('groups','POST',{name:'Denied'})).status,403);
  assert.equal((await send('groups/home','PUT',{name:'Denied',revision:1})).status,403);assert.equal((await send('categories/'+ 'a'.repeat(36),'PUT',{name:'Denied',revision:1})).status,403);
 }finally{if(server)await stop();await rm(dir,{recursive:true,force:true});}
});
