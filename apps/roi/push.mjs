import {AdsError} from '../google-ads/client.mjs';
import {dateRange} from './admanager.mjs';
import {shareRate} from './deductions.mjs';
import {toBRL,today} from './fx.mjs';
import {revenueFacts} from './model.mjs';

const aliases={aiweb:'aiweb',alert:'pushalert',pushalert:'pushalert',news:'pushnews',newst:'pushnews',pushnews:'pushnews'};
const emptyMedium=new Set(['','(not set)','(not applicable)','/empty/']);
export function classifyPush(utm,medium=''){
 const campaign=/^(welc|broad)_([a-z0-9-]+)_.+$/i.exec(utm);
 const mediumValue=medium.trim().toLowerCase();
 const source=/^ps_([a-z0-9_-]+)$/.exec(mediumValue)?.[1];
 if(!source&&(!campaign||!emptyMedium.has(mediumValue)))return null;
 const provider=source||campaign[2].toLowerCase();
 const type=campaign?.[1].toLowerCase();
 return {provider:Object.hasOwn(aliases,provider)?aliases[provider]:provider,type:type==='welc'?'welcome':type==='broad'?'broadcast':'other',medium:source?mediumValue:null};
}

export function createPushReport(db,{warehouse,admanager,networks,deductions}){
 let job=null;
 const range=({start,end})=>{
  dateRange(start,end);
  if(end>today())throw new AdsError('A data final não pode estar no futuro.',{status:400});
  return {start,end};
 };
 const facts=db.prepare(`SELECT data FROM roi_daily_facts
  WHERE kind=? AND source=? AND day BETWEEN ? AND ?
    AND (kind='gam-push' OR lower(json_extract(data,'$.utm')) GLOB 'welc_*' OR lower(json_extract(data,'$.utm')) GLOB 'broad_*')
  ORDER BY day,ordinal`);
 function report(input){
  const {start,end}=range(input),rates=warehouse.readRates(start,end),config=deductions.read(),rows=new Map(),coverage=[];
  const taxOnRevenue=config.enabled&&config.tax_enabled&&config.tax_percent>0&&config.tax_base==='revenue';
  const taxPending=config.enabled&&config.tax_enabled&&config.tax_percent>0&&config.tax_base==='profit';
  for(const network of networks()){
   const exact=warehouse.sourceDays('gam-push',network.id,start,end),covered=new Set(exact.filter(day=>day.collected_at).map(day=>day.day));
   const regular=warehouse.sourceDays('gam',network.id,start,end);
   coverage.push({name:network.name,days:new Set([...covered,...regular.filter(day=>day.collected_at).map(day=>day.day)]).size,exactDays:covered.size,
    error:exact.find(day=>day.error)?.error||null,exactAt:exact.map(day=>day.collected_at).filter(Boolean).sort().at(-1)||null});
   for(const kind of ['gam','gam-push'])for(const record of facts.all(kind,network.id,start,end)){
    const fact=JSON.parse(record.data);
    if(kind==='gam'&&covered.has(fact.date))continue;
    const push=classifyPush(fact.utm,fact.medium);
    if(!push)continue;
    const key=JSON.stringify([fact.date,fact.site,push.provider,push.type,fact.utm]);
    if(!rows.has(key))rows.set(key,{date:fact.date,site:fact.site,campaign:fact.utm,provider:push.provider,type:push.type,mediums:new Set(),inferred:false,impressions:0,gross:0,revenue:0,provisional:false});
    const row=rows.get(key);
    if(push.medium)row.mediums.add(push.medium);else row.inferred=true;
    const gross=toBRL(fact.revenue,fact.currency,fact.date,rates);
    const afterShare=gross==null?null:gross*(1-shareRate(config,network.id));
    row.gross=row.gross==null||gross==null?null:row.gross+gross;
    row.revenue=row.revenue==null||afterShare==null?null:row.revenue+(taxOnRevenue?afterShare*(1-config.tax_percent/100):afterShare);
    row.impressions+=fact.impressions;
    row.provisional||=fact.currency==='USD'&&Boolean(rates[fact.date]?.cached);
   }
  }
  return {rows:[...rows.values()].map(row=>({...row,mediums:[...row.mediums].sort()})),coverage,job,taxPending,deductions:config.enabled};
 }
 async function collect(selection,start,end){
  let successful=0;
  for(const network of selection){
   job={...job,message:'Consultando '+network.name+'…'};
   try{
    const keys=await admanager.keys(network.id);
    const campaign=keys.find(key=>key.name==='utm_campaign'&&key.reportableType==='CUSTOM_DIMENSION');
    const medium=keys.find(key=>key.name==='utm_medium'&&key.reportableType==='CUSTOM_DIMENSION');
    if(!campaign||!medium)throw new AdsError('Habilite utm_campaign e utm_medium como dimensões personalizadas no GAM.');
    const data=await admanager.report(network.id,{start,end,key:campaign.id,additionalKeys:[medium.id]});
    const mediumColumn=`Dimension.TOP_LEVEL_DIMENSION_KEY[${medium.id}]_VALUE`;
    if(data.rows.length&&!Object.hasOwn(data.rows[0],mediumColumn))throw new AdsError('O GAM não retornou a coluna utm_medium.');
    const rows=revenueFacts(data,network,'utm_campaign',medium.id).filter(row=>classifyPush(row.utm,row.medium));
    warehouse.saveSource('gam-push',network.id,start,end,rows);
    successful++;
   }catch(error){
    warehouse.failSource('gam-push',network.id,start,end,error instanceof AdsError?error.message:'Falha na consulta de UTMs ao GAM.');
   }
  }
  job={running:false,start,end,message:`Consulta concluída em ${successful} de ${selection.length} rede(s).`};
 }
 function refresh(input){
  const {start,end}=range(input),selection=networks();
  if(job?.running)throw new AdsError('Já existe uma consulta de Push em andamento.',{status:409});
  if(!selection.length)throw new AdsError('Selecione as redes nas fontes do ROI.',{status:400});
  job={running:true,start,end,message:'Preparando consulta ao GAM…'};
  void collect(selection,start,end).catch(()=>{job={running:false,start,end,message:'Não foi possível concluir a consulta ao GAM.'};});
  return job;
 }
 return {report,refresh,activeJobs:()=>job?.running?1:0};
}
