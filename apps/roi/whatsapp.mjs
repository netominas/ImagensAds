import {AdsError} from '../google-ads/client.mjs';
import {dateRange} from './admanager.mjs';
import {shareRate} from './deductions.mjs';
import {toBRL,today} from './fx.mjs';
import {customDimensionColumn,revenueFacts} from './model.mjs';

const kind='gam-whatsapp';
export function whatsappFacts(report,network,{sourceKey,campaignKey=null}){
 if(!campaignKey){
  const sourceColumn=report.mode==='CUSTOM_DIMENSION'?customDimensionColumn(report,sourceKey):'Dimension.CUSTOM_CRITERIA';
  if(report.rows.some(row=>!Object.hasOwn(row,sourceColumn)))throw new AdsError('O GAM não retornou a coluna utm_source.');
  return revenueFacts(report,network,'utm_source')
   .filter(fact=>fact.utm==='whats')
   .map(fact=>({...fact,utm:'',traffic_source:'whats',campaign_detailed:false}));
 }
 const sourceColumn=customDimensionColumn(report,sourceKey);
 const campaignColumn=customDimensionColumn(report,campaignKey);
 if(report.rows.some(row=>!Object.hasOwn(row,sourceColumn)||!Object.hasOwn(row,campaignColumn)))
  throw new AdsError('O GAM não retornou as colunas de origem e campanha.');
 const rows=report.rows.filter(row=>row[sourceColumn]==='whats').map(row=>({
  ...row,[campaignColumn]:['','/empty/','(not set)','(Not applicable)'].includes(String(row[campaignColumn]??''))?'(sem campanha)':row[campaignColumn]
 }));
 return revenueFacts({...report,rows},network).map(fact=>({...fact,traffic_source:'whats',campaign_detailed:true}));
}

export function createWhatsAppReport(db,{warehouse,admanager,networks,deductions}){
 let job=null;
 const range=({start,end})=>{
  dateRange(start,end);
  if(end>today())throw new AdsError('A data final não pode estar no futuro.',{status:400});
  return {start,end};
 };
 const facts=db.prepare('SELECT data FROM roi_daily_facts WHERE kind=? AND source=? AND day BETWEEN ? AND ? ORDER BY day,ordinal');
 function report(input,{sites=null,readonly=false}={}){
  const {start,end}=range(input),rates=warehouse.readRates(start,end),config=deductions.read(),rows=new Map(),coverage=[];
  const taxable=config.enabled&&config.tax_enabled&&config.tax_percent>0;
  const taxPending=taxable&&config.tax_base==='profit';
  for(const network of networks()){
   const days=warehouse.sourceDays(kind,network.id,start,end);
   coverage.push({name:network.name,days:days.filter(day=>day.collected_at).length,error:days.find(day=>day.error)?.error||null,
    collectedAt:days.map(day=>day.collected_at).filter(Boolean).sort().at(-1)||null});
   for(const record of facts.all(kind,network.id,start,end)){
    const fact=JSON.parse(record.data);
    if(fact.traffic_source!=='whats'||sites&&!sites.includes(fact.site))continue;
    const key=JSON.stringify([fact.date,fact.site,fact.utm,fact.campaign_detailed]);
    if(!rows.has(key))rows.set(key,{date:fact.date,site:fact.site,campaign:fact.utm,detailed:fact.campaign_detailed,
     impressions:0,gross:0,revenue:0,provisional:false});
    const row=rows.get(key),gross=toBRL(fact.revenue,fact.currency,fact.date,rates);
    const after=gross==null?null:gross*(1-shareRate(config,network.id));
    const revenue=after==null?null:after*(taxable&&config.tax_base==='revenue'?1-config.tax_percent/100:1);
    row.gross=row.gross==null||gross==null?null:row.gross+gross;
    row.revenue=row.revenue==null||revenue==null?null:row.revenue+revenue;
    row.impressions+=fact.impressions;
    row.provisional||=fact.currency==='USD'&&Boolean(rates[fact.date]?.cached);
   }
  }
  const publicCoverage=readonly?[{name:'Ad Manager',days:coverage.length?Math.min(...coverage.map(network=>network.days)):0,
   error:coverage.some(network=>network.error)?'Uma fonte está pendente de atualização.':null,collectedAt:null}]:coverage;
  return {start,end,rows:[...rows.values()],coverage:publicCoverage,job:readonly?null:job,readonly,taxPending,deductions:config.enabled};
 }
 async function collect(selection,start,end){
  let successful=0;
  for(const network of selection){
   job={...job,message:'Consultando '+network.name+'…'};
   try{
    const keys=await admanager.keys(network.id),source=keys.find(key=>key.name==='utm_source'&&['ON','CUSTOM_DIMENSION'].includes(key.reportableType));
    const campaign=keys.find(key=>key.name==='utm_campaign'&&key.reportableType==='CUSTOM_DIMENSION');
    if(!source)throw new AdsError('Habilite utm_source para relatórios no GAM.');
    const detailed=source.reportableType==='CUSTOM_DIMENSION'&&Boolean(campaign);
    const query={start,end,key:detailed?campaign.id:source.id,mode:source.reportableType==='CUSTOM_DIMENSION'?'CUSTOM_DIMENSION':'CUSTOM_CRITERIA',
     ...(detailed?{additionalKeys:[source.id]}:{})};
    const data=await admanager.report(network.id,query);
    const rows=whatsappFacts(data,network,{sourceKey:source.id,campaignKey:detailed?campaign.id:null});
    warehouse.saveSource(kind,network.id,start,end,rows);
    successful++;
   }catch(error){
    warehouse.failSource(kind,network.id,start,end,error instanceof AdsError?error.message:'Falha ao consultar a receita do WhatsApp no GAM.');
   }
  }
  job={running:false,start,end,message:`Consulta concluída em ${successful} de ${selection.length} rede(s).`};
 }
 function refresh(input){
  const {start,end}=range(input),selection=networks();
  if(job?.running)throw new AdsError('Já existe uma consulta de WhatsApp em andamento.',{status:409});
  if(!selection.length)throw new AdsError('Selecione as redes nas fontes do ROI.',{status:400});
  job={running:true,start,end,message:'Preparando consulta ao GAM…'};
  void collect(selection,start,end).catch(()=>{job={running:false,start,end,message:'A consulta foi interrompida. Os dados válidos foram preservados.'};});
  return job;
 }
 return {report,refresh,activeJobs:()=>job?.running?1:0};
}
