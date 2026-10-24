import {getDomain} from 'tldts';
import {toBRL} from './fx.mjs';
export function site(value){try{const host=new URL(value.includes('://')?value:'https://'+value).hostname.toLowerCase();return getDomain(host,{allowPrivateDomains:true})||'';}catch{return '';}}
export function finalURLs(values){
 if(!Array.isArray(values))return [];
 return [...new Set(values.flatMap(value=>{if(typeof value!=='string'||value.length>8192)return [];try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?[u.href]:[];}catch{return [];}}))];
}
// UTM values are case-sensitive. Decode URL query values exactly once at extraction.
export function attribution(url,campaign,customer={},group={},ad={}){
 const domain=site(url),custom=new Map();for(const level of [campaign,group,ad])for(const v of level.urlCustomParameters||[])custom.set(v.key,v.value);
 const expand=s=>String(s||'').replace(/\{campaignid\}/gi,campaign.id).replace(/\{_([^}]+)\}/g,(m,key)=>custom.get(key)??m);
 const template=[ad,group,campaign,customer].find(x=>x.trackingUrlTemplate)?.trackingUrlTemplate;
 const suffix=[ad,group,campaign,customer].find(x=>x.finalUrlSuffix)?.finalUrlSuffix;
 let query;try{const target=expand(template||'{lpurl}').replace(/\{lpurl\}[?&]/gi,url+(url.includes('?')?'&':'?')).replace(/\{lpurl\}/gi,url);const u=new URL(target);if(suffix){const extra=new URLSearchParams(expand(suffix));for(const [k,v]of extra)u.searchParams.set(k,v);}query=u.searchParams;}catch{return {site:domain,utm:'',reason:'URL de rastreamento não resolvida'};}
 const utm=query.get('utm_campaign')||'';return {site:domain,utm:/[{}]/.test(utm)?'':utm,reason:/[{}]/.test(utm)?'UTM contém parâmetros dinâmicos não resolvidos':''};
}
export function revenueFacts(report,network,keyName='utm_campaign'){
 const output=[];const column=report.mode==='CUSTOM_DIMENSION'?`Dimension.TOP_LEVEL_DIMENSION_KEY[${report.key}]_VALUE`:'Dimension.CUSTOM_CRITERIA';
 for(const r of report.rows){
  let utm=String(r[column]||'');if(report.mode!=='CUSTOM_DIMENSION'){if(!utm.startsWith(keyName+'='))continue;utm=utm.slice(keyName.length+1);}
  if(!utm||['(not set)','(Not applicable)','/empty/'].includes(utm))continue;
  const revenue=Number(r['Column.AD_EXCHANGE_LINE_ITEM_LEVEL_REVENUE']),impressions=Number(r['Column.AD_EXCHANGE_LINE_ITEM_LEVEL_IMPRESSIONS']);
  if(!Number.isFinite(revenue)||!Number.isFinite(impressions))throw Error('Métricas de receita inválidas.');
  output.push({date:r['Dimension.DATE'],site:site(String(r['Dimension.DOMAIN']||'')),utm,network:network.id,network_name:network.name,currency:network.currency,timezone:network.timezone,revenue:revenue/1e6,impressions});
 }return output;
}
export function reconcile(costs,revenues,rates,rules=[],{partial=false}={}){
 const campaigns=new Map(),index=new Map(),rows=new Map(),key=(...v)=>JSON.stringify(v);
 const addIndex=(s,u,c)=>{if(!s||!u)return;const k=key(s,u);if(!index.has(k))index.set(k,new Set());index.get(k).add(c);};
 for(const c of costs){const cid=key(c.account,c.campaign);if(!campaigns.has(cid))campaigns.set(cid,[]);campaigns.get(cid).push(c);addIndex(c.site,c.utm,cid);addIndex(c.site,c.campaign,cid);}
 function entry(c,s){const k=key(c.account,c.campaign,s);if(!rows.has(k))rows.set(k,{key:k,account:c.account,account_name:c.account_name,campaign:c.campaign,name:c.name,site:s,final_urls:[],cost:0,revenue:0,utms:[],networks:[],status:'cost_only',impressions:0,missing_fx:false,cost_fx_missing:false,revenue_fx_missing:false,cost_original:[],revenue_original:[]});return rows.get(k);}
 for(const c of costs){const r=entry(c,c.site),amount=toBRL(c.cost,c.currency,c.date,rates);if(amount===null){r.missing_fx=true;r.cost_fx_missing=true;}else r.cost+=amount;r.cost_original.push({amount:c.cost,currency:c.currency,date:c.date});if(c.utm&&!r.utms.includes(c.utm))r.utms.push(c.utm);for(const url of finalURLs(c.final_urls))if(!r.final_urls.includes(url))r.final_urls.push(url);}
 let unmatchedRevenue=0,ambiguousRevenue=0,matchedRevenue=0;const pending=[];
 for(const revenue of revenues){
  const rule=rules.find(r=>r.network===revenue.network&&r.site===revenue.site&&r.utm===revenue.utm),candidates=rule?new Set([key(rule.account,rule.campaign)]):index.get(key(revenue.site,revenue.utm))||new Set();
  const valid=[...candidates].filter(cid=>campaigns.has(cid));const amount=toBRL(revenue.revenue,revenue.currency,revenue.date,rates);
  if(valid.length!==1){const status=valid.length>1?'ambiguous':'revenue_only';pending.push({...revenue,status,revenue_brl:amount,candidates:valid.map(cid=>({account:campaigns.get(cid)[0].account,campaign:campaigns.get(cid)[0].campaign,name:campaigns.get(cid)[0].name}))});if(amount!==null){if(valid.length>1)ambiguousRevenue+=amount;else unmatchedRevenue+=amount;}continue;}
  const cs=campaigns.get(valid[0]),c=cs.find(c=>c.site===revenue.site);if(!c){pending.push({...revenue,status:'revenue_only',revenue_brl:amount,candidates:[]});if(amount!==null)unmatchedRevenue+=amount;continue;}
  const r=entry(c,revenue.site);if(c.timezone!==revenue.timezone){r.timezone_mismatch=true;}
  r.status='matched';if(amount===null){r.missing_fx=true;r.revenue_fx_missing=true;}else{r.revenue+=amount;matchedRevenue+=amount;}r.impressions+=revenue.impressions;if(!r.utms.includes(revenue.utm))r.utms.push(revenue.utm);if(!r.networks.includes(revenue.network))r.networks.push(revenue.network);r.revenue_original.push({amount:revenue.revenue,currency:revenue.currency,date:revenue.date});
 }
 const result=[...rows.values()];for(const r of result){r.ambiguous=pending.some(p=>p.status==='ambiguous'&&p.site===r.site&&p.candidates.some(c=>c.account===r.account&&c.campaign===r.campaign));r.comparable=r.status==='matched'&&!r.missing_fx&&!r.timezone_mismatch&&!r.ambiguous&&!partial;r.profit=r.comparable?r.revenue-r.cost:null;r.roi=r.comparable&&r.cost>0?r.profit/r.cost:null;if(r.status!=='matched'||r.revenue_fx_missing)r.revenue=null;if(r.cost_fx_missing)r.cost=null;}
 const eligible=result.filter(r=>r.comparable),totals={cost:eligible.reduce((s,r)=>s+r.cost,0),revenue:eligible.reduce((s,r)=>s+r.revenue,0)};totals.profit=totals.revenue-totals.cost;totals.roi=totals.cost>0?totals.profit/totals.cost:null;
 const sites=new Map();for(const r of result){const s=r.site||'Sem site identificado';if(!sites.has(s))sites.set(s,{site:s,cost:0,revenue:0,campaigns:0,pending:0,compared:0});const g=sites.get(s);g.campaigns++;if(r.comparable){g.compared++;g.cost+=r.cost;g.revenue+=r.revenue;}else g.pending++;}
 for(const r of new Map(pending.map(p=>[key(p.network,p.site,p.utm),p])).values()){const s=r.site||'Sem site identificado';if(!sites.has(s))sites.set(s,{site:s,cost:0,revenue:0,campaigns:0,pending:0,compared:0});sites.get(s).pending++;}
 for(const g of sites.values()){g.profit=g.compared?g.revenue-g.cost:null;g.roi=g.cost>0?g.profit/g.cost:null;if(!g.compared){g.cost=null;g.revenue=null;}}
 return {rows:result.sort((a,b)=>b.cost-a.cost),sites:[...sites.values()].sort((a,b)=>b.cost-a.cost),pending,totals,coverage:{matched:eligible.length,campaigns:result.length,cost_pending:result.filter(r=>!r.comparable).reduce((s,r)=>s+r.cost,0),unmatched_revenue:unmatchedRevenue,ambiguous_revenue:ambiguousRevenue,matched_revenue:matchedRevenue},partial};
}
