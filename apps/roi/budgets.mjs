import {randomBytes,createHash} from 'node:crypto';
import {AdsError} from '../google-ads/client.mjs';
import {today} from './fx.mjs';
const fail=(message,status=400)=>{throw new AdsError(message,{status});};
const stamp=()=>new Date().toISOString(),id=()=>randomBytes(16).toString('hex');
export function budgetAmount(current,mode,value){
 if(typeof value!=='string'||!/^\d+(?:[.,]\d{1,2})?$/.test(value))fail('Informe um valor positivo com até duas casas decimais.');
 const n=Number(value.replace(',','.'));if(!Number.isFinite(n)||n<=0)fail('Informe um valor positivo.');
 if(!['amount','increase_percent'].includes(mode))fail('Tipo de ajuste inválido.');
 const next=mode==='amount'?Math.round(n*1e6):Math.round(Number(current)*(1+n/100)/10000)*10000;
 if(!Number.isSafeInteger(next)||next<=0||next>1e12)fail('O novo orçamento deve ser positivo e até 1.000.000 na moeda da conta.');
 if(next===Number(current))fail('O novo orçamento é igual ao atual.');return String(next);
}
export function createBudgets(db,google,{accountFor}){
 db.exec(`CREATE TABLE IF NOT EXISTS roi_budget_operations(id TEXT PRIMARY KEY,account TEXT NOT NULL,resource TEXT NOT NULL,status TEXT NOT NULL,data TEXT NOT NULL,created TEXT NOT NULL,finished TEXT,error TEXT);
 CREATE UNIQUE INDEX IF NOT EXISTS roi_budget_operation_lock ON roi_budget_operations(account,resource) WHERE status IN ('CHECKING','SENDING','UNKNOWN');`);
 db.exec(`CREATE TABLE IF NOT EXISTS roi_campaign_budgets(account TEXT NOT NULL,campaign TEXT NOT NULL,data TEXT NOT NULL,updated TEXT NOT NULL,PRIMARY KEY(account,campaign));
 CREATE TABLE IF NOT EXISTS roi_budget_catalog(account TEXT PRIMARY KEY,checked TEXT NOT NULL,error TEXT);`);
 const pending=new Map(),ttl=30*60000;
 function saveValues(data){const updated=stamp(),save=db.prepare('INSERT OR REPLACE INTO roi_campaign_budgets VALUES (?,?,?,?)');for(const campaign of data.campaigns||[{id:data.campaign}])save.run(data.account,campaign.id,JSON.stringify({account:data.account,campaign:campaign.id,currency:data.currency,period:data.period,micros:data.next??data.micros,shared:data.shared,resource:data.resource}),updated);}
 async function refreshAccount(a){
  if(pending.has(a.id))return pending.get(a.id);
  const previous=db.prepare('SELECT * FROM roi_budget_catalog WHERE account=?').get(a.id);if(previous&&Date.now()-Date.parse(previous.checked)<(previous.error?60000:ttl))return;
  const task=(async()=>{try{
   const started=stamp();const rows=await google.search(a.id,"SELECT campaign.id, customer.currency_code, campaign_budget.resource_name, campaign_budget.amount_micros, campaign_budget.total_amount_micros, campaign_budget.period, campaign_budget.explicitly_shared FROM campaign WHERE campaign.status != 'REMOVED'",a.mcc),values=[];
   for(const row of rows){const b=row.campaignBudget,campaign=String(row.campaign?.id),currency=row.customer?.currencyCode||a.currency;if(!b)continue;const micros=String(b.period==='CUSTOM_PERIOD'?b.totalAmountMicros:b.amountMicros);if(!/^\d{1,20}$/.test(campaign)||!['DAILY','CUSTOM_PERIOD'].includes(b.period)||!/^\d+$/.test(micros)||!Number.isSafeInteger(Number(micros))||! /^[A-Z]{3}$/.test(currency||'')||!new RegExp('^customers/'+a.id+'/campaignBudgets/\\d+$').test(b.resourceName||''))continue;values.push({account:a.id,campaign,currency,period:b.period,micros,shared:Boolean(b.explicitlyShared),resource:b.resourceName});}
   db.exec('BEGIN IMMEDIATE');try{db.prepare('DELETE FROM roi_campaign_budgets WHERE account=? AND updated<=?').run(a.id,started);for(const data of values){const newer=db.prepare('SELECT updated FROM roi_campaign_budgets WHERE account=? AND campaign=?').get(a.id,data.campaign);if(!newer||newer.updated<=started)saveValues(data);}db.prepare('INSERT OR REPLACE INTO roi_budget_catalog VALUES (?,?,NULL)').run(a.id,stamp());db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
  }catch{db.prepare('INSERT OR REPLACE INTO roi_budget_catalog VALUES (?,?,?)').run(a.id,stamp(),'Última consulta de orçamento indisponível; valor armazenado preservado.');}})();pending.set(a.id,task);try{await task;}finally{pending.delete(a.id);}
 }
 async function listing(accounts){
  if(!Array.isArray(accounts)||!accounts.length||accounts.length>120||new Set(accounts).size!==accounts.length)fail('Selecione contas válidas.');const available=[];for(const account of accounts)available.push(await accountFor(account));
  let cursor=0;await Promise.all(Array.from({length:Math.min(3,available.length)},async()=>{for(;;){const a=available[cursor++];if(!a)break;await refreshAccount(a);}}));
  const items=[],warnings=[];for(const a of available){const info=db.prepare('SELECT * FROM roi_budget_catalog WHERE account=?').get(a.id);if(info?.error)warnings.push({account:a.id,message:info.error});for(const row of db.prepare('SELECT data,updated FROM roi_campaign_budgets WHERE account=?').all(a.id))items.push({...JSON.parse(row.data),updated:row.updated,stale:Boolean(info?.error)||Date.now()-Date.parse(row.updated)>ttl});}return {items,warnings};
 }
 db.prepare("UPDATE roi_budget_operations SET status='FAILED',error='Conferência interrompida antes do envio.' WHERE status='CHECKING'").run();
 db.prepare("UPDATE roi_budget_operations SET status='UNKNOWN',error='Envio interrompido. Confira o orçamento no Google Ads antes de tentar novamente.' WHERE status='SENDING'").run();
 const get=operation=>{if(typeof operation!=='string'||!/^[a-f0-9]{32}$/.test(operation))fail('Operação inválida.');const row=db.prepare('SELECT * FROM roi_budget_operations WHERE id=?').get(operation);if(!row)fail('Operação não encontrada.',404);return {...row,data:JSON.parse(row.data)};};
 const activeJobs=()=>db.prepare("SELECT count(*) AS n FROM roi_budget_operations WHERE status IN ('CHECKING','SENDING')").get().n;
 async function read(account,campaign){
  if(typeof campaign!=='string'||!/^\d{1,20}$/.test(campaign))fail('Campanha inválida.');const a=await accountFor(account);
  const rows=await google.search(a.id,`SELECT campaign.id, campaign.name, campaign.status, customer.currency_code, campaign_budget.resource_name, campaign_budget.amount_micros, campaign_budget.total_amount_micros, campaign_budget.period, campaign_budget.explicitly_shared FROM campaign WHERE campaign.id = ${campaign} AND campaign.status != 'REMOVED'`,a.mcc);
  const row=rows.find(r=>String(r.campaign?.id)===campaign),b=row?.campaignBudget;if(!b)fail('Campanha ou orçamento indisponível.',404);
  if(!new RegExp('^customers/'+a.id+'/campaignBudgets/\\d+$').test(b.resourceName||''))fail('O Google não retornou um orçamento válido.',502);
  if(!['DAILY','CUSTOM_PERIOD'].includes(b.period))fail('Este período de orçamento não permite edição pelo painel.');
  const currency=row.customer?.currencyCode||a.currency;if(!/^[A-Z]{3}$/.test(currency||''))fail('Moeda da conta indisponível.',502);
  const micros=String(b.period==='DAILY'?b.amountMicros:b.totalAmountMicros);if(!/^\d+$/.test(micros)||!Number.isSafeInteger(Number(micros)))fail('Valor de orçamento inválido.',502);
  const affected=await google.search(a.id,`SELECT campaign.id, campaign.name, campaign.status FROM campaign WHERE campaign.campaign_budget = '${b.resourceName}' AND campaign.status != 'REMOVED'`,a.mcc);
  const campaigns=affected.map(r=>({id:String(r.campaign.id),name:r.campaign.name,status:r.campaign.status})).sort((x,y)=>x.id.localeCompare(y.id));
  if(!campaigns.some(c=>c.id===campaign)||campaigns.some(c=>!/^\d{1,20}$/.test(c.id)))fail('Não foi possível confirmar as campanhas vinculadas ao orçamento.',502);
  const blocked=db.prepare("SELECT status FROM roi_budget_operations WHERE account=? AND resource=? AND status IN ('CHECKING','SENDING','UNKNOWN')").get(a.id,b.resourceName);
  const data={account:a.id,campaign,name:row.campaign.name,currency,resource:b.resourceName,period:b.period,micros,campaigns,shared:Boolean(b.explicitlyShared)||campaigns.length>1,blocked:blocked?.status||null};try{saveValues(data);}catch{/* A display cache failure must not prevent the live confirmation. */}return data;
 }
 const operations=data=>[{campaignBudgetOperation:{update:{resourceName:data.resource,[data.period==='DAILY'?'amountMicros':'totalAmountMicros']:data.next},updateMask:data.period==='DAILY'?'amount_micros':'total_amount_micros'}}];
 function publicOperation(row){return {id:row.id,status:row.status,...row.data,error:row.error};}
 async function preview(body){
  const current=await read(body.account,body.campaign);if(current.blocked)fail('Há uma alteração em andamento ou com resultado incerto neste orçamento. Confira o Google Ads.',409);
  if(body.expected!==current.micros)fail('O orçamento mudou desde a abertura. Reabra o ajuste para usar o valor atual.',409);
  const data={...current,next:budgetAmount(current.micros,body.mode,body.value),mode:body.mode,value:body.value},a=await accountFor(current.account);
  try{await google.mutate(a.id,operations(data),{mcc:a.mcc,validateOnly:true});}catch{fail('O Google Ads não validou o orçamento. Confira o valor e as permissões da conta.',422);}
  const operation=id(),created=stamp();db.prepare("INSERT INTO roi_budget_operations VALUES (?,?,?,'PREVIEW',?,?,NULL,NULL)").run(operation,current.account,current.resource,JSON.stringify(data),created);return publicOperation(get(operation));
 }
 async function apply(body){
  const original=get(body.id),a=await accountFor(original.account);if(original.status==='DONE')return publicOperation(original);if(original.status!=='PREVIEW')fail(original.error||'Esta operação já foi enviada. Consulte o resultado antes de repetir.',409);
  if(Date.now()-Date.parse(original.created)>10*60000)fail('A confirmação expirou. Reabra o ajuste para consultar o orçamento atual.',409);
  if(original.data.shared&&body.confirmShared!==true)fail('Confirme o orçamento compartilhado e todas as campanhas afetadas.');
  try{const locked=db.prepare("UPDATE roi_budget_operations SET status='CHECKING' WHERE id=? AND status='PREVIEW'").run(original.id);if(!locked.changes)fail('Operação já em andamento.',409);}catch{fail('Já existe uma alteração em andamento ou pendente para este orçamento.',409);}
  const data=original.data;let current;
  try{current=await read(data.account,data.campaign);if(current.resource!==data.resource||current.micros!==data.micros||current.period!==data.period||current.currency!==data.currency||JSON.stringify(current.campaigns)!==JSON.stringify(data.campaigns))fail('O orçamento ou as campanhas vinculadas mudaram. Reabra o ajuste para revisar.',409);}
  catch(error){db.prepare("UPDATE roi_budget_operations SET status='FAILED',error=?,finished=? WHERE id=?").run('A conferência anterior ao envio falhou. Nenhuma alteração foi enviada.',stamp(),original.id);throw error;}
  db.prepare("UPDATE roi_budget_operations SET status='SENDING' WHERE id=?").run(original.id);
  let response;try{response=await google.mutate(a.id,operations(data),{mcc:a.mcc,validateOnly:false});}
  catch(error){const definite=error instanceof AdsError&&error.definite;db.prepare('UPDATE roi_budget_operations SET status=?,error=?,finished=? WHERE id=?').run(definite?'FAILED':'UNKNOWN',definite?'O Google Ads recusou a alteração.':'Resultado incerto. Confira o orçamento no Google Ads; o painel bloqueou novos envios para evitar repetição.',stamp(),original.id);throw new AdsError(get(original.id).error,{status:definite?422:409});}
  if(response?.mutateOperationResponses?.[0]?.campaignBudgetResult?.resourceName!==data.resource){db.prepare("UPDATE roi_budget_operations SET status='UNKNOWN',error='Resposta sem confirmação do orçamento. Confira o Google Ads antes de repetir.',finished=? WHERE id=?").run(stamp(),original.id);throw new AdsError(get(original.id).error,{status:409});}
  const format=n=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:data.currency}).format(Number(n)/1e6),description=`Orçamento ${data.period==='DAILY'?'diário':'total'} alterado pelo painel: ${format(data.micros)} → ${format(data.next)}.${data.mode==='increase_percent'?' Aumento solicitado: '+data.value+'%.':''}${data.shared?' Orçamento compartilhado com '+data.campaigns.length+' campanhas.':''}`;
  db.exec('BEGIN IMMEDIATE');try{
   for(const c of data.campaigns){const noteId=createHash('sha256').update(original.id+':'+c.id).digest('hex').slice(0,32);db.prepare('INSERT INTO roi_campaign_changes(id,account,campaign,date,type,description,created,updated,source,budget_operation) VALUES (?,?,?,?,?,?,?,?,?,?)').run(noteId,data.account,c.id,today(),Number(data.next)>Number(data.micros)?'budget_increase':'budget_decrease',description,stamp(),stamp(),'google_ads',original.id);}
   db.prepare("UPDATE roi_budget_operations SET status='DONE',finished=? WHERE id=?").run(stamp(),original.id);db.exec('COMMIT');
  }catch{db.exec('ROLLBACK');db.prepare("UPDATE roi_budget_operations SET status='UNKNOWN',error='O Google confirmou a alteração, mas o histórico precisa de revisão. Não repita o envio.' WHERE id=?").run(original.id);fail(get(original.id).error,409);}
  try{saveValues(data);}catch{/* Confirmed changes and their audit entries remain authoritative. */}return publicOperation(get(original.id));
 }
 return {read,listing,preview,apply,status:async operation=>{const row=get(operation);await accountFor(row.account);return publicOperation(row);},activeJobs};
}
