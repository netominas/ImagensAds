import {authJSON,sameOrigin} from '../../lib/auth.mjs';
import {ensureSchema} from './schema.mjs';
import {saoPauloDay} from './tracker.mjs';

const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const ONLINE_SECONDS=90;
export const MAX_ACCOUNTS=10;
const mask=phone=>phone&&phone.length>6?phone.slice(0,4)+'•••••'+phone.slice(-3):phone||'';
const camel=row=>Object.fromEntries(Object.entries(row).map(([k,v])=>[k.replace(/_(\w)/g,(_,c)=>c.toUpperCase()),v]));

function lastDays(n,clock){
 const days=[];
 for(let i=n-1;i>=0;i--)days.push(saoPauloDay(new Date(clock().getTime()-i*86400000)));
 return days;
}
function cleanName(value){
 const name=typeof value==='string'?value.replace(/\s+/g,' ').trim():'';
 if(!name||name.length>40||/[\u0000-\u001f]/.test(name))fail('Informe um nome de até 40 caracteres.');
 return name;
}

export function createGruposAPI(storage,{clock=()=>new Date()}={}){
 const db=storage.db;
 ensureSchema(db);
 const nowSeconds=()=>Math.floor(clock().getTime()/1000);

 function daysParam(url){
  const raw=url.searchParams.get('days');
  if(raw===null)return 30;
  const n=Number(raw);
  if(!Number.isInteger(n)||n<1||n>365)fail('Período inválido (1 a 365 dias).');
  return n;
 }
 function accountId(value,{required=true}={}){
  if(value===null||value===''||value==='all'){if(required&&value!=='all')fail('Informe o número.');return null;}
  if(!/^\d{1,9}$/.test(String(value)))fail('Número inválido.');
  return Number(value);
 }

 const processOnline=()=>{
  const row=db.prepare('SELECT heartbeat FROM wpp_collector WHERE id=1').get();
  return !!row?.heartbeat&&nowSeconds()-row.heartbeat<ONLINE_SECONDS;
 };
 function accountView(row,online){
  const live=online?row.state:'stopped';
  return {id:row.id,name:row.name,state:live,online,qrSvg:online&&row.state==='qr'?row.qr_svg:null,
   phone:row.phone?mask(row.phone):null,groupsCount:row.groups_count,lastSync:row.last_sync,error:row.error,
   pendingCommand:row.command||null,created:row.created};
 }
 function accounts(){
  const online=processOnline();
  return {collectorOnline:online,max:MAX_ACCOUNTS,
   accounts:db.prepare('SELECT * FROM wpp_accounts WHERE removed=0 ORDER BY id').all().map(r=>accountView(r,online))};
 }
 function activeAccount(id){
  const row=db.prepare('SELECT * FROM wpp_accounts WHERE id=? AND removed=0').get(id);
  if(!row)fail('Número não encontrado.',404);
  return row;
 }

 function adminParam(url){
  const raw=url.searchParams.get('admin')??'all';
  if(!['all','yes','no'].includes(raw))fail('Filtro de administrador inválido.');
  return raw;
 }

 function summary(days,account,admin='all'){
  const list=lastDays(days,clock),today=list[list.length-1],week=lastDays(7,clock)[0],from=list[0];
  const rows0=db.prepare(`SELECT g.account_id,g.id,g.name,g.size,g.is_admin,a.name AS account_name
   FROM wpp_groups g JOIN wpp_accounts a ON a.id=g.account_id
   WHERE g.active=1 AND a.removed=0 ORDER BY g.size DESC,g.name`).all();
  const sums=new Map(db.prepare(`SELECT account_id,group_id,
    SUM(kind='join' AND day=?) AS joined_today, SUM(kind='leave' AND day=?) AS left_today,
    SUM(kind='join' AND day>=?) AS joined_week, SUM(kind='leave' AND day>=?) AS left_week,
    SUM(kind='join' AND day>=?) AS joined_period, SUM(kind='leave' AND day>=?) AS left_period
    FROM wpp_events WHERE day>=? GROUP BY account_id,group_id`).all(today,today,week,week,from,from,from<week?from:week)
    .map(r=>[r.account_id+'|'+r.group_id,r]));
  const copies=new Map();
  for(const g of rows0)copies.set(g.id,(copies.get(g.id)||0)+1);
  const all=rows0.map(g=>{
   const s=sums.get(g.account_id+'|'+g.id)||{};
   return {accountId:g.account_id,accountName:g.account_name,id:g.id,name:g.name,size:g.size,isAdmin:!!g.is_admin,
    shared:copies.get(g.id)>1,joinedToday:s.joined_today||0,leftToday:s.left_today||0,
    joinedWeek:s.joined_week||0,leftWeek:s.left_week||0,joinedPeriod:s.joined_period||0,leftPeriod:s.left_period||0};
  });
  const rows=all.filter(g=>(account===null||g.accountId===account)&&(admin==='all'||g.isAdmin===(admin==='yes')));
  // Totais não repetem um grupo que aparece em mais de um número: vale o registro de maior tamanho.
  const seen=new Set(),totals={groups:0,members:0,joinedToday:0,leftToday:0,netWeek:0,netPeriod:0};
  for(const g of [...rows].sort((a,b)=>b.size-a.size)){
   if(seen.has(g.id))continue;seen.add(g.id);
   totals.groups++;totals.members+=g.size;totals.joinedToday+=g.joinedToday;totals.leftToday+=g.leftToday;
   totals.netWeek+=g.joinedWeek-g.leftWeek;totals.netPeriod+=g.joinedPeriod-g.leftPeriod;
  }
  return {days,account,admin,...accounts(),totals,groups:rows};
 }

 function detail(account,id,days){
  const group=db.prepare('SELECT id,name,size,is_admin FROM wpp_groups WHERE account_id=? AND id=?').get(account,id);
  if(!group)fail('Grupo não encontrado.',404);
  const accountName=db.prepare('SELECT name FROM wpp_accounts WHERE id=?').get(account)?.name||'';
  const alsoIn=db.prepare(`SELECT a.name FROM wpp_groups g JOIN wpp_accounts a ON a.id=g.account_id
   WHERE g.id=? AND g.account_id<>? AND g.active=1 AND a.removed=0 ORDER BY a.id`).all(id,account).map(r=>r.name);
  const list=lastDays(days,clock);
  const moves=new Map(db.prepare(`SELECT day,SUM(kind='join') AS joined,SUM(kind='leave') AS left
   FROM wpp_events WHERE account_id=? AND group_id=? AND day>=? GROUP BY day`).all(account,id,list[0]).map(r=>[r.day,r]));
  const sizes=db.prepare('SELECT day,size FROM wpp_daily_size WHERE account_id=? AND group_id=? ORDER BY day').all(account,id);
  const sizeMap=new Map(sizes.map(s=>[s.day,s.size]));
  let last=sizes.filter(s=>s.day<list[0]).pop()?.size??null; // dia sem registro repete o último valor conhecido
  const series=list.map(day=>{
   if(sizeMap.has(day))last=sizeMap.get(day);
   return {day,joined:moves.get(day)?.joined||0,left:moves.get(day)?.left||0,size:last};
  });
  const recent=db.prepare(`SELECT kind,detail,phone,source,ts FROM wpp_events WHERE account_id=? AND group_id=?
   ORDER BY ts DESC,id DESC LIMIT 100`).all(account,id).map(r=>({...r,phone:mask(r.phone)}));
  const {isAdmin,...rest}=camel(group);
  return {group:{...rest,isAdmin:!!isAdmin,accountId:account,accountName,alsoIn},series,recent};
 }

 function createAccount(data){
  if(!data||typeof data!=='object')fail('Dados inválidos.');
  const name=cleanName(data.name);
  const current=db.prepare('SELECT name FROM wpp_accounts WHERE removed=0').all();
  if(current.length>=MAX_ACCOUNTS)fail(`Limite de ${MAX_ACCOUNTS} números atingido.`,409);
  if(current.some(a=>a.name.toLowerCase()===name.toLowerCase()))fail('Já existe um número com esse nome.',409);
  const result=db.prepare("INSERT INTO wpp_accounts (name,state,created) VALUES (?,'connecting',?)").run(name,nowSeconds());
  return {id:Number(result.lastInsertRowid),name};
 }
 function renameAccount(id,data){
  activeAccount(id);
  const name=cleanName(data?.name);
  const others=db.prepare('SELECT name FROM wpp_accounts WHERE removed=0 AND id<>?').all(id);
  if(others.some(a=>a.name.toLowerCase()===name.toLowerCase()))fail('Já existe um número com esse nome.',409);
  db.prepare('UPDATE wpp_accounts SET name=? WHERE id=?').run(name,id);
  return {ok:true};
 }
 function command(id,data){
  activeAccount(id);
  if(!data||typeof data!=='object'||!['sync','relink'].includes(data.command))fail('Comando inválido.');
  if(!processOnline())fail('O coletor está desligado.',409);
  db.prepare('UPDATE wpp_accounts SET command=?,command_at=? WHERE id=?').run(data.command,nowSeconds(),id);
  return {ok:true};
 }
 // Remover = arquivar: o coletor desconecta e apaga a sessão; o histórico fica guardado no banco.
 function removeAccount(id){
  activeAccount(id);
  db.prepare('UPDATE wpp_accounts SET removed=1,command=NULL,qr_svg=NULL WHERE id=?').run(id);
  return {ok:true};
 }

 return async request=>{
  const url=new URL(request.url),path=url.pathname,method=request.method;
  if(!['GET','HEAD'].includes(method)&&!sameOrigin(request))return authJSON({error:'Origem não permitida.'},403);
  const body=async()=>{try{return await request.json();}catch{return fail('Dados inválidos.');}};
  try{
   if(method==='GET'){
    if(path==='/apps/grupos/api/summary')return authJSON(summary(daysParam(url),accountId(url.searchParams.get('account')??'all'),adminParam(url)));
    if(path==='/apps/grupos/api/group')return authJSON(detail(accountId(url.searchParams.get('account')),url.searchParams.get('id')||'',daysParam(url)));
    if(path==='/apps/grupos/api/accounts')return authJSON(accounts());
   }
   if(path==='/apps/grupos/api/accounts'&&method==='POST')return authJSON(createAccount(await body()),201);
   const match=path.match(/^\/apps\/grupos\/api\/accounts\/(\d{1,9})(?:\/(command|rename))?$/);
   if(match){
    const id=Number(match[1]);
    if(match[2]==='command'&&method==='POST')return authJSON(command(id,await body()));
    if(match[2]==='rename'&&method==='POST')return authJSON(renameAccount(id,await body()));
    if(!match[2]&&method==='DELETE')return authJSON(removeAccount(id));
   }
   return authJSON({error:'Não encontrado.'},404);
  }catch(error){
   return authJSON({error:error.status?error.message:'Não foi possível concluir a operação.'},error.status||500);
  }
 };
}
