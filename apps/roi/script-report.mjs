import {parse} from 'csv-parse/sync';
import {AdsError} from '../google-ads/client.mjs';
import {costFacts} from './ads.mjs';
import {dateRange} from './admanager.mjs';
import {today} from './fx.mjs';

const invalid=message=>new AdsError(message,{status:400});
const fail=()=>invalid('Os quatro CSVs precisam ser da mesma execução do script atualizado.');
const keys=['campaigns','account','daily','destinations'];
function tracking(row,fields){
 const [template,suffix,params]=fields;
 const custom=JSON.parse(row[params]||'[]');
 if(!Array.isArray(custom))throw fail();
 return {trackingUrlTemplate:row[template],finalUrlSuffix:row[suffix],urlCustomParameters:custom};
}
const trackingColumns=['Modelo de rastreamento','Sufixo da URL final','Parâmetros personalizados (JSON)'];
const metricsColumns={'Custo (micros)':'costMicros','Cliques':'clicks','Interações':'interactions','Conversões':'conversions','CPC médio (micros)':'averageCpc','Taxa de conversão':'conversionsFromInteractionsRate','Custo por conversão (micros)':'costPerConversion'};
function metrics(row){
 return Object.fromEntries(Object.entries(metricsColumns).map(([label,field])=>{
  const number=Number(row[label]?.replace(',','.'));
  if(!row[label]?.trim()||!Number.isFinite(number)||number<0&&field!=='conversions')throw fail();
  return [field,number];
 }));
}
function detail(row){
 const campaign={id:row['Campanha ID']},id=row['Recurso ID'],finalUrls=JSON.parse(row['URLs finais (JSON)']);
 if(!Array.isArray(finalUrls)||!finalUrls.every(url=>typeof url==='string'))throw fail();
 if(row.Recurso==='Grupo PMax')return {campaign,assetGroup:{id,finalUrls}};
 if(row.Recurso!=='Anúncio')throw fail();
 return {campaign,adGroup:{...tracking(row,['Modelo do grupo','Sufixo do grupo','Parâmetros do grupo (JSON)'])},
  adGroupAd:{ad:{id,finalUrls,...tracking(row,['Modelo do anúncio','Sufixo do anúncio','Parâmetros do anúncio (JSON)'])}}};
}

export async function importScriptReport(body,accounts){
 try{
  const required={
   account:['Conta','Moeda','Fuso','Coletado em (UTC)','Início','Fim',...trackingColumns],
   campaigns:['Data','Conta','Campanha ID','Campanha','Tipo','Moeda','Fuso','Coletado em (UTC)',...trackingColumns,...Object.keys(metricsColumns)],
   destinations:['Conta','Campanha ID','Recurso','Recurso ID','URLs finais (JSON)','Coletado em (UTC)']
  };
  required.daily=['Data',...required.destinations,...Object.keys(metricsColumns)];
  const tables=Object.fromEntries(keys.map(key=>{
   if(typeof body[key]!=='string'||!body[key].trim())throw fail();
   const columns=header=>{
    if(new Set(header).size!==header.length||!required[key].every(name=>header.includes(name)))throw fail();
    return header;
   };
   return [key,parse(body[key],{columns,bom:true,skip_empty_lines:true,max_record_size:100000})];
  }));
  const [metadata]=tables.account;
  const account=accounts.find(a=>a.id===metadata?.Conta);
  const captured=metadata?.['Coletado em (UTC)'];
  if(tables.account.length!==1||!account||!Number.isFinite(Date.parse(captured))||Date.parse(captured)>Date.now()+300000||
     !['BRL','USD'].includes(metadata.Moeda)||!metadata.Fuso)throw fail();
  for(const key of keys)if(tables[key].some(row=>row.Conta!==account.id||row['Coletado em (UTC)']!==captured))throw fail();
  const start=metadata['Início'],end=metadata.Fim;
  dateRange(start,end);
  if(end>today())throw fail();
  const campaignDays=new Set();
  const campaigns=tables.campaigns.map(row=>{
   const id=row['Campanha ID'],key=id+':'+row.Data;
   if(!/^\d{1,20}$/.test(id||'')||campaignDays.has(key)||row.Moeda!==metadata.Moeda||row.Fuso!==metadata.Fuso||row.Data<start||row.Data>end)throw fail();
   dateRange(row.Data,row.Data);
   campaignDays.add(key);
   return {campaign:{id,name:row.Campanha,advertisingChannelType:row.Tipo,...tracking(row,trackingColumns)},segments:{date:row.Data},metrics:metrics(row)};
  });
  const daily=tables.daily.map(row=>{
   dateRange(row.Data,row.Data);
   if(row.Data<start||row.Data>end)throw fail();
   return {...detail(row),segments:{date:row.Data},metrics:metrics(row)};
  });
  const configured=tables.destinations.map(detail);
  const customer={id:account.id,currencyCode:metadata.Moeda,timeZone:metadata.Fuso,...tracking(metadata,trackingColumns)};
  const search=async(_account,query)=>{
   if(query.includes('FROM customer'))return [{customer}];
   if(query.includes('FROM campaign'))return campaigns;
   const rows=query.includes('segments.date')?daily:configured;
   return rows.filter(row=>query.includes('FROM asset_group')?row.assetGroup:row.adGroupAd);
  };
  const facts=await costFacts({search},account,start,end);
  return {account:account.id,start,end,captured,facts};
 }catch(error){
  if(error instanceof AdsError)throw error;
  throw fail();
 }
}
