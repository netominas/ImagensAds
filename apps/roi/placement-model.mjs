import {adsMetrics} from './public/ads-metrics.js';
import {gamMetrics} from './public/gam-metrics.js';
import {toBRL} from './fx.mjs';
import {revenueFacts} from './model.mjs';

// Keep subdomains and paths: reducing to registrable domains can merge distinct publishers.
export function placementKey(value,type=''){
 if(typeof value!=='string')return null;const raw=value.trim();if(!raw||/[{}\s]/.test(raw)||/^(other|unknown|--|\(not set\))$/i.test(raw))return null;
 if(type&&type!=='WEBSITE')return 'opaque:'+raw;
 try{const u=new URL(raw.includes('://')?raw:'https://'+raw);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||!u.hostname.includes('.')||u.port)return null;return 'web:'+u.hostname.toLowerCase().replace(/^www\./,'')+(u.pathname==='/'?'':u.pathname.replace(/\/$/,''))+u.search;}catch{return raw.startsWith('mobileapp::')?'opaque:'+raw:null;}
}
export function contentFacts(report,network){
 return revenueFacts(report,network,'utm_content').flatMap(r=>{const match=/^(\d{1,20})_(.*)$/.exec(r.utm);return match?[{...r,campaign:match[1],placement:match[2],placement_key:placementKey(match[2])}]:[];});
}
export function placementReport({account,campaign,start,end,ads=[],revenues=[],totals=[],rates={},complete=false,stale=false,collision=false,baseline=null}){
 ads=ads.filter(f=>f.account===account&&f.campaign===campaign&&f.date>=start&&f.date<=end);revenues=revenues.filter(f=>f.campaign===campaign&&f.date>=start&&f.date<=end);totals=totals.filter(f=>f.account===account&&f.campaign===campaign&&f.date>=start&&f.date<=end);
 const rows=new Map();const entry=(key,label,type='')=>{if(!rows.has(key))rows.set(key,{key,placement:label||'Não informado',type,ads:[],gam:[]});return rows.get(key);};
 for(const f of ads.filter(f=>f.account===account&&f.campaign===campaign&&f.date>=start&&f.date<=end))entry(f.placement_key||'ads:'+f.placement,f.placement,f.type).ads.push(f);
 for(const f of revenues.filter(f=>f.campaign===campaign&&f.date>=start&&f.date<=end))entry(f.placement_key||'gam:unknown',f.placement).gam.push(f);
 const sum=(facts,field)=>{if(!facts.length)return null;let n=0;for(const f of facts){const value=toBRL(f[field],f.currency,f.date,rates);if(!Number.isFinite(value))return null;n+=value;}return n;};
 let revenueTotal=sum(revenues.filter(r=>r.campaign===campaign),'revenue'),overlap=baseline?.revenue!=null&&revenueTotal!=null&&revenueTotal>baseline.revenue+Math.max(.01,baseline.revenue*.01);
 const items=[...rows.values()].map(r=>{const cost=sum(r.ads,'cost'),revenue=sum(r.gam,'revenue'),timezone=r.ads.length&&r.gam.some(f=>r.ads.some(a=>a.timezone!==f.timezone));
  const matched=!!r.ads.length&&!!r.gam.length&&r.key.startsWith('web:')&&complete&&!stale&&!collision&&!overlap&&!timezone&&cost!=null&&revenue!=null;
  const status=collision?'ambiguous_campaign':timezone?'timezone':overlap?'revenue_overlap':!complete||stale?'incomplete':matched?'matched':r.ads.length&&r.gam.length&&!r.key.startsWith('web:')?'unmapped_type':r.ads.length?'cost_only':'revenue_only';
  return {placement:r.placement,type:r.type||'WEBSITE',key:r.key,cost,revenue,profit:matched?revenue-cost:null,roi:matched&&cost>0?(revenue-cost)/cost:null,comparable:matched,status,clicks:r.ads.length?r.ads.reduce((s,f)=>s+f.clicks,0):null,impressions:r.ads.length?r.ads.reduce((s,f)=>s+f.impressions,0):null,...adsMetrics(r.ads,rates),...gamMetrics(r.gam,rates),sites:[...new Set(r.gam.map(f=>f.site))]};
 }).sort((a,b)=>(b.cost??-1)-(a.cost??-1)||a.placement.localeCompare(b.placement));
 const eligible=items.filter(r=>r.comparable),comparedCost=eligible.reduce((s,r)=>s+r.cost,0),comparedRevenue=eligible.reduce((s,r)=>s+r.revenue,0),detailCost=sum(ads,'cost'),campaignCost=sum(totals,'cost');
 return {account,campaign,start,end,rows:items,complete,stale,totals:{cost:eligible.length?comparedCost:null,revenue:eligible.length?comparedRevenue:null,profit:eligible.length?comparedRevenue-comparedCost:null,roi:eligible.length&&comparedCost>0?(comparedRevenue-comparedCost)/comparedCost:null},coverage:{matched:eligible.length,placements:items.length,campaign_cost:campaignCost,detail_cost:detailCost,cost_difference:campaignCost!=null&&detailCost!=null?campaignCost-detailCost:null,tracked_revenue:revenueTotal,campaign_revenue:baseline?.revenue??null},warnings:[...(!complete?['A coleta de placements está incompleta. Lucro e ROI aguardam as fontes.']:[]),...(stale?['A última atualização de uma fonte falhou. Os dados anteriores foram preservados.']:[]),...(collision?['O ID da campanha aparece em mais de uma conta. A receita por utm_content exige desambiguação.']:[]),...(overlap?['A receita de utm_content supera o relatório de utm_campaign. Confira os valores enviados nas tags; o ROI foi mantido em aberto.']:[])]};
}
