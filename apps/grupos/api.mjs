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
// Soma dias a uma data AAAA-MM-DD (meio-dia UTC evita problemas de fuso/horário de verão).
const addDays=(day,delta)=>new Date(Date.parse(day+'T12:00:00Z')+delta*86400000).toISOString().slice(0,10);
const daysEnding=(end,n)=>Array.from({length:n},(_,i)=>addDays(end,i-(n-1)));
function cleanName(value){
 const name=typeof value==='string'?value.replace(/\s+/g,' ').trim():'';
 if(!name||name.length>40||/[\u0000-\u001f]/.test(name))fail('Informe um nome de até 40 caracteres.');
 return name;
}

export function createGruposAPI(storage,{clock=()=>new Date(),meta=null}={}){
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

 // Dia de referência do relatório (calendário America/Sao_Paulo). Sem o parâmetro, é hoje; aceita "ontem" e AAAA-MM-DD
 // (até 365 dias atrás). "Hoje/Saldo 7 dias/Saldo no período" passam a terminar nesse dia.
 function dateParam(url){
  const today=saoPauloDay(clock()),raw=url.searchParams.get('date');
  if(raw===null||raw===''||raw==='today')return today;
  if(raw==='yesterday')return addDays(today,-1);
  const t=/^\d{4}-\d{2}-\d{2}$/.test(raw)?Date.parse(raw+'T12:00:00Z'):NaN;
  if(!Number.isFinite(t)||new Date(t).toISOString().slice(0,10)!==raw)fail('Data inválida (use AAAA-MM-DD).');
  if(raw>today)fail('A data não pode estar no futuro.');
  if(raw<addDays(today,-365))fail('Data muito antiga (máximo 365 dias atrás).');
  return raw;
 }

 // Agrupamento: "all" (qualquer), "none" (sem agrupamento) ou o ID de um agrupamento.
 function clusterParam(url){
  const raw=url.searchParams.get('cluster')??'all';
  if(raw==='all'||raw==='none')return raw;
  if(!/^\d{1,9}$/.test(raw))fail('Agrupamento inválido.');
  return Number(raw);
 }
 // Totais de uma lista de linhas. Um grupo que aparece em mais de um número conta uma só vez (vale o registro de maior tamanho).
 function rollup(rows){
  const seen=new Set(),totals={groups:0,members:0,joinedToday:0,leftToday:0,netWeek:0,netPeriod:0};
  for(const g of [...rows].sort((a,b)=>(b.size??-1)-(a.size??-1))){
   if(seen.has(g.id))continue;seen.add(g.id);
   totals.groups++;totals.members+=g.size??0;totals.joinedToday+=g.joinedToday;totals.leftToday+=g.leftToday;
   totals.netWeek+=g.joinedWeek-g.leftWeek;totals.netPeriod+=g.joinedPeriod-g.leftPeriod;
  }
  return totals;
 }

 // Todos os grupos ativos (uma linha por grupo e número) com as contagens do dia de referência `ref`.
 function groupRows(days,ref){
  const list=daysEnding(ref,days),today=ref,week=daysEnding(ref,7)[0],from=list[0],isToday=ref===saoPauloDay(clock());
  const rows0=db.prepare(`SELECT g.account_id,g.id,g.name,g.size,g.is_admin,a.name AS account_name
   FROM wpp_groups g JOIN wpp_accounts a ON a.id=g.account_id
   WHERE g.active=1 AND a.removed=0 ORDER BY g.size DESC,g.name`).all();
  const sums=new Map(db.prepare(`SELECT account_id,group_id,
    SUM(kind='join' AND day=?) AS joined_today, SUM(kind='leave' AND day=?) AS left_today,
    SUM(kind='join' AND day>=?) AS joined_week, SUM(kind='leave' AND day>=?) AS left_week,
    SUM(kind='join' AND day>=?) AS joined_period, SUM(kind='leave' AND day>=?) AS left_period
    FROM wpp_events WHERE day>=? AND day<=? GROUP BY account_id,group_id`).all(today,today,week,week,from,from,from<week?from:week,ref)
    .map(r=>[r.account_id+'|'+r.group_id,r]));
  // Em dias passados, "membros" é o tamanho ao fim daquele dia (último registro diário até lá); sem registro: null.
  const past=isToday?null:new Map(db.prepare(`SELECT d.account_id,d.group_id,d.size FROM wpp_daily_size d
   WHERE d.day=(SELECT MAX(day) FROM wpp_daily_size WHERE account_id=d.account_id AND group_id=d.group_id AND day<=?)`).all(ref)
   .map(r=>[r.account_id+'|'+r.group_id,r.size]));
  const copies=new Map();
  for(const g of rows0)copies.set(g.id,(copies.get(g.id)||0)+1);
  const clusters=db.prepare('SELECT id,name FROM wpp_clusters ORDER BY name COLLATE NOCASE,id').all();
  const nameOf=new Map(clusters.map(c=>[c.id,c.name]));
  const clusterOf=new Map(db.prepare('SELECT group_id,cluster_id FROM wpp_cluster_groups').all().map(r=>[r.group_id,r.cluster_id]));
  const all=rows0.map(g=>{
   const s=sums.get(g.account_id+'|'+g.id)||{};
   const size=isToday?g.size:(past.get(g.account_id+'|'+g.id)??null);
   const clusterId=clusterOf.get(g.id)??null;
   return {accountId:g.account_id,accountName:g.account_name,id:g.id,name:g.name,size,isAdmin:!!g.is_admin,
    clusterId,clusterName:clusterId==null?null:nameOf.get(clusterId)??null,
    shared:copies.get(g.id)>1,joinedToday:s.joined_today||0,leftToday:s.left_today||0,
    joinedWeek:s.joined_week||0,leftWeek:s.left_week||0,joinedPeriod:s.joined_period||0,leftPeriod:s.left_period||0};
  });
  return {all,clusters,isToday};
 }

 function summary(days,account,admin='all',ref=saoPauloDay(clock()),cluster='all'){
  const {all,clusters,isToday}=groupRows(days,ref);
  const rows=all.filter(g=>(account===null||g.accountId===account)&&(admin==='all'||g.isAdmin===(admin==='yes'))
   &&(cluster==='all'||(cluster==='none'?g.clusterId==null:g.clusterId===cluster)));
  return {days,account,admin,cluster,date:ref,isToday,...accounts(),clusters,totals:rollup(rows),groups:rows};
 }

 // ---------- Agrupamentos ----------
 const MAX_CLUSTERS=200;
 function activeCluster(id){
  const row=db.prepare('SELECT id,name,created FROM wpp_clusters WHERE id=?').get(id);
  if(!row)fail('Agrupamento não encontrado.',404);
  return row;
 }
 function clusterName(value,exceptId=null){
  const name=cleanName(value);
  const others=db.prepare('SELECT name FROM wpp_clusters WHERE id<>?').all(exceptId??-1);
  if(others.some(c=>c.name.toLowerCase()===name.toLowerCase()))fail('Já existe um agrupamento com esse nome.',409);
  return name;
 }
 function clusterList(days,ref){
  const {all,clusters,isToday}=groupRows(days,ref);
  const list=clusters.map(c=>({id:c.id,name:c.name,...rollup(all.filter(g=>g.clusterId===c.id))}));
  return {days,date:ref,isToday,clusters:list,unassigned:rollup(all.filter(g=>g.clusterId==null))};
 }
 function clusterDetail(id,days,ref){
  const cluster=activeCluster(id);
  const {all,isToday}=groupRows(days,ref);
  const groups=all.filter(g=>g.clusterId===id);
  // Candidatos a entrar: cada grupo uma vez só (o vínculo vale para o grupo, em qualquer número em que ele apareça).
  const byId=new Map();
  for(const g of all){
   if(g.clusterId===id)continue;
   const c=byId.get(g.id);
   if(c){c.accounts.push(g.accountName);c.size=Math.max(c.size??-1,g.size??-1);}
   else byId.set(g.id,{id:g.id,name:g.name,size:g.size,accounts:[g.accountName],clusterId:g.clusterId,clusterName:g.clusterName});
  }
  return {cluster:{id:cluster.id,name:cluster.name,created:cluster.created},days,date:ref,isToday,totals:rollup(groups),groups,candidates:[...byId.values()],
   campaigns:db.prepare('SELECT campaign_id AS id,name FROM wpp_campaign_links WHERE cluster_id=? ORDER BY name COLLATE NOCASE').all(id)};
 }
 function createCluster(data){
  if(!data||typeof data!=='object')fail('Dados inválidos.');
  const name=clusterName(data.name);
  if(db.prepare('SELECT COUNT(*) AS n FROM wpp_clusters').get().n>=MAX_CLUSTERS)fail(`Limite de ${MAX_CLUSTERS} agrupamentos atingido.`,409);
  const result=db.prepare('INSERT INTO wpp_clusters (name,created) VALUES (?,?)').run(name,nowSeconds());
  return {id:Number(result.lastInsertRowid),name};
 }
 function renameCluster(id,data){
  activeCluster(id);
  db.prepare('UPDATE wpp_clusters SET name=? WHERE id=?').run(clusterName(data?.name,id),id);
  return {ok:true};
 }
 // Excluir um agrupamento solta os grupos dele (continuam existindo, só ficam sem agrupamento).
 function removeCluster(id){
  activeCluster(id);
  db.exec('BEGIN IMMEDIATE');
  try{
   db.prepare('DELETE FROM wpp_cluster_groups WHERE cluster_id=?').run(id);
   db.prepare('DELETE FROM wpp_campaign_links WHERE cluster_id=?').run(id);
   db.prepare('DELETE FROM wpp_clusters WHERE id=?').run(id);
   db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  return {ok:true};
 }
 function idList(value,label){
  if(value===undefined)return [];
  if(!Array.isArray(value)||value.length>500)fail(`Lista de ${label} inválida (até 500 grupos por vez).`);
  const ids=[...new Set(value)];
  if(ids.some(v=>typeof v!=='string'||!v||v.length>120))fail(`Lista de ${label} inválida.`);
  return ids;
 }
 // Adiciona e/ou remove grupos. Um grupo que já estava em outro agrupamento é movido para este.
 function changeClusterGroups(id,data){
  activeCluster(id);
  if(!data||typeof data!=='object')fail('Dados inválidos.');
  const add=idList(data.add,'grupos a adicionar'),remove=idList(data.remove,'grupos a remover');
  if(!add.length&&!remove.length)fail('Escolha ao menos um grupo.');
  const known=new Set(db.prepare('SELECT DISTINCT id FROM wpp_groups').all().map(r=>r.id));
  if(add.some(g=>!known.has(g)))fail('Grupo não encontrado.',404);
  let added=0,moved=0,removed=0;
  db.exec('BEGIN IMMEDIATE');
  try{
   for(const g of remove)removed+=Number(db.prepare('DELETE FROM wpp_cluster_groups WHERE group_id=? AND cluster_id=?').run(g,id).changes);
   for(const g of add){
    const before=db.prepare('SELECT cluster_id FROM wpp_cluster_groups WHERE group_id=?').get(g);
    if(before?.cluster_id===id)continue;
    db.prepare('INSERT INTO wpp_cluster_groups (group_id,cluster_id,added) VALUES (?,?,?) ON CONFLICT(group_id) DO UPDATE SET cluster_id=excluded.cluster_id,added=excluded.added')
     .run(g,id,nowSeconds());
    if(before)moved++;else added++;
   }
   db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  return {ok:true,added,moved,removed};
 }

 // ---------- Campanhas do Meta (somente leitura) ----------
 const campaignId=value=>{if(!/^\d{1,25}$/.test(String(value)))fail('Campanha inválida.');return String(value);};
 const needMeta=()=>{if(!meta?.configured)fail('A Meta ainda não está configurada neste servidor.',409);};
 const linkMap=()=>new Map(db.prepare('SELECT campaign_id,cluster_id,name FROM wpp_campaign_links').all().map(r=>[r.campaign_id,r]));
 // Campanhas, e a linha diária de cada uma, no período que termina em `ref`.
 async function metaData(days,ref,fresh){
  const since=daysEnding(ref,days)[0];
  const [campaigns,rows]=await Promise.all([meta.campaigns({fresh}),meta.insights(since,ref,{fresh})]);
  return {campaigns,rows};
 }
 const cpl=(spend,leads)=>leads>0?spend/leads:null;
 const money=n=>Math.round(n*100)/100;
 async function campaignList(days,ref,fresh){
  const clusters=db.prepare('SELECT id,name FROM wpp_clusters ORDER BY name COLLATE NOCASE,id').all();
  const base={days,date:ref,isToday:ref===saoPauloDay(clock()),clusters};
  if(!meta?.configured)return {...base,configured:false,campaigns:[]};
  const {campaigns,rows}=await metaData(days,ref,fresh);
  const links=linkMap(),nameOf=new Map(clusters.map(c=>[c.id,c.name]));
  const by=new Map();
  const entry=(id,name,status='')=>{if(!by.has(id))by.set(id,{id,name,status,spend:0,leads:0,spendDay:0,leadsDay:0});return by.get(id);};
  for(const c of campaigns)entry(c.id,c.name,c.status);
  for(const r of rows){
   const e=entry(r.id,r.name);
   e.spend+=r.spend;e.leads+=r.leads;
   if(r.day===ref){e.spendDay+=r.spend;e.leadsDay+=r.leads;}
  }
  for(const [id,l] of links)entry(id,l.name||id);
  const list=[...by.values()].map(e=>{
   const l=links.get(e.id);
   return {...e,spend:money(e.spend),spendDay:money(e.spendDay),cpl:cpl(e.spend,e.leads),
    clusterId:l?l.cluster_id:null,clusterName:l?nameOf.get(l.cluster_id)??null:null};
  });
  return {...base,configured:true,campaigns:list};
 }
 // Liga a campanha a um agrupamento (ou solta, com cluster:null).
 async function setCampaignCluster(id,data){
  if(!data||typeof data!=='object')fail('Dados inválidos.');
  if(data.cluster===null){db.prepare('DELETE FROM wpp_campaign_links WHERE campaign_id=?').run(id);return {ok:true};}
  if(!Number.isInteger(data.cluster))fail('Agrupamento inválido.');
  activeCluster(data.cluster);
  needMeta();
  const known=(await meta.campaigns()).find(c=>c.id===id);
  if(!known)fail('Campanha não encontrada na conta da Meta.',404);
  db.prepare('INSERT INTO wpp_campaign_links (campaign_id,cluster_id,name,updated) VALUES (?,?,?,?) ON CONFLICT(campaign_id) DO UPDATE SET cluster_id=excluded.cluster_id,name=excluded.name,updated=excluded.updated')
   .run(id,data.cluster,known.name.slice(0,200),nowSeconds());
  return {ok:true};
 }
 // Entradas e saídas por dia dos grupos de um agrupamento (um grupo em dois números conta uma vez, como nos totais).
 function clusterMoves(clusterId,from,to){
  const primary=new Map();
  for(const g of db.prepare(`SELECT g.account_id,g.id FROM wpp_groups g JOIN wpp_accounts a ON a.id=g.account_id JOIN wpp_cluster_groups cg ON cg.group_id=g.id
   WHERE cg.cluster_id=? AND g.active=1 AND a.removed=0 ORDER BY g.size DESC,g.account_id`).all(clusterId))if(!primary.has(g.id))primary.set(g.id,g.account_id);
  const days=new Map();
  for(const r of db.prepare(`SELECT e.account_id,e.group_id,e.day,SUM(e.kind='join') AS joined,SUM(e.kind='leave') AS left
   FROM wpp_events e JOIN wpp_cluster_groups cg ON cg.group_id=e.group_id WHERE cg.cluster_id=? AND e.day>=? AND e.day<=?
   GROUP BY e.account_id,e.group_id,e.day`).all(clusterId,from,to)){
   if(primary.get(r.group_id)!==r.account_id)continue;
   const d=days.get(r.day)||{joined:0,left:0};d.joined+=r.joined;d.left+=r.left;days.set(r.day,d);
  }
  return {days,groups:primary.size};
 }
 async function campaignReport(id,days,ref,fresh){
  needMeta();
  const {campaigns,rows}=await metaData(days,ref,fresh);
  const links=linkMap(),link=links.get(id)||null;
  const found=campaigns.find(c=>c.id===id),seen=rows.find(r=>r.id===id);
  if(!found&&!seen&&!link)fail('Campanha não encontrada.',404);
  const list=daysEnding(ref,days);
  const cluster=link?db.prepare('SELECT id,name FROM wpp_clusters WHERE id=?').get(link.cluster_id)||null:null;
  const mine=new Set([id]);
  if(cluster)for(const [cid,l] of links)if(l.cluster_id===cluster.id)mine.add(cid);
  const daily=new Map(list.map(day=>[day,{day,spend:0,leads:0,clusterSpend:0,clusterLeads:0,joined:0,left:0}]));
  const perCampaign=new Map();
  for(const r of rows){
   const d=daily.get(r.day);
   if(!d||!mine.has(r.id))continue;
   d.clusterSpend+=r.spend;d.clusterLeads+=r.leads;
   const p=perCampaign.get(r.id)||{id:r.id,name:r.name,spend:0,leads:0};p.spend+=r.spend;p.leads+=r.leads;perCampaign.set(r.id,p);
   if(r.id===id){d.spend+=r.spend;d.leads+=r.leads;}
  }
  let moves=null;
  if(cluster){
   moves=clusterMoves(cluster.id,list[0],ref);
   for(const d of daily.values()){const m=moves.days.get(d.day);d.joined=m?.joined||0;d.left=m?.left||0;}
  }
  const series=list.map(day=>{const d=daily.get(day);return {...d,spend:money(d.spend),clusterSpend:money(d.clusterSpend)};});
  const sum=key=>series.reduce((a,d)=>a+d[key],0);
  const t={spend:money(sum('spend')),leads:sum('leads'),clusterSpend:money(sum('clusterSpend')),clusterLeads:sum('clusterLeads'),joined:sum('joined'),left:sum('left')};
  t.cpl=cpl(t.spend,t.leads);t.net=t.joined-t.left;
  t.costPerJoin=cluster?cpl(t.clusterSpend,t.joined):null;
  t.costPerNet=cluster&&t.net>0?t.clusterSpend/t.net:null;
  t.joinsPerLead=cluster&&t.clusterLeads>0?t.joined/t.clusterLeads:null;
  const siblings=[...mine].map(cid=>{const p=perCampaign.get(cid);return {id:cid,name:p?.name||campaigns.find(c=>c.id===cid)?.name||links.get(cid)?.name||cid,spend:money(p?.spend||0),leads:p?.leads||0};});
  return {campaign:{id,name:found?.name||seen?.name||link?.name||id,status:found?.status||''},cluster,
   clusters:db.prepare('SELECT id,name FROM wpp_clusters ORDER BY name COLLATE NOCASE,id').all(),
   days,date:ref,isToday:ref===saoPauloDay(clock()),groups:moves?.groups??0,series,totals:t,siblings:cluster?siblings:[]};
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
    if(path==='/apps/grupos/api/summary')return authJSON(summary(daysParam(url),accountId(url.searchParams.get('account')??'all'),adminParam(url),dateParam(url),clusterParam(url)));
    if(path==='/apps/grupos/api/clusters')return authJSON(clusterList(daysParam(url),dateParam(url)));
    const one=path.match(/^\/apps\/grupos\/api\/clusters\/(\d{1,9})$/);
    if(one)return authJSON(clusterDetail(Number(one[1]),daysParam(url),dateParam(url)));
    if(path==='/apps/grupos/api/campaigns')return authJSON(await campaignList(daysParam(url),dateParam(url),url.searchParams.get('fresh')==='1'));
    const cr=path.match(/^\/apps\/grupos\/api\/campaigns\/(\d{1,25})$/);
    if(cr)return authJSON(await campaignReport(campaignId(cr[1]),daysParam(url),dateParam(url),url.searchParams.get('fresh')==='1'));
    if(path==='/apps/grupos/api/group')return authJSON(detail(accountId(url.searchParams.get('account')),url.searchParams.get('id')||'',daysParam(url)));
    if(path==='/apps/grupos/api/accounts')return authJSON(accounts());
   }
   if(path==='/apps/grupos/api/accounts'&&method==='POST')return authJSON(createAccount(await body()),201);
   if(path==='/apps/grupos/api/clusters'&&method==='POST')return authJSON(createCluster(await body()),201);
   const cm=path.match(/^\/apps\/grupos\/api\/clusters\/(\d{1,9})(?:\/(rename|groups))?$/);
   if(cm){
    const id=Number(cm[1]);
    if(cm[2]==='rename'&&method==='POST')return authJSON(renameCluster(id,await body()));
    if(cm[2]==='groups'&&method==='POST')return authJSON(changeClusterGroups(id,await body()));
    if(!cm[2]&&method==='DELETE')return authJSON(removeCluster(id));
   }
   const camp=path.match(/^\/apps\/grupos\/api\/campaigns\/(\d{1,25})\/cluster$/);
   if(camp&&method==='POST')return authJSON(await setCampaignCluster(campaignId(camp[1]),await body()));
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
