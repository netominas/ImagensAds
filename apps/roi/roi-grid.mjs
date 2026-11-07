import {shiftDay,daysBetween} from './warehouse.mjs';
import {dateRange} from './admanager.mjs';
import {today} from './fx.mjs';
import {site as domain} from './model.mjs';
import {AdsError} from '../google-ads/client.mjs';

export function gridPeriod(site,end=today()){
 if(typeof site!=='string'||(!site||site!=='Sem site identificado'&&domain(site)!==site))throw new AdsError('Selecione um site válido.',{status:400});
 dateRange(end,end);if(end>today())throw new AdsError('A data final não pode estar no futuro.',{status:400});return {site,start:shiftDay(end,-9),end};
}
export function roiGrid({site,start,end,days,allowed=()=>true}){
 const dates=daysBetween(start,end),campaigns=new Map();let missing=false,stale=false;
 for(const day of days){const complete=day.result.data_coverage.complete,failure=day.result.data_coverage.stale_days>0;missing=missing||!complete;stale=stale||failure;
  for(const row of day.result.rows){if(!allowed(row)||(site==='Sem site identificado'?!!row.site:row.site!==site))continue;
   const key=row.account+':'+row.campaign;if(!campaigns.has(key))campaigns.set(key,{account:row.account,campaign:row.campaign,name:row.name,type:row.campaign_type||null,cost_total:0,byDate:new Map()});const campaign=campaigns.get(key);campaign.name=row.name;campaign.type=row.campaign_type||campaign.type;campaign.cost_total+=row.cost||0;
   const status=!complete?'missing':failure?'stale':row.missing_fx?'fx':row.timezone_mismatch?'timezone':row.ambiguous?'ambiguous':!row.comparable?'unlinked':row.cost===0?'zero_cost':'ok';
   campaign.byDate.set(day.date,{date:day.date,cost:row.cost,revenue:row.revenue,profit:status==='ok'||status==='zero_cost'?row.profit:null,roi:status==='ok'&&Number.isFinite(row.roi)?row.roi:null,status});
  }
 }
 const rows=[...campaigns.values()].sort((a,b)=>b.cost_total-a.cost_total||a.name.localeCompare(b.name,'pt-BR')).map(({byDate,...r})=>({...r,cells:dates.map(date=>{if(byDate.has(date))return byDate.get(date);const d=days.find(d=>d.date===date),status=!d?.result.data_coverage.complete?'missing':d.result.data_coverage.stale_days>0?'stale':'no_activity';return {date,cost:null,revenue:null,profit:null,roi:null,status};})}));
 return {site,start,end,dates,rows,currency:'BRL',missing,stale,today:today(),warnings:[...(missing?['Há dias ainda não importados. Os percentuais disponíveis são exibidos por dia, sem preencher pendências com zero.']:[]),...(stale?['Uma ou mais fontes falharam na última atualização. Os dias afetados ficam sinalizados.']:[])]};
}
