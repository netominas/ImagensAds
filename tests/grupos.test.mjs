import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStorage} from '../lib/persistent.mjs';
import {createAppServer} from '../server.mjs';
import {hashPassword} from '../lib/auth.mjs';
import {createTracker,saoPauloDay} from '../apps/grupos/tracker.mjs';

const person=(n,extra={})=>({id:`${n}@lid`,lid:`${n}@lid`,phoneNumber:`55119000000${n}@s.whatsapp.net`,...extra});

test('tracker records joins and leaves without duplicates or invented history',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'grupos-tracker-'));
 const storage=openStorage(dir,'a'.repeat(64));
 const {ensureSchema}=await import('../apps/grupos/schema.mjs');ensureSchema(storage.db);
 let when=new Date('2026-11-10T15:00:00Z');
 const tracker=createTracker(storage.db,{clock:()=>when});
 const events=()=>storage.db.prepare('SELECT kind,detail,source,day FROM wpp_events ORDER BY id').all();
 try{
  tracker.syncAll([{id:'g@g.us',subject:'Promo',participants:[person(1,{admin:'admin'}),person(2),person(3)]}],['1']);
  assert.equal(events().length,0,'first sync is a baseline, not joins');
  assert.equal(storage.db.prepare('SELECT is_admin FROM wpp_groups').get().is_admin,1);
  when=new Date('2026-11-11T15:00:00Z');
  tracker.syncAll([{id:'g@g.us',subject:'Promo',participants:[person(1),person(2),person(4)]}],['1']);
  assert.deepEqual(events().map(e=>`${e.kind}:${e.detail}:${e.day}`),['join:detected:2026-11-11','leave:detected:2026-11-11']);
  assert.equal(tracker.handleParticipants({id:'g@g.us',author:'5@lid',participants:[person(5)],action:'add'}),1);
  assert.equal(tracker.handleParticipants({id:'g@g.us',author:'1@lid',participants:[person(2)],action:'remove'}),1);
  assert.deepEqual(events().slice(2).map(e=>`${e.kind}:${e.detail}:${e.source}`),['join:joined:live','leave:removed:live']);
  assert.equal(tracker.handleParticipants({id:'g@g.us',author:'5@lid',participants:[person(5)],action:'add'}),0,'repeat is ignored');
  tracker.syncAll([{id:'g@g.us',subject:'Promo',participants:[person(1),person(4),person(5)]}],['1']);
  assert.equal(events().length,4,'sync does not repeat what live events already recorded');
  assert.equal(tracker.handleParticipants({id:'g@g.us',author:'1@lid',participants:[person(4)],action:'promote'}),0);
  assert.equal(tracker.handleParticipants({id:'unknown@g.us',author:'1@lid',participants:[person(9)],action:'add'}),0);
  tracker.syncAll([],['1']);
  assert.equal(storage.db.prepare('SELECT active FROM wpp_groups').get().active,0);
  assert.equal(saoPauloDay(new Date('2026-11-11T02:30:00Z')),'2026-11-10','uses America/Sao_Paulo calendar');
 }finally{storage.close();await rm(dir,{recursive:true,force:true});}
});

