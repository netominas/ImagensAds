import {AdsError} from '../google-ads/client.mjs';
import {today} from './fx.mjs';
import {shiftDay} from './warehouse.mjs';

export function createAccountActivity(db,{warehouse,catalog,google,day=today}={}){
 function read(accounts){
  const end=day(),start=shiftDay(end,-29),facts=db.prepare("SELECT source,data FROM roi_daily_facts WHERE kind='ads' AND day BETWEEN ? AND ?").all(start,end),byAccount=new Map();
  for(const {source,data}of facts){if(!byAccount.has(source))byAccount.set(source,[]);byAccount.get(source).push(JSON.parse(data));}
  return {start,end,items:accounts.map(account=>{
   const rows=byAccount.get(account.id)||[],spent=rows.filter(f=>f.cost>0),currencies=[...new Set(rows.map(f=>f.currency))],coverage=warehouse.sourceDays('ads',account.id,start,end),saved=warehouse.meta('account_activity:'+account.id);
   const observed=new Map();for(const f of rows)if(f.campaign_status&&f.campaign_checked_at&&(!observed.has(f.campaign)||observed.get(f.campaign).checked_at<f.campaign_checked_at))observed.set(f.campaign,{status:f.campaign_status,checked_at:f.campaign_checked_at});
   const observedAt=[...observed.values()].map(f=>f.checked_at).sort().at(-1)||null,useSaved=saved&&(!observedAt||saved.checked_at>=observedAt);
   return {account:account.id,spend:currencies.length>1?null:rows.reduce((s,f)=>s+f.cost,0),currency:currencies[0]||account.currency,spent_campaigns:new Set(spent.map(f=>f.campaign)).size,last_spend:spent.map(f=>f.date).sort().at(-1)||null,covered_days:coverage.filter(d=>d.collected_at).length,days:30,last_collection:coverage.map(d=>d.collected_at).filter(Boolean).sort().at(-1)||null,stale:coverage.some(d=>d.error),active_campaigns:useSaved?saved.active_campaigns:observed.size?[...observed.values()].filter(f=>f.status==='ENABLED').length:null,activity_checked_at:useSaved?saved.checked_at:observedAt,activity_scope:useSaved?'all':'observed'};
  })};
 }
 const pending=new Map();
 async function refresh(account){
  if(typeof account!=='string'||!/^\d{10}$/.test(account))throw new AdsError('Conta inválida.',{status:400});
  const item=(await catalog()).accounts.find(a=>a.id===account);if(!item)throw new AdsError('Conta indisponível.',{status:403});
  if(pending.has(account))return pending.get(account);
  const task=(async()=>{
   const rows=await google.search(account,"SELECT campaign.id, campaign.status FROM campaign WHERE campaign.status != 'REMOVED'",item.mcc);
   const valid=rows.every(r=>r.campaign?.id&&['ENABLED','PAUSED','REMOVED'].includes(r.campaign.status));if(!valid)throw new AdsError('A consulta não retornou o estado das campanhas.',{status:502});
   const saved={active_campaigns:new Set(rows.filter(r=>r.campaign.status==='ENABLED').map(r=>String(r.campaign.id))).size,checked_at:new Date().toISOString()};
   warehouse.putMeta('account_activity:'+account,saved);return saved;
  })();pending.set(account,task);try{return await task;}finally{pending.delete(account);}
 }
 return {read,refresh};
}
