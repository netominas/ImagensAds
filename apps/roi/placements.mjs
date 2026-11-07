import {randomBytes} from 'node:crypto';
import {AdsError} from '../google-ads/client.mjs';
import {dateRange} from './admanager.mjs';
import {daysBetween,shiftDay} from './warehouse.mjs';
import {today} from './fx.mjs';
import {placementKey,contentFacts,placementReport} from './placement-model.mjs';

export function createPlacements(db,{google,admanager,catalog,settings,warehouse,baseline,loadRates,autoSync=false,isBusy=()=>false,clock=()=>Date.now()}={}){
 let active=false,timer,initial,stopped=false;
 db.exec(`CREATE TABLE IF NOT EXISTS roi_placement_days(kind TEXT NOT NULL,source TEXT NOT NULL,day TEXT NOT NULL,data TEXT,updated TEXT,error TEXT,last_attempt TEXT NOT NULL,PRIMARY KEY(kind,source,day));
 CREATE TABLE IF NOT EXISTS roi_placement_jobs(id TEXT PRIMARY KEY,account TEXT NOT NULL,campaign TEXT NOT NULL,start TEXT NOT NULL,end TEXT NOT NULL,status TEXT NOT NULL,progress TEXT NOT NULL,error TEXT,created TEXT NOT NULL,finished TEXT);
 CREATE TABLE IF NOT EXISTS roi_placement_subscriptions(account TEXT NOT NULL,campaign TEXT NOT NULL,touched TEXT NOT NULL,last_attempt TEXT,PRIMARY KEY(account,campaign));`);
 db.prepare("UPDATE roi_placement_jobs SET status='error',error='Coleta interrompida pelo reinício. Os dados anteriores foram preservados.',finished=? WHERE status='running'").run(new Date(clock()).toISOString());
 const stamp=()=>new Date(clock()).toISOString(),source=(account,campaign)=>account+':'+campaign;
 async function validate(body){const {account,campaign,start,end}=body;dateRange(start,end);if(end>today()||typeof account!=='string'||!/^\d{10}$/.test(account)||typeof campaign!=='string'||!/^\d{1,20}$/.test(campaign))throw new AdsError('Conta, campanha ou período inválido.',{status:400});const data=await catalog(),selected=data.accounts.find(a=>a.id===account);if(!selected)throw new AdsError('Conta indisponível para este painel.',{status:403});return {account: selected,data,networks:data.networks.filter(n=>settings().networks.includes(n.id))};}
 function stored(kind,id,start,end){return db.prepare('SELECT * FROM roi_placement_days WHERE kind=? AND source=? AND day BETWEEN ? AND ? ORDER BY day').all(kind,id,start,end);}
 function plan(kind,id,start,end,force=false){const rows=new Map(stored(kind,id,start,end).map(r=>[r.day,r])),ranges=[];let range;
  for(const day of daysBetween(start,end)){const r=rows.get(day),ttl=day<shiftDay(today(),-7)?86400000:1800000,missing=force||!r?.data||!r.updated||clock()-Date.parse(r.updated)>ttl;
   if(!missing){range=null;continue;}if(!force&&r?.error&&clock()-Date.parse(r.last_attempt)<300000){range=null;continue;}
   if(!range||daysBetween(range.start,day).length>7){range={start:day,end:day};ranges.push(range);}else range.end=day;
  }return ranges;
 }
 function save(kind,id,range,dataForDay){db.exec('BEGIN IMMEDIATE');try{const insert=db.prepare('INSERT OR REPLACE INTO roi_placement_days VALUES (?,?,?,?,?,NULL,?)'),now=stamp();for(const day of daysBetween(range.start,range.end))insert.run(kind,id,day,JSON.stringify(dataForDay(day)),now,now);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}
 function fail(kind,id,range,error){const insert=db.prepare('INSERT INTO roi_placement_days VALUES (?,?,?,NULL,NULL,?,?) ON CONFLICT(kind,source,day) DO UPDATE SET error=excluded.error,last_attempt=excluded.last_attempt');for(const day of daysBetween(range.start,range.end))insert.run(kind,id,day,error,stamp());}
 async function adsRange(account,campaign,range){
  const filter=`campaign.id=${campaign} AND segments.date BETWEEN '${range.start}' AND '${range.end}'`,fields='metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.average_cpc, metrics.conversions, metrics.interactions, metrics.conversions_from_interactions_rate, metrics.cost_per_conversion';
  const customer=(await google.search(account.id,'SELECT customer.currency_code, customer.time_zone FROM customer',account.mcc))[0]?.customer;if(!customer)throw Error('No customer');
  const metadata=(await google.search(account.id,`SELECT campaign.id, campaign.name, campaign.advertising_channel_type FROM campaign WHERE campaign.id=${campaign}`,account.mcc))[0]?.campaign;
  if(!metadata||metadata.advertisingChannelType!=='DISPLAY')throw new AdsError('Este relatório está disponível somente para campanhas de Display.',{status:400});
  const totals=await google.search(account.id,`SELECT campaign.id, segments.date, ${fields} FROM campaign WHERE ${filter}`,account.mcc);
  const rows=await google.search(account.id,`SELECT campaign.id, ad_group.id, group_placement_view.placement, group_placement_view.placement_type, group_placement_view.target_url, segments.date, ${fields} FROM group_placement_view WHERE ${filter}`,account.mcc);
  const fact=r=>{const m=r.metrics||{};return {account:account.id,campaign,date:r.segments.date,currency:customer.currencyCode,timezone:customer.timeZone,cost:Number(m.costMicros||0)/1e6,impressions:Number(m.impressions||0),clicks:Number(m.clicks||0),ads_metrics:{clicks:Number(m.clicks||0),average_cpc:Number(m.averageCpc||0)/1e6,interactions:Number(m.interactions||0),conversions:Number(m.conversions||0),conversion_rate:Number(m.conversionsFromInteractionsRate||0),cost_per_conversion:Number(m.costPerConversion||0)/1e6}};};
  const parsed=rows.map(r=>({...fact(r),placement:r.groupPlacementView.placement||'Other',type:r.groupPlacementView.placementType||'UNKNOWN',placement_key:placementKey(r.groupPlacementView.placement,r.groupPlacementView.placementType)}));
  if([...parsed,...totals.map(fact)].some(f=>!Number.isFinite(f.cost)||f.cost<0||!Number.isFinite(f.clicks)||f.clicks<0))throw Error('Invalid metrics');
  save('ads',source(account.id,campaign),range,day=>({placements:parsed.filter(f=>f.date===day),totals:totals.filter(r=>r.segments.date===day).map(fact),name:metadata.name,type:metadata.advertisingChannelType}));
 }
 async function gamRange(network,range,key){
  const report=await admanager.report(network.id,{...range,key:key.id,mode:String(key.reportableType).includes('DIMENSION')?'CUSTOM_DIMENSION':'CUSTOM_CRITERIA'}),facts=contentFacts(report,network);
  save('gam',network.id,range,day=>({facts:facts.filter(f=>f.date===day),report_id:report.report_id,key:key.id}));
 }
 async function read(body,{reader=false}={}){
  const {account: a,networks}=await validate(body),{account,campaign,start,end}=body,count=daysBetween(start,end).length,ads=[],revenues=[],totals=[],sources=[],times=[];let complete=!!networks.length,stale=false;
  for(const [kind,id,label] of [['ads',source(account,campaign),'Google Ads'],...networks.map(n=>['gam',n.id,'Ad Manager · '+n.name])]){
   const records=stored(kind,id,start,end),has=records.filter(r=>r.data).length,failed=records.some(r=>r.error);complete=complete&&has===count;stale=stale||failed;sources.push({name:reader?(kind==='ads'?'Google Ads':'Ad Manager'):label,complete:has===count,error:records.find(r=>r.error)?.error||null});
   for(const r of records){if(!r.data)continue;times.push(r.updated);const data=JSON.parse(r.data);if(kind==='ads'){ads.push(...data.placements);totals.push(...data.totals);}else revenues.push(...data.facts.filter(f=>f.campaign===campaign));}
  }
  const owned=stored('ads',source(account,campaign),start,end).some(r=>r.data&&JSON.parse(r.data).type==='DISPLAY');if(!owned)revenues.length=0;
  const rates=Object.fromEntries(db.prepare('SELECT day,data FROM roi_fx_days WHERE day BETWEEN ? AND ?').all(start,end).map(r=>[r.day,JSON.parse(r.data)]));
  const collision=Boolean(db.prepare("SELECT 1 FROM roi_daily_facts WHERE kind='ads' AND json_extract(data,'$.campaign')=? AND source!=? LIMIT 1").get(campaign,account));
  if(reader&&collision)revenues.length=0;
  const report=placementReport({...body,ads,revenues,totals,rates,complete,stale,collision,baseline:baseline?.(body)}),job=db.prepare('SELECT status,progress,error,start,end,created,finished FROM roi_placement_jobs WHERE account=? AND campaign=? ORDER BY created DESC LIMIT 1').get(account,campaign)||null;
  const publicSources=reader?[{name:'Google Ads',complete:sources[0]?.complete||false,error:sources[0]?.error||null},{name:'Ad Manager',complete:sources.slice(1).length>0&&sources.slice(1).every(s=>s.complete),error:sources.slice(1).some(s=>s.error)?'Uma fonte de receita não pôde ser atualizada.':null}]:sources;
  return {...report,sources:publicSources,updated_at:times.sort().at(-1)||null,job:job?.status==='running'?{...job,progress:'Atualizando placements e receita por utm_content…'}:job,currency:'BRL',scope:'Campanha inteira · todos os sites',supported:ads.length||totals.length?true:null};
 }
 async function collect(id,body,account,networks,force){
  const progress=text=>db.prepare('UPDATE roi_placement_jobs SET progress=? WHERE id=?').run(text,id);let error=false;
  try{
   const adsPlan=plan('ads',source(body.account,body.campaign),body.start,body.end,force);
   for(const range of adsPlan){progress('Consultando placements do Google Ads…');try{await adsRange(account,body.campaign,range);}catch(e){fail('ads',source(body.account,body.campaign),range,e instanceof AdsError&&e.status===400?e.message:'Não foi possível atualizar os placements do Google Ads.');error=true;}}
   for(const network of networks){const ranges=plan('gam',network.id,body.start,body.end,force);if(!ranges.length)continue;progress('Consultando utm_content do Ad Manager…');let key;try{key=(await admanager.keys(network.id)).find(k=>k.name==='utm_content'&&k.reportableType!=='OFF');}catch{}
    for(const range of ranges){if(!key){fail('gam',network.id,range,'utm_content não está disponível para relatório nesta rede. Confira a configuração e o acesso.');error=true;continue;}try{await gamRange(network,range,key);}catch{fail('gam',network.id,range,'Não foi possível atualizar a receita por utm_content. Os dados anteriores foram preservados.');error=true;}}
   }
   try{const result=await loadRates(body.start,body.end);warehouse.saveRates(result);}catch{/* Existing daily rates stay valid; absent FX keeps monetary metrics unavailable. */}
   db.prepare("UPDATE roi_placement_jobs SET status=?,progress='Concluído',error=?,finished=? WHERE id=?").run(error?'error':'done',error?'Uma ou mais fontes não foram atualizadas. Consulte os avisos do bloco.':null,stamp(),id);
  }catch{db.prepare("UPDATE roi_placement_jobs SET status='error',error='Não foi possível concluir a atualização. Os dados anteriores foram preservados.',finished=? WHERE id=?").run(stamp(),id);}finally{active=false;}
 }
 async function launch(body,{force=false}={}){
  const {account,networks}=await validate(body);if(!networks.length)throw new AdsError('Selecione as redes Ad Manager nas fontes do ROI.',{status:409});if(stopped)throw new AdsError('Serviço em encerramento.',{status:503});
  const known=db.prepare("SELECT json_extract(data,'$.campaign_type') type FROM roi_daily_facts WHERE kind='ads' AND source=? AND json_extract(data,'$.campaign')=? AND json_extract(data,'$.campaign_type') IS NOT NULL LIMIT 1").get(body.account,body.campaign);if(known&&known.type!=='DISPLAY')throw new AdsError('Este relatório está disponível somente para campanhas de Display.',{status:400});
  const own=db.prepare("SELECT id FROM roi_placement_jobs WHERE account=? AND campaign=? AND status='running'").get(body.account,body.campaign);if(own)return {id:own.id};if(active)throw new AdsError('Há outra coleta de placements em andamento. Aguarde e tente novamente.',{status:409});
  db.prepare('INSERT INTO roi_placement_subscriptions VALUES (?,?,?,NULL) ON CONFLICT(account,campaign) DO UPDATE SET touched=excluded.touched').run(body.account,body.campaign,stamp());
  const needed=plan('ads',source(body.account,body.campaign),body.start,body.end,force).length||networks.some(n=>plan('gam',n.id,body.start,body.end,force).length);if(!needed)return {id:null};
  active=true;const id=randomBytes(16).toString('hex');db.prepare("INSERT INTO roi_placement_jobs VALUES (?,?,?,?,?,'running','Preparando coleta…',NULL,?,NULL)").run(id,body.account,body.campaign,body.start,body.end,stamp());db.prepare('UPDATE roi_placement_subscriptions SET last_attempt=? WHERE account=? AND campaign=?').run(stamp(),body.account,body.campaign);
  void collect(id,body,account,networks,force);return {id};
 }
 async function tick(){if(!autoSync||stopped||active||isBusy())return;const rows=db.prepare('SELECT * FROM roi_placement_subscriptions WHERE last_attempt IS NULL OR last_attempt<? ORDER BY last_attempt LIMIT 1').all(new Date(clock()-1800000).toISOString());for(const r of rows){try{await launch({account:r.account,campaign:r.campaign,start:shiftDay(today(),-6),end:today()});db.prepare('UPDATE roi_placement_subscriptions SET last_attempt=? WHERE account=? AND campaign=?').run(stamp(),r.account,r.campaign);}catch{db.prepare('UPDATE roi_placement_subscriptions SET last_attempt=? WHERE account=? AND campaign=?').run(stamp(),r.account,r.campaign);}}}
 return {read,launch,tick,activeJobs:()=>Number(active),start(){if(!autoSync||timer||stopped)return;initial=setTimeout(()=>void tick().catch(()=>{}),20000);initial.unref?.();timer=setInterval(()=>void tick().catch(()=>{}),60000);timer.unref?.();},stop(){stopped=true;clearTimeout(initial);clearInterval(timer);}};
}
