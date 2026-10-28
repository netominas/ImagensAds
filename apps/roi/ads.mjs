import {attribution,finalURLs} from './model.mjs';
import {dateRange} from './admanager.mjs';
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
 const fact=(r,cost,attr)=>({account:cid,account_name:account.name,campaign:String(r.campaign.id),name:r.campaign.name,date:r.segments.date,currency:customer.currencyCode,timezone:customer.timeZone,cost,ads_metrics:measures(r),...attr});
 for(const r of base){const rows=buckets.get(JSON.stringify([r.campaign.id,r.segments.date]))||[],metricsMatch=['conversions','interactions','clicks'].every(k=>Math.abs(Number(r.metrics[k]||0)-rows.reduce((s,p)=>s+Number(p.metrics[k]||0),0))<=.00001),total=Number(r.metrics.costMicros||0),sum=rows.reduce((s,p)=>s+Number(p.metrics.costMicros||0),0);
  // Never count both a campaign total and its ad/asset-group breakdown.
  if(!rows.length||Math.abs(total-sum)>Math.max(10,total*.000001)){facts.push(fact(r,total/1e6,{site:'',utm:'',final_urls:finalURLs(rows.flatMap(p=>p.unit.finalUrls||[])),reason:'Custo sem detalhamento conciliável por site'}));continue;}
  for(const p of rows){const candidates=(p.unit.finalUrls||[]).map(url=>attribution(url,r.campaign,customer,p.group,p.unit)),unique=new Map(candidates.map(a=>[JSON.stringify([a.site,a.utm]),a]));
   const attr=unique.size===1?[...unique.values()][0]:{site:'',utm:'',reason:'Múltiplos destinos ou URL ausente'};
   facts.push(fact(r,Number(p.metrics.costMicros||0)/1e6,{...attr,ads_metrics:metricsMatch?measures(p):null,final_urls:finalURLs(p.unit.finalUrls)}));
  }
 }return facts;
}