test('WhatsApp groups app shares login, is admin-only, hides private files and serves persisted numbers',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'grupos-app-'));
 const env={APP_ORIGIN:'https://workspace.example',ADMIN_EMAIL:'admin@example.com',ADMIN_PASSWORD_HASH:await hashPassword('grupos-test-password')};
 const storage=openStorage(dir,'b'.repeat(64));
 const server=createAppServer({env,storage,authStore:storage.store('auth'),googleAds:{configured:()=>false},roiOptions:{autoSync:false}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port;
 let cookie;
 const send=(path,method='GET',body,origin=env.APP_ORIGIN)=>fetch(base+path,{method,redirect:'manual',headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const login=async(email,password)=>{const r=await send('/api/login','POST',{email,password});assert.equal(r.status,200);cookie=r.headers.get('set-cookie').split(';')[0];};
 try{
  // sem sessão
  assert.equal((await send('/apps/grupos/')).headers.get('location'),'/login');
  for(const path of ['/apps/grupos/api/summary','/apps/grupos/api/collector','/apps/grupos/api/group?id=x'])assert.equal((await send(path)).status,401);
  assert.equal((await send('/apps/grupos/api/collector/command','POST',{command:'sync'})).status,401);
  // arquivos privados nunca são servidos
  for(const path of ['/apps/grupos/private/index.html','/apps/grupos/api.mjs','/apps/grupos/schema.mjs','/apps/grupos/tracker.mjs','/apps/grupos/collector/collector.mjs','/apps/grupos/collector/package.json','/runtime.env','/data/adstudio.sqlite','/apps/grupos/public/app.js'])assert.equal((await send(path)).status,404,path);
  assert.equal((await send('/apps/grupos/app.js')).status,200);
  assert.equal((await send('/apps/grupos/style.css')).status,200);

  await login(env.ADMIN_EMAIL,'grupos-test-password');
  assert.equal((await send('/apps/grupos')).headers.get('location'),'/apps/grupos/');
  const page=await (await send('/apps/grupos/')).text();
  assert.match(page,/Todas as aplicações/);assert.match(page,/href="\/"/);
  assert.match(await (await send('/')).text(),/href="\/apps\/grupos\/"/);
  assert.equal((await send('/apps/criativos/')).status,200,'studio untouched');
  assert.equal((await send('/apps/financas/')).status,200,'finance untouched');
  assert.equal((await send('/apps/grupos/',"POST")).status,405);

  // dados persistidos pelo coletor
  const tracker=createTracker(storage.db);
  const group=(subject,list)=>({id:subject+'@g.us',subject,participants:list});
  tracker.syncAll([group('A',[person(1),person(2),person(3)]),group('B',[person(7)])],[]);
  tracker.handleParticipants({id:'A@g.us',author:'1@lid',participants:[person(4)],action:'add'});
  tracker.handleParticipants({id:'A@g.us',author:'2@lid',participants:[person(2)],action:'remove'});
  tracker.handleParticipants({id:'A@g.us',author:'1@lid',participants:[person(3)],action:'remove'});
  const summary=await (await send('/apps/grupos/api/summary?days=7')).json();
  assert.equal(summary.totals.groups,2);assert.equal(summary.totals.members,3);
  assert.equal(summary.totals.joinedToday,1);assert.equal(summary.totals.leftToday,2);assert.equal(summary.totals.netWeek,-1);
  const a=summary.groups.find(g=>g.name==='A');assert.deepEqual([a.size,a.joinedToday,a.leftToday],[2,1,2]);
  const detail=await (await send('/apps/grupos/api/group?id='+encodeURIComponent('A@g.us')+'&days=3')).json();
  assert.equal(detail.series.length,3);
  assert.deepEqual(detail.series.at(-1),{day:saoPauloDay(),joined:1,left:2,size:2});
  assert.equal(detail.recent.length,3);
  assert.doesNotMatch(JSON.stringify(detail),/55119000000[0-9]/,'phones are masked');
  assert.match(detail.recent[0].phone,/•••••/);
  for(const days of ['0','366','abc','1.5'])assert.equal((await send('/apps/grupos/api/summary?days='+days)).status,400);
  assert.equal((await send('/apps/grupos/api/group?id=missing')).status,404);

  // coletor e comandos
  assert.equal((await (await send('/apps/grupos/api/collector')).json()).online,false);
  assert.equal((await send('/apps/grupos/api/collector/command','POST',{command:'sync'})).status,409);
  storage.db.prepare("UPDATE wpp_collector SET state='qr',qr_svg='<svg/>',heartbeat=? WHERE id=1").run(Math.floor(Date.now()/1000));
  const status=await (await send('/apps/grupos/api/collector')).json();
  assert.deepEqual([status.online,status.state,status.qrSvg],[true,'qr','<svg/>']);
  assert.equal((await send('/apps/grupos/api/collector/command','POST',{command:'sync'},'https://evil.example')).status,403);
  assert.equal((await send('/apps/grupos/api/collector/command','POST',{command:'rm -rf'})).status,400);
  assert.equal((await send('/apps/grupos/api/collector/command','POST',{command:'sync'})).status,200);
  assert.equal(storage.db.prepare('SELECT command FROM wpp_collector').get().command,'sync');
  storage.db.prepare('UPDATE wpp_collector SET heartbeat=?').run(Math.floor(Date.now()/1000)-600);
  const stale=await (await send('/apps/grupos/api/collector')).json();
  assert.deepEqual([stale.online,stale.state,stale.qrSvg],[false,'stopped',null],'stale heartbeat means offline and hides the QR');

  // usuários leitores não acessam
  const admin=cookie;
  const created=await send('/api/users','POST',{name:'Leitor',email:'leitor@example.com',password:'leitor-test-password-1',active:true,role:'reader',grants:[],whatsapp_sites:['sitea.com.br']});
  assert.equal(created.status,200);
  cookie=undefined;await login('leitor@example.com','leitor-test-password-1');
  for(const path of ['/apps/grupos/','/apps/grupos/api/summary','/apps/grupos/api/collector'])assert.equal((await send(path)).status,403,path);
  assert.equal((await send('/apps/grupos/api/collector/command','POST',{command:'relink'})).status,403);
  cookie=admin;

  // persistência após reiniciar
  await new Promise(r=>server.close(r));storage.close();
  const again=openStorage(dir,'b'.repeat(64));
  assert.equal(again.db.prepare('SELECT COUNT(*) AS n FROM wpp_events').get().n,3);
  assert.equal(again.db.prepare('SELECT COUNT(*) AS n FROM wpp_groups').get().n,2);
  again.close();
 }finally{if(server.listening)await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
});
