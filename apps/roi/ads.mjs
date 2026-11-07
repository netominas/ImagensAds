import {attribution,finalURLs} from './model.mjs';
import {dateRange} from './admanager.mjs';
// Destination identity does not depend on the cost reported for each unit.
function destinations(units,campaign,customer){
 const candidates=[];
 for(const p of units){const urls=p.unit.finalUrls;if(!Array.isArray(urls)||!urls.length)return null;for(const url of urls){const a=attribution(url,campaign,customer,p.group,p.unit);if(!a.site||!finalURLs([url]).length)return null;candidates.push(a);}}
 if(!candidates.length||new Set(candidates.map(a=>a.site)).size!==1)return null;
 const utms=[...new Set(candidates.map(a=>a.utm).filter(Boolean))];
 return {site:candidates[0].site,utm:utms.length===1?utms[0]:'',attribution_utms:utms};
}
export async function costFacts(google,account,start,end){
 dateRange(start,end);const q=`segments.date BETWEEN '${start}' AND '${end}'`,cid=account.id,mcc=account.mcc;
 const customer=(await google.search(cid,'SELECT customer.id, customer.tracking_url_template, customer.final_url_suffix, customer.currency_code, customer.time_zone FROM customer',mcc))[0]?.customer;if(!customer)throw Error('Conta sem dados.');
 const fields='metrics.clicks, metrics.average_cpc, metrics.conversions, metrics.interactions, metrics.conversions_from_interactions_rate, metrics.cost_per_conversion',active=r=>Number(r.metrics.costMicros||0)>0||Number(r.metrics.conversions||0)>0||Number(r.metrics.interactions||0)>0;
 const base=(await google.search(cid,`SELECT campaign.id, campaign.name, campaign.advertising_channel_type, campaign.tracking_url_template, campaign.final_url_suffix, campaign.url_custom_parameters, segments.date, metrics.cost_micros, ${fields} FROM campaign WHERE ${q}`,mcc)).filter(active);
 if(!base.length)return [];
 const metadata=new Map(base.map(r=>[r.campaign.id,r.campaign])),parts=[];
 const ads=await google.search(cid,`SELECT campaign.id, ad_group_ad.ad.id, ad_group_ad.ad.final_urls, ad_group_ad.ad.tracking_url_template, ad_group_ad.ad.final_url_suffix, ad_group_ad.ad.url_custom_parameters, ad_group.tracking_url_template, ad_group.final_url_suffix, ad_group.url_custom_parameters, metrics.cost_micros, ${fields}, segments.date FROM ad_group_ad WHERE ${q}`,mcc);
 parts.push(...ads.filter(active).map(r=>({...r,unit:r.adGroupAd.ad,group:r.adGroup||{}})));
 if(base.some(r=>r.campaign.advertisingChannelType==='PERFORMANCE_MAX')){
  const assets=await google.search(cid,`SELECT campaign.id, asset_group.id, asset_group.final_urls, metrics.cost_micros, ${fields}, segments.date FROM asset_group WHERE ${q}`,mcc);parts.push(...assets.filter(active).map(r=>({...r,unit:r.assetGroup,group:{}})));
 }
 const facts=[],buckets=new Map();
 for(const p of parts){if(!metadata.has(p.campaign.id))continue;const k=JSON.stringify([p.campaign.id,p.segments.date]);if(!buckets.has(k))buckets.set(k,[]);buckets.get(k).push(p);}
 const measures=r=>({clicks:Number(r.metrics.clicks||0),average_cpc:Number(r.metrics.averageCpc||0)/1e6,conversions:Number(r.metrics.conversions||0),interactions:Number(r.metrics.interactions||0),conversion_rate:Number(r.metrics.conversionsFromInteractionsRate||0),cost_per_conversion:Number(r.metrics.costPerConversion||0)/1e6});
 const fact=(r,cost,attr)=>({account:cid,account_name:account.name,campaign:String(r.campaign.id),campaign_type:r.campaign.advertisingChannelType||null,name:r.campaign.name,date:r.segments.date,currency:customer.currencyCode,timezone:customer.timeZone,cost,ads_metrics:measures(r),...attr});
 let configured;
 async function configuredUnits(){
  if(configured)return configured;
  // Include zero-traffic units too: partial metrics alone cannot prove that all
  // destinations belong to one site. No historical site inference from names.
  configured=[];const ids=[...metadata.keys()].join(',');
  try{
   const allAds=await google.search(cid,`SELECT campaign.id, ad_group_ad.ad.final_urls, ad_group_ad.ad.tracking_url_template, ad_group_ad.ad.final_url_suffix, ad_group_ad.ad.url_custom_parameters, ad_group.tracking_url_template, ad_group.final_url_suffix, ad_group.url_custom_parameters FROM ad_group_ad WHERE campaign.id IN (${ids})`,mcc);
   configured.push(...allAds.filter(p=>metadata.get(p.campaign.id)?.advertisingChannelType!=='PERFORMANCE_MAX').map(p=>({...p,unit:p.adGroupAd.ad,group:p.adGroup||{}})));
   const pmax=[...metadata.values()].filter(c=>c.advertisingChannelType==='PERFORMANCE_MAX').map(c=>c.id);
   if(pmax.length){const allAssets=await google.search(cid,`SELECT campaign.id, asset_group.final_urls FROM asset_group WHERE campaign.id IN (${pmax.join(',')})`,mcc);configured.push(...allAssets.map(p=>({...p,unit:p.assetGroup,group:{}})));}
  }catch{configured=[];}
  return configured;
 }
 for(const r of base){const rows=buckets.get(JSON.stringify([r.campaign.id,r.segments.date]))||[],metricsMatch=['conversions','interactions','clicks'].every(k=>Math.abs(Number(r.metrics[k]||0)-rows.reduce((s,p)=>s+Number(p.metrics[k]||0),0))<=.00001),total=Number(r.metrics.costMicros||0),sum=rows.reduce((s,p)=>s+Number(p.metrics.costMicros||0),0);
  // Never count both a campaign total and its ad/asset-group breakdown.
  if(!rows.length||Math.abs(total-sum)>Math.max(10,total*.000001)){
   const units=(await configuredUnits()).filter(p=>p.campaign.id===r.campaign.id),observed=destinations([...units,...rows],r.campaign,customer),attr=units.length?observed:null;
   facts.push(fact(r,total/1e6,{...(attr||{site:'',utm:''}),final_urls:finalURLs([...units,...rows].flatMap(p=>p.unit.finalUrls||[])),reason:attr?'Site único confirmado pelas URLs; custo total da campanha preservado':'Custo sem detalhamento conciliável por site',cost_source:'campaign',detail_cost:sum/1e6,cost_difference:(total-sum)/1e6}));continue;
  }
  for(const p of rows){
   const attr=destinations([p],r.campaign,customer)||{site:'',utm:'',reason:'Múltiplos destinos ou URL ausente'};
   facts.push(fact(r,Number(p.metrics.costMicros||0)/1e6,{...attr,ads_metrics:metricsMatch?measures(p):null,final_urls:finalURLs(p.unit.finalUrls)}));
  }
 }return facts;
}
