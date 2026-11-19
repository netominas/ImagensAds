import {authJSON,sameOrigin} from '../../lib/auth.mjs';
import {ensureSchema} from './schema.mjs';
import {saoPauloDay} from './tracker.mjs';

const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const ONLINE_SECONDS=90;
const mask=phone=>phone&&phone.length>6?phone.slice(0,4)+'•••••'+phone.slice(-3):phone||'';
const camel=row=>Object.fromEntries(Object.entries(row).map(([k,v])=>[k.replace(/_(\w)/g,(_,c)=>c.toUpperCase()),v]));

function lastDays(n,clock){
 const days=[];
 for(let i=n-1;i>=0;i--)days.push(saoPauloDay(new Date(clock().getTime()-i*86400000)));
 return days;
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

 function collectorStatus(){
  const row=db.prepare('SELECT * FROM wpp_collector WHERE id=1').get();
  const online=!!row.heartbeat&&nowSeconds()-row.heartbeat<ONLINE_SECONDS;
  return {online,state:online?row.state:'stopped',qrSvg:online&&row.state==='qr'?row.qr_svg:null,
   account:online&&row.account?mask(row.account):null,groupsCount:row.groups_count,lastSync:row.last_sync,error:row.error,pendingCommand:row.command||null};
 }

 function summary(days){
  const list=lastDays(days,clock),today=list[list.length-1],week=lastDays(7,clock)[0],from=list[0];
  const groups=db.prepare('SELECT id,name,size,is_admin FROM wpp_groups WHERE active=1 ORDER BY size DESC,name').all();
  const sums=new Map(db.prepare(`SELECT group_id,
    SUM(kind='join' AND day=?) AS joined_today, SUM(kind='leave' AND day=?) AS left_today,
    SUM(kind='join' AND day>=?) AS joined_week, SUM(kind='leave' AND day>=?) AS left_week,
    SUM(kind='join' AND day>=?) AS joined_period, SUM(kind='leave' AND day>=?) AS left_period
    FROM wpp_events GROUP BY group_id`).all(today,today,week,week,from,from).map(r=>[r.group_id,r]));
  const rows=groups.map(g=>{
   const s=sums.get(g.id)||{};
   return {id:g.id,name:g.name,size:g.size,isAdmin:!!g.is_admin,joinedToday:s.joined_today||0,leftToday:s.left_today||0,
    joinedWeek:s.joined_week||0,leftWeek:s.left_week||0,joinedPeriod:s.joined_period||0,leftPeriod:s.left_period||0};
  });
  const totals=rows.reduce((a,g)=>({groups:a.groups+1,members:a.members+g.size,joinedToday:a.joinedToday+g.joinedToday,
   leftToday:a.leftToday+g.leftToday,netWeek:a.netWeek+g.joinedWeek-g.leftWeek,netPeriod:a.netPeriod+g.joinedPeriod-g.leftPeriod}),
   {groups:0,members:0,joinedToday:0,leftToday:0,netWeek:0,netPeriod:0});
  return {days,collector:collectorStatus(),totals,groups:rows};
 }

 function detail(id,days){
  const group=db.prepare('SELECT id,name,size FROM wpp_groups WHERE id=?').get(id);
  if(!group)fail('Grupo não encontrado.',404);
  const list=lastDays(days,clock);
  const moves=new Map(db.prepare(`SELECT day,SUM(kind='join') AS joined,SUM(kind='leave') AS left
   FROM wpp_events WHERE group_id=? AND day>=? GROUP BY day`).all(id,list[0]).map(r=>[r.day,r]));
  const sizes=db.prepare('SELECT day,size FROM wpp_daily_size WHERE group_id=? ORDER BY day').all(id);
  const sizeMap=new Map(sizes.map(s=>[s.day,s.size]));
  let last=sizes.filter(s=>s.day<list[0]).pop()?.size??null; // dia sem registro repete o último valor conhecido
  const series=list.map(day=>{
   if(sizeMap.has(day))last=sizeMap.get(day);
   return {day,joined:moves.get(day)?.joined||0,left:moves.get(day)?.left||0,size:last};
  });
  const recent=db.prepare(`SELECT kind,detail,phone,source,ts FROM wpp_events WHERE group_id=?
   ORDER BY ts DESC,id DESC LIMIT 50`).all(id).map(r=>({...r,phone:mask(r.phone)}));
  return {group:camel(group),series,recent};
 }

 function command(data){
  if(!data||typeof data!=='object'||!['sync','relink'].includes(data.command))fail('Comando inválido.');
  if(!collectorStatus().online)fail('O coletor está desligado.',409);
  db.prepare('UPDATE wpp_collector SET command=?,command_at=? WHERE id=1').run(data.command,nowSeconds());
  return {ok:true};
 }

 return async request=>{
  const url=new URL(request.url),path=url.pathname,method=request.method;
  if(!['GET','HEAD'].includes(method)&&!sameOrigin(request))return authJSON({error:'Origem não permitida.'},403);
  try{
   if(path==='/apps/grupos/api/summary'&&method==='GET')return authJSON(summary(daysParam(url)));
   if(path==='/apps/grupos/api/group'&&method==='GET')return authJSON(detail(url.searchParams.get('id')||'',daysParam(url)));
   if(path==='/apps/grupos/api/collector'&&method==='GET')return authJSON(collectorStatus());
   if(path==='/apps/grupos/api/collector/command'&&method==='POST'){
    let data;try{data=await request.json();}catch{fail('Dados inválidos.');}
    return authJSON(command(data));
   }
   return authJSON({error:'Não encontrado.'},404);
  }catch(error){
   return authJSON({error:error.status?error.message:'Não foi possível concluir a operação.'},error.status||500);
  }
 };
}
