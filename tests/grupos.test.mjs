import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {openStorage} from '../lib/persistent.mjs';
import {createAppServer} from '../server.mjs';
import {hashPassword} from '../lib/auth.mjs';
import {createTracker,saoPauloDay} from '../apps/grupos/tracker.mjs';
import {ensureSchema} from '../apps/grupos/schema.mjs';

const person=(n,extra={})=>({id:`${n}@lid`,lid:`${n}@lid`,phoneNumber:`55119000000${n}@s.whatsapp.net`,...extra});
const addAccount=(db,name)=>Number(db.prepare("INSERT INTO wpp_accounts (name,created) VALUES (?,?)").run(name,1).lastInsertRowid);

test('tracker records joins and leaves without duplicates or invented history, per account',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'grupos-tracker-'));
 const storage=openStorage(dir,'a'.repeat(64));
 ensureSchema(storage.db);
 const one=addAccount(storage.db,'Um'),two=addAccount(storage.db,'Dois');
 let when=new Date('2026-11-10T15:00:00Z');
 const tracker=createTracker(storage.db,one,{clock:()=>when});
 const other=createTracker(storage.db,two,{clock:()=>when});
 const events=account=>storage.db.prepare('SELECT kind,detail,source,day FROM wpp_events WHERE account_id=? ORDER BY id').all(account);
 try{
  assert.throws(()=>createTracker(storage.db,'x'));
  tracker.syncAll([{id:'g@g.us',subject:'Promo',participants:[person(1,{admin:'admin'}),person(2),person(3)]}],['1']);
  assert.equal(events(one).length,0,'first sync is a baseline, not joins');
  assert.equal(storage.db.prepare('SELECT is_admin FROM wpp_groups WHERE account_id=?').get(one).is_admin,1);
  when=new Date('2026-11-11T15:00:00Z');
  tracker.syncAll([{id:'g@g.us',subject:'Promo',participants:[person(1),person(2),person(4)]}],['1']);
  assert.deepEqual(events(one).map(e=>`${e.kind}:${e.detail}:${e.day}`),['join:detected:2026-11-11','leave:detected:2026-11-11']);
  assert.equal(tracker.handleParticipants({id:'g@g.us',author:'5@lid',participants:[person(5)],action:'add'}),1);
  assert.equal(tracker.handleParticipants({id:'g@g.us',author:'1@lid',participants:[person(2)],action:'remove'}),1);
  assert.deepEqual(events(one).slice(2).map(e=>`${e.kind}:${e.detail}:${e.source}`),['join:joined:live','leave:removed:live']);
  assert.equal(tracker.handleParticipants({id:'g@g.us',author:'5@lid',participants:[person(5)],action:'add'}),0,'repeat is ignored');
  tracker.syncAll([{id:'g@g.us',subject:'Promo',participants:[person(1),person(4),person(5)]}],['1']);
  assert.equal(events(one).length,4,'sync does not repeat what live events already recorded');
  assert.equal(tracker.handleParticipants({id:'g@g.us',author:'1@lid',participants:[person(4)],action:'promote'}),0);
  assert.equal(tracker.handleParticipants({id:'unknown@g.us',author:'1@lid',participants:[person(9)],action:'add'}),0);
  // outro número vê o mesmo grupo: histórico totalmente independente
  assert.equal(other.handleParticipants({id:'g@g.us',author:'1@lid',participants:[person(8)],action:'add'}),0,'group unknown to this account');
  other.syncAll([{id:'g@g.us',subject:'Promo',participants:[person(1),person(4)]}],[]);
  assert.equal(events(two).length,0);
  assert.equal(storage.db.prepare('SELECT size FROM wpp_groups WHERE account_id=?').get(two).size,2);
  assert.equal(storage.db.prepare('SELECT size FROM wpp_groups WHERE account_id=?').get(one).size,3);
  tracker.syncAll([],['1']);
  assert.equal(storage.db.prepare('SELECT active FROM wpp_groups WHERE account_id=?').get(one).active,0);
  assert.equal(storage.db.prepare('SELECT active FROM wpp_groups WHERE account_id=?').get(two).active,1,'other account unaffected');
  assert.equal(saoPauloDay(new Date('2026-11-11T02:30:00Z')),'2026-11-10','uses America/Sao_Paulo calendar');
 }finally{storage.close();await rm(dir,{recursive:true,force:true});}
});

