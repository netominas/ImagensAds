import {dateRange} from './admanager.mjs';
import {reconcile} from './model.mjs';
import {AdsError} from '../google-ads/client.mjs';

export function daysBetween(start,end){dateRange(start,end);const days=[];for(let d=new Date(start+'T12:00:00Z');d.toISOString().slice(0,10)<=end;d.setUTCDate(d.getUTCDate()+1))days.push(d.toISOString().slice(0,10));return days;}
export function shiftDay(day,offset){const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+offset);return d.toISOString().slice(0,10);}
export function createROIWarehouse(db,{now=()=>new Date().toISOString()}={}){
 db.exec(`CREATE TABLE IF NOT EXISTS roi_daily_facts(kind TEXT NOT NULL,source TEXT NOT NULL,day TEXT NOT NULL,ordinal INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(kind,source,day,ordinal));
 CREATE TABLE IF NOT EXISTS roi_source_days(kind TEXT NOT NULL,source TEXT NOT NULL,day TEXT NOT NULL,collected_at TEXT,records INTEGER,last_attempt TEXT NOT NULL,error TEXT,PRIMARY KEY(kind,source,day));
 CREATE TABLE IF NOT EXISTS roi_fx_days(day TEXT PRIMARY KEY,data TEXT NOT NULL,updated TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS roi_metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated TEXT NOT NULL);`);
 const meta=key=>{const r=db.prepare('SELECT value FROM roi_metadata WHERE key=?').get(key);return r?JSON.parse(r.value):null;};
 const putMeta=(key,value)=>db.prepare('INSERT OR REPLACE INTO roi_metadata VALUES (?,?,?)').run(key,JSON.stringify(value),now());
 const revision=()=>Number(meta('revision')||0),bump=()=>putMeta('revision',revision()+1);
 function saveSource(kind,source,start,end,facts,{collectedAt=now()}={}){
  const days=daysBetween(start,end),counts=new Map(days.map(d=>[d,0])),stamp=new Date(collectedAt).toISOString();
  if(!['ads','ads-script','gam','gam-push','gam-whatsapp'].includes(kind)||!Array.isArray(facts))throw Error('Invalid source batch');
  const isRevenue=kind==='gam'||kind==='gam-push'||kind==='gam-whatsapp';
  for(const f of facts){if(!counts.has(f.date)||String(isRevenue?f.network:f.account)!==source||!Number.isFinite(isRevenue?f.revenue:f.cost))throw Error('Invalid daily fact');}
  db.exec('BEGIN IMMEDIATE');try{
   if(kind==='ads-script'&&sourceDays(kind,source,start,end).some(row=>row.collected_at>stamp)){
    throw new AdsError('Já existe uma importação mais recente nesse intervalo.',{status:409});
   }
   db.prepare('DELETE FROM roi_daily_facts WHERE kind=? AND source=? AND day BETWEEN ? AND ?').run(kind,source,start,end);
   const insert=db.prepare('INSERT INTO roi_daily_facts VALUES (?,?,?,?,?)');for(const f of facts){const ordinal=counts.get(f.date);insert.run(kind,source,f.date,ordinal,JSON.stringify(f));counts.set(f.date,ordinal+1);}
   const save=db.prepare('INSERT OR REPLACE INTO roi_source_days VALUES (?,?,?,?,?,?,NULL)');for(const day of days)save.run(kind,source,day,stamp,counts.get(day),stamp);bump();db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
 }
 function failSource(kind,source,start,end,message){
  const save=db.prepare('INSERT INTO roi_source_days(kind,source,day,last_attempt,error) VALUES (?,?,?,?,?) ON CONFLICT(kind,source,day) DO UPDATE SET last_attempt=excluded.last_attempt,error=excluded.error');
  db.exec('BEGIN IMMEDIATE');try{for(const day of daysBetween(start,end))save.run(kind,source,day,now(),String(message).slice(0,1500));bump();db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
 }
 function saveRates(rates){
  const save=db.prepare(`INSERT INTO roi_fx_days VALUES (?,?,?)
   ON CONFLICT(day) DO UPDATE SET data=excluded.data,updated=excluded.updated
   WHERE coalesce(json_extract(excluded.data,'$.quote_date'),'')
      >= coalesce(json_extract(roi_fx_days.data,'$.quote_date'),'')`);
  db.exec('BEGIN IMMEDIATE');
  try{
   let changed=0;
   for(const [day,q]of Object.entries(rates))if(/^\d{4}-\d{2}-\d{2}$/.test(day)&&Number.isFinite(q.rate)&&q.rate>0)changed+=Number(save.run(day,JSON.stringify(q),now()).changes);
   if(changed)bump();
   db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
 }
 function readRates(start,end){
  const days=daysBetween(start,end),first=shiftDay(start,-7);
  const stored=db.prepare('SELECT day,data FROM roi_fx_days WHERE day BETWEEN ? AND ? ORDER BY day').all(first,end)
   .map(row=>({day:row.day,quote:JSON.parse(row.data)}));
  const rates={};
  let latest=null,index=0;
  for(const day of days){
   while(index<stored.length&&stored[index].day<=day){
    const {quote}=stored[index++];
    if(Number.isFinite(quote.rate)&&quote.rate>0&&quote.quote_date<=day&&(!latest||quote.quote_date>=latest.quote_date))latest=quote;
   }
   const exact=stored[index-1];
   if(exact?.day===day)rates[day]=exact.quote;
   else if(latest&&latest.quote_date>=shiftDay(day,-7))rates[day]={...latest,previous_day:true,cached:true};
  }
  return rates;
 }
 function saveMissingRate(day,quote){
  db.exec('BEGIN IMMEDIATE');
  try{
   const {changes}=db.prepare('INSERT OR IGNORE INTO roi_fx_days VALUES (?,?,?)').run(day,JSON.stringify(quote),now());
   if(changes)bump();
   db.exec('COMMIT');
   return Boolean(changes);
  }catch(error){db.exec('ROLLBACK');throw error;}
 }
 function sourceDays(kind,source,start,end){return db.prepare('SELECT * FROM roi_source_days WHERE kind=? AND source=? AND day BETWEEN ? AND ? ORDER BY day').all(kind,source,start,end);}
 function missingRanges(scope,{cooldown=300000,retryFailed=false}={}){
  const plan=[],days=daysBetween(scope.start,scope.end),clock=Date.parse(now());
  for(const [kind,ids]of [['ads',scope.accounts],['gam',scope.networks]])for(const source of ids){const stored=new Map(sourceDays(kind,source,scope.start,scope.end).map(r=>[r.day,r]));let range;
   for(const day of days){const r=stored.get(day),missing=(!r?.collected_at||(retryFailed&&r.error))&&!(r?.error&&clock-Date.parse(r.last_attempt)<cooldown);if(!missing){range=null;continue;}if(!range){range={kind,source,start:day,end:day};plan.push(range);}else range.end=day;}
  }return plan;
 }
 function read(scope,rules=[],catalog={accounts:[],networks:[]},{adsKind='ads'}={}){
  const days=daysBetween(scope.start,scope.end),costs=[],revenues=[],sources=[],warnings=[],missingBySource=new Map();let missing=0,stale=0;const timestamps=[];
  for(const [kind,ids,target]of [['ads',scope.accounts,costs],['gam',scope.networks,revenues]])for(const source of ids){
   const storedKind=kind==='ads'?adsKind:kind;
   const metadata=(kind==='ads'?catalog.accounts:catalog.networks)?.find(a=>a.id===source),records=sourceDays(storedKind,source,scope.start,scope.end),missingDays=days.length-records.filter(r=>r.collected_at).length,failed=records.filter(r=>r.error),latest=records.filter(r=>r.collected_at).map(r=>r.collected_at).sort();missing+=missingDays;stale+=failed.length;timestamps.push(...latest);
   missingBySource.set(kind+':'+source,days.filter(day=>!records.some(r=>r.day===day&&r.collected_at)));
   const name=metadata?.name||source;sources.push({kind,id:source,name,currency:metadata?.currency,ok:!missingDays,stale:failed.length>0,missing_days:missingDays,collected_at:latest.at(-1)||null});
   
   if(failed.length)warnings.push(`${kind==='ads'?'Google Ads':'Ad Manager'} · ${name}: a última coleta falhou. Dados válidos já armazenados foram preservados. ${failed[0].error}`);
   target.push(...db.prepare('SELECT data FROM roi_daily_facts WHERE kind=? AND source=? AND day BETWEEN ? AND ? ORDER BY day,ordinal').all(storedKind,source,scope.start,scope.end).map(r=>JSON.parse(r.data)));
  }
  const rates=readRates(scope.start,scope.end);
  const usdDays=[...new Set([...costs,...revenues].filter(fact=>fact.currency==='USD').map(fact=>fact.date))].sort();
  const missingFxDays=usdDays.filter(day=>!rates[day]),cachedFxDays=usdDays.filter(day=>rates[day]?.cached);
  if(missingFxDays.length)warnings.push('Falta cotação PTAX para '+missingFxDays.length+' dia(s) com dados em dólar. Os valores em reais seguem disponíveis.');
  if(cachedFxDays.length)warnings.push('Conversão provisória em '+cachedFxDays.length+' dia(s) com a última PTAX disponível no banco. Os valores serão recalculados quando a cotação for atualizada.');
  if(missing)warnings.unshift(adsKind==='ads-script'?'O período ainda tem dias sem dados do Script ou do Ad Manager. Lucro e ROI ficam em aberto apenas nos registros sem cobertura suficiente.':'O período ainda não foi totalmente importado. Para importar o período, use Atualizar agora. Registros completos preservam lucro e ROI; pendências ficam sinalizadas.');
  // Missing accounts must not suppress complete campaigns identified by their own ID.
  // Custom/shared UTMs still require the full Ads scope to rule out another owner.
  const gamMissing=[...new Set(scope.networks.flatMap(id=>missingBySource.get('gam:'+id)||[]))];
  const coverageFor=row=>{
   const pending=[...(missingBySource.get('ads:'+row.account)||[]),...gamMissing];
   const explicit=row.gam_original.every(f=>f.utm===row.campaign||rules.some(rule=>rule.network===f.network&&rule.site===f.site&&rule.utm===f.utm&&rule.account===row.account&&rule.campaign===row.campaign));
   if(!explicit)for(const id of scope.accounts)pending.push(...(missingBySource.get('ads:'+id)||[]));
   return [...new Set(pending)].sort();
  };
  const result=reconcile(costs,revenues,rates,rules,{partial:missing>0,coverageFor});timestamps.sort();
  for(const row of result.rows){row.missing_cost_days=missingBySource.get('ads:'+row.account)||[];row.missing_revenue_days=[...new Set(scope.networks.flatMap(id=>missingBySource.get('gam:'+id)||[]))];}
  return {...result,warnings,sources,rates,missing_fx_days:missingFxDays,cached_fx_days:cachedFxDays,currency:'BRL',revenue_metric:'AD_EXCHANGE_LINE_ITEM_LEVEL_REVENUE',revenue_label:'Receita estimada Ad Exchange',start:scope.start,end:scope.end,updated_at:timestamps.at(-1)||null,oldest_collection:timestamps[0]||null,cost_records:costs.length,revenue_records:revenues.length,database:true,revision:revision(),data_coverage:{complete:missing===0,missing_days:missing,stale_days:stale},report_ids:[]};
 }
 return {meta,putMeta,revision,touch:bump,saveSource,failSource,saveRates,saveMissingRate,readRates,read,missingRanges,sourceDays};
}
