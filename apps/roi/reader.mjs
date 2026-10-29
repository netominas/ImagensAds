import {canCampaign,canAccount} from '../../lib/users.mjs';
import {gamMetrics} from './public/gam-metrics.js';

// Filter after global reconciliation: removing other campaigns before matching
// could incorrectly turn an ambiguous UTM into authorized revenue.
export function readerReport(run,user){
 const source=run.result,rows=source.rows.filter(r=>canCampaign(user,r.account,r.campaign));
 const eligible=rows.filter(r=>r.comparable),totals={cost:eligible.reduce((s,r)=>s+r.cost,0),revenue:eligible.reduce((s,r)=>s+r.revenue,0)};totals.profit=totals.revenue-totals.cost;totals.roi=totals.cost>0?totals.profit/totals.cost:null;
 const sites=new Map();for(const r of rows){const site=r.site||'Sem site identificado';if(!sites.has(site))sites.set(site,{site,campaigns:0,pending:0,compared:0,cost:0,revenue:0});const g=sites.get(site);g.campaigns++;if(r.comparable){g.compared++;g.cost+=r.cost;g.revenue+=r.revenue;}else g.pending++;}
 for(const g of sites.values()){Object.assign(g,gamMetrics(eligible.filter(r=>(r.site||'Sem site identificado')===g.site).flatMap(r=>r.gam_original||[]),source.rates));g.profit=g.compared?g.revenue-g.cost:null;g.roi=g.cost>0?g.profit/g.cost:null;if(!g.compared){g.cost=null;g.revenue=null;}}
 const accounts=run.config.accounts.filter(a=>canAccount(user,a));
 return {id:'database',database:true,status:'done',start:run.start,end:run.end,config:{start:run.start,end:run.end,accounts,networks:[],links:[]},result:{rows,sites:[...sites.values()],pending:[],totals,coverage:{matched:eligible.length,campaigns:rows.length,cost_pending:rows.filter(r=>!r.comparable).reduce((s,r)=>s+(r.cost||0),0),unmatched_revenue:0,ambiguous_revenue:0,matched_revenue:totals.revenue},partial:source.partial,warnings:source.partial?['Há dados pendentes de atualização. Os dados disponíveis foram preservados.']:[],sources:(source.sources||[]).filter(s=>s.kind==='ads'&&accounts.includes(s.id)).map(({kind,id,name,ok,collected_at})=>({kind,id,name,ok,collected_at})),rates:source.rates,currency:'BRL',revenue_label:'Receita estimada Ad Exchange',updated_at:source.updated_at,database:true,revision:source.revision,data_coverage:{complete:source.data_coverage.complete,missing_days:source.partial?1:0,stale_days:0},report_ids:[]}};
}