test('version 1 data (single number) migrates to account 1 without losing anything',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'grupos-migrate-'));
 const db=new DatabaseSync(join(dir,'x.sqlite'));
 db.exec(`PRAGMA journal_mode=WAL;
  CREATE TABLE wpp_groups (id TEXT PRIMARY KEY, name TEXT NOT NULL, size INTEGER NOT NULL DEFAULT 0, is_admin INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, updated INTEGER NOT NULL);
  CREATE TABLE wpp_members (group_id TEXT NOT NULL, member_id TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', PRIMARY KEY(group_id, member_id));
  CREATE TABLE wpp_events (id INTEGER PRIMARY KEY AUTOINCREMENT, group_id TEXT NOT NULL, member_id TEXT, phone TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL CHECK(kind IN ('join','leave')), detail TEXT NOT NULL, source TEXT NOT NULL, ts INTEGER NOT NULL, day TEXT NOT NULL);
  CREATE INDEX wpp_events_group_day ON wpp_events(group_id, day);
  CREATE TABLE wpp_daily_size (group_id TEXT NOT NULL, day TEXT NOT NULL, size INTEGER NOT NULL, PRIMARY KEY(group_id, day));
  CREATE TABLE wpp_collector (id INTEGER PRIMARY KEY CHECK(id=1), state TEXT NOT NULL DEFAULT 'stopped', qr_svg TEXT, account TEXT, groups_count INTEGER NOT NULL DEFAULT 0, last_sync INTEGER, heartbeat INTEGER, error TEXT, command TEXT, command_at INTEGER);
  INSERT INTO wpp_collector (id,state,account,groups_count,last_sync) VALUES (1,'open','5511999990000',2,123);
  INSERT INTO wpp_groups VALUES ('a@g.us','A',3,1,1,10),('b@g.us','B',1,0,1,10);
  INSERT INTO wpp_members VALUES ('a@g.us','1@lid','1'),('a@g.us','2@lid','2'),('b@g.us','3@lid','3');
  INSERT INTO wpp_events (group_id,member_id,phone,kind,detail,source,ts,day) VALUES ('a@g.us','m1','1','join','joined','live',5,'2026-11-10'),('a@g.us','m2','2','leave','left','live',6,'2026-11-10');
  INSERT INTO wpp_daily_size VALUES ('a@g.us','2026-11-10',3);`);
 try{
  ensureSchema(db);
  ensureSchema(db); // idempotente
  assert.deepEqual(db.prepare('SELECT id,name,state,phone,groups_count,last_sync FROM wpp_accounts').all().map(r=>({...r})),[{id:1,name:'Número 1',state:'open',phone:'5511999990000',groups_count:2,last_sync:123}]);
  assert.deepEqual(db.prepare('SELECT account_id,id,name,size FROM wpp_groups ORDER BY id').all().map(r=>({...r})),[{account_id:1,id:'a@g.us',name:'A',size:3},{account_id:1,id:'b@g.us',name:'B',size:1}]);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM wpp_members WHERE account_id=1').get().n,3);
  assert.deepEqual(db.prepare('SELECT account_id,kind,day FROM wpp_events ORDER BY id').all().map(r=>({...r})),[{account_id:1,kind:'join',day:'2026-11-10'},{account_id:1,kind:'leave',day:'2026-11-10'}]);
  assert.equal(db.prepare('SELECT size FROM wpp_daily_size WHERE account_id=1').get().size,3);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name LIKE 'wpp_%_v1'").get().n,0,'old tables dropped');
  // o tracker continua a partir dos dados migrados, sem recriar o "baseline"
  const tracker=createTracker(db,1,{clock:()=>new Date('2026-11-11T15:00:00Z')});
  tracker.syncAll([{id:'a@g.us',subject:'A',participants:[person(1),person(2),person(7)]}],[]);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM wpp_events WHERE day='2026-11-11'").get().n,1);
 }finally{db.close();await rm(dir,{recursive:true,force:true});}
});

test('WhatsApp groups app: shared login, admin-only, private files hidden, several numbers, persisted numbers',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'grupos-app-'));
 const env={APP_ORIGIN:'https://workspace.example',ADMIN_EMAIL:'admin@example.com',ADMIN_PASSWORD_HASH:await hashPassword('grupos-test-password')};
 const storage=openStorage(dir,'b'.repeat(64));
 const server=createAppServer({env,storage,authStore:storage.store('auth'),googleAds:{configured:()=>false},roiOptions:{autoSync:false}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port;
 let cookie;
 const send=(path,method='GET',body,origin=env.APP_ORIGIN)=>fetch(base+path,{method,redirect:'manual',headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const json=async(...args)=>(await send(...args)).json();
 const login=async(email,password)=>{const r=await send('/api/login','POST',{email,password});assert.equal(r.status,200);cookie=r.headers.get('set-cookie').split(';')[0];};
 const A='/apps/grupos/api/';
 try{
  // sem sessão
  assert.equal((await send('/apps/grupos/')).headers.get('location'),'/login');
  for(const path of [A+'summary',A+'accounts',A+'group?account=1&id=x'])assert.equal((await send(path)).status,401);
  for(const [path,method] of [[A+'accounts','POST'],[A+'accounts/1/command','POST'],[A+'accounts/1/rename','POST'],[A+'accounts/1','DELETE']])assert.equal((await send(path,method,{name:'x',command:'sync'})).status,401,path);
  for(const path of ['/apps/grupos/private/index.html','/apps/grupos/private/grupo.html','/apps/grupos/api.mjs','/apps/grupos/schema.mjs','/apps/grupos/tracker.mjs','/apps/grupos/collector/collector.mjs','/apps/grupos/collector/package.json','/runtime.env','/data/adstudio.sqlite','/apps/grupos/public/app.js'])assert.equal((await send(path)).status,404,path);
  assert.equal((await send('/apps/grupos/grupo')).headers.get('location'),'/login','group page needs a session');
  for(const file of ['app.js','grupo.js','common.js'])assert.equal((await send('/apps/grupos/'+file)).status,200,file);
  assert.equal((await send('/apps/grupos/style.css')).status,200);

  await login(env.ADMIN_EMAIL,'grupos-test-password');
  assert.equal((await send('/apps/grupos')).headers.get('location'),'/apps/grupos/');
  const page=await (await send('/apps/grupos/')).text();
  assert.match(page,/Todas as aplicações/);assert.match(page,/Adicionar número/);
  assert.match(await (await send('/')).text(),/href="\/apps\/grupos\/"/);
  assert.equal((await send('/apps/criativos/')).status,200,'studio untouched');
  assert.equal((await send('/apps/financas/')).status,200,'finance untouched');
  assert.equal((await send('/apps/grupos/','POST')).status,405);
  const groupPage=await send('/apps/grupos/grupo?account=1&id=x');
  assert.equal(groupPage.status,200);assert.match(await groupPage.text(),/ANÁLISE DO GRUPO/);
  assert.equal((await send('/apps/grupos/grupo','POST')).status,405);

  // números: criar, validar, renomear
  assert.deepEqual((await json(A+'accounts')).accounts,[]);
  assert.equal((await send(A+'accounts','POST',{name:'  '})).status,400);
  assert.equal((await send(A+'accounts','POST',{name:'x'.repeat(41)})).status,400);
  assert.equal((await send(A+'accounts','POST',{name:'Um'},'https://evil.example')).status,403);
  const one=await send(A+'accounts','POST',{name:'  Promoções   1 '});assert.equal(one.status,201);
  const id1=(await one.json()).id;
  const id2=(await json(A+'accounts','POST',{name:'Promoções 2'})).id;
  assert.equal((await send(A+'accounts','POST',{name:'promoções 1'})).status,409,'duplicate names rejected');
  assert.equal((await send(A+`accounts/${id2}/rename`,'POST',{name:'PROMOÇÕES 1'})).status,409);
  assert.equal((await send(A+`accounts/${id2}/rename`,'POST',{name:'Cupons'})).status,200);
  assert.equal((await send(A+'accounts/999/rename','POST',{name:'Z'})).status,404);
  let list=await json(A+'accounts');
  assert.deepEqual(list.accounts.map(a=>a.name),['Promoções 1','Cupons']);
  assert.equal(list.collectorOnline,false);assert.deepEqual(list.accounts.map(a=>a.state),['stopped','stopped']);

  // dados coletados por dois números (um grupo aparece nos dois)
  const t1=createTracker(storage.db,id1),t2=createTracker(storage.db,id2);
  const group=(subject,list,id=subject+'@g.us')=>({id,subject,participants:list});
  t1.syncAll([group('A',[person(1),person(2),person(3)]),group('B',[person(7)])],[]);
  t2.syncAll([group('A',[person(1),person(2),person(3),person(4)],'A@g.us'),group('C',[person(8),person(9)])],[]);
  t1.handleParticipants({id:'A@g.us',author:'1@lid',participants:[person(4)],action:'add'});
  t1.handleParticipants({id:'A@g.us',author:'2@lid',participants:[person(2)],action:'remove'});
  t1.handleParticipants({id:'A@g.us',author:'1@lid',participants:[person(3)],action:'remove'});
  t2.handleParticipants({id:'C@g.us',author:'8@lid',participants:[person(5)],action:'add'});
  const all=await json(A+'summary?days=7');
  assert.equal(all.groups.length,4);assert.equal(all.account,null);
  assert.deepEqual(all.groups.filter(g=>g.id==='A@g.us').map(g=>g.shared),[true,true]);
  assert.equal(all.totals.groups,3,'shared group counted once');
  assert.equal(all.totals.members,4+1+3,'A counted from the larger copy (4), plus B (1) and C (3)');
  const only1=await json(A+`summary?days=7&account=${id1}`);
  assert.deepEqual(only1.groups.map(g=>g.name).sort(),['A','B']);
  const a1=only1.groups.find(g=>g.name==='A');assert.deepEqual([a1.size,a1.joinedToday,a1.leftToday],[2,1,2]);
  assert.deepEqual([only1.totals.groups,only1.totals.members,only1.totals.joinedToday,only1.totals.leftToday,only1.totals.netWeek],[2,3,1,2,-1]);
  // filtro por administrador
  storage.db.prepare("UPDATE wpp_groups SET is_admin=1 WHERE account_id=? AND id='B@g.us'").run(id1);
  const mine=await json(A+'summary?days=7&admin=yes');
  assert.deepEqual(mine.groups.map(g=>g.name),['B']);assert.equal(mine.admin,'yes');
  assert.deepEqual([mine.totals.groups,mine.totals.members],[1,1],'totals follow the admin filter');
  const notMine=await json(A+`summary?days=7&admin=no&account=${id1}`);
  assert.deepEqual(notMine.groups.map(g=>g.name),['A']);
  assert.equal((await json(A+'summary?days=7&admin=all')).groups.length,4);
  assert.equal((await send(A+'summary?admin=talvez')).status,400);
  // dia de referência: ontem (entradas/saídas e tamanho ao fim do dia)
  const yday=saoPauloDay(new Date(Date.now()-86400000));
  const ev=storage.db.prepare("INSERT INTO wpp_events (account_id,group_id,member_id,phone,kind,detail,source,ts,day) VALUES (?,?,?,?,?,?,?,?,?)");
  for(const [kind,m] of [['join','x1'],['join','x2'],['leave','x3']])ev.run(id1,'B@g.us',m,'5511900000000',kind,kind==='join'?'joined':'left','live',1,yday);
  storage.db.prepare('INSERT INTO wpp_daily_size (account_id,group_id,day,size) VALUES (?,?,?,5)').run(id1,'B@g.us',yday);
  const y=await json(A+`summary?days=7&account=${id1}&date=yesterday`);
  assert.deepEqual([y.date,y.isToday],[yday,false]);
  const yB=y.groups.find(g=>g.name==='B'),yA=y.groups.find(g=>g.name==='A');
  assert.deepEqual([yB.size,yB.joinedToday,yB.leftToday,yB.joinedWeek,yB.leftWeek],[5,2,1,2,1]);
  assert.deepEqual([yA.size,yA.joinedToday,yA.leftToday,yA.joinedWeek],[null,0,0,0],'today events and unknown size do not leak into yesterday');
  assert.deepEqual([y.totals.members,y.totals.joinedToday,y.totals.leftToday,y.totals.netWeek],[5,2,1,1]);
  assert.deepEqual((await json(A+`summary?days=7&account=${id1}&date=${yday}`)).groups,y.groups,'explicit date equals yesterday');
  const nowRef=await json(A+`summary?days=7&account=${id1}`);
  assert.equal(nowRef.isToday,true);assert.equal(nowRef.groups.find(g=>g.name==='B').size,1,'today uses the current size');
  for(const bad of ['2999-01-01','2026-02-30','abc','2000-01-01','2026-1-1'])assert.equal((await send(A+'summary?date='+bad)).status,400,bad);
  const only2=await json(A+`summary?days=30&account=${id2}`);
  assert.equal(only2.groups.length,2);assert.equal(only2.totals.joinedToday,1);
  assert.equal((await send(A+'summary?account=abc')).status,400);
  assert.equal((await send(A+'summary?days=0')).status,400);
  for(const days of ['366','abc','1.5'])assert.equal((await send(A+'summary?days='+days)).status,400);

  const detail=await json(A+`group?account=${id1}&id=${encodeURIComponent('A@g.us')}&days=3`);
  assert.equal(detail.series.length,3);
  assert.deepEqual(detail.series.at(-1),{day:saoPauloDay(),joined:1,left:2,size:2});
  assert.equal(detail.recent.length,3);assert.equal(detail.group.accountId,id1);
  assert.deepEqual([detail.group.isAdmin,detail.group.accountName,detail.group.alsoIn],[false,'Promoções 1',['Cupons']],'group page shows number, admin flag and other numbers');
  assert.doesNotMatch(JSON.stringify(detail),/55119000000[0-9]/,'phones are masked');
  assert.match(detail.recent[0].phone,/•••••/);
  assert.equal((await send(A+'group?id=A%40g.us')).status,400,'account required');
  assert.equal((await send(A+`group?account=${id1}&id=C%40g.us`)).status,404,'group belongs to the other number');

  // coletor e comandos por número
  assert.equal((await send(A+`accounts/${id1}/command`,'POST',{command:'sync'})).status,409,'collector offline');
  const beat=Math.floor(Date.now()/1000);
  storage.db.prepare("UPDATE wpp_collector SET heartbeat=? WHERE id=1").run(beat);
  storage.db.prepare("UPDATE wpp_accounts SET state='qr',qr_svg='<svg/>' WHERE id=?").run(id1);
  storage.db.prepare("UPDATE wpp_accounts SET state='open',phone='5511999990000',groups_count=2 WHERE id=?").run(id2);
  list=await json(A+'accounts');
  assert.equal(list.collectorOnline,true);
  const [q1,q2]=list.accounts;
  assert.deepEqual([q1.state,q1.qrSvg],['qr','<svg/>']);
  assert.deepEqual([q2.state,q2.qrSvg,q2.phone],['open',null,'5511•••••000']);
  assert.equal((await send(A+`accounts/${id1}/command`,'POST',{command:'sync'},'https://evil.example')).status,403);
  assert.equal((await send(A+`accounts/${id1}/command`,'POST',{command:'rm -rf'})).status,400);
  assert.equal((await send(A+'accounts/999/command','POST',{command:'sync'})).status,404);
  assert.equal((await send(A+`accounts/${id2}/command`,'POST',{command:'relink'})).status,200);
  assert.equal(storage.db.prepare('SELECT command FROM wpp_accounts WHERE id=?').get(id2).command,'relink');
  assert.equal(storage.db.prepare('SELECT command FROM wpp_accounts WHERE id=?').get(id1).command,null,'commands are per number');
  storage.db.prepare('UPDATE wpp_collector SET heartbeat=? WHERE id=1').run(beat-600);
  const stale=await json(A+'accounts');
  assert.deepEqual([stale.collectorOnline,stale.accounts[0].state,stale.accounts[0].qrSvg],[false,'stopped',null],'stale heartbeat means offline and hides the QR');

  // remover = arquivar (histórico preservado, número some das listas e dos totais)
  assert.equal((await send(A+`accounts/${id2}`,'DELETE')).status,200);
  assert.equal((await send(A+`accounts/${id2}`,'DELETE')).status,404);
  assert.deepEqual((await json(A+'accounts')).accounts.map(a=>a.id),[id1]);
  const after=await json(A+'summary?days=7');
  assert.deepEqual(after.groups.map(g=>g.name).sort(),['A','B']);
  assert.equal(storage.db.prepare('SELECT COUNT(*) n FROM wpp_groups WHERE account_id=?').get(id2).n,2,'history kept');
  for(let i=0;i<9;i++)assert.equal((await send(A+'accounts','POST',{name:'N'+i})).status,201);
  assert.equal((await send(A+'accounts','POST',{name:'Excedente'})).status,409,'limit of 10 numbers');

  // usuários leitores não acessam
  const admin=cookie;
  const created=await send('/api/users','POST',{name:'Leitor',email:'leitor@example.com',password:'leitor-test-password-1',active:true,role:'reader',grants:[],whatsapp_sites:['sitea.com.br']});
  assert.equal(created.status,200);
  cookie=undefined;await login('leitor@example.com','leitor-test-password-1');
  for(const path of ['/apps/grupos/',A+'summary',A+'accounts'])assert.equal((await send(path)).status,403,path);
  assert.equal((await send(A+'accounts','POST',{name:'Intruso'})).status,403);
  assert.equal((await send(A+`accounts/${id1}`,'DELETE')).status,403);
  cookie=admin;

  // persistência após reiniciar
  await new Promise(r=>server.close(r));storage.close();
  const again=openStorage(dir,'b'.repeat(64));
  ensureSchema(again.db);
  assert.equal(again.db.prepare('SELECT COUNT(*) n FROM wpp_events').get().n,7);
  assert.equal(again.db.prepare('SELECT COUNT(*) n FROM wpp_groups').get().n,4);
  assert.equal(again.db.prepare('SELECT COUNT(*) n FROM wpp_accounts').get().n,11);
  again.close();
 }finally{if(server.listening)await new Promise(r=>server.close(r));try{storage.close();}catch{}await rm(dir,{recursive:true,force:true}).catch(()=>{});}
});
