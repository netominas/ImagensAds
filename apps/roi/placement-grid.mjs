import {daysBetween,shiftDay} from './warehouse.mjs';
import {dateRange} from './admanager.mjs';
import {today} from './fx.mjs';
import {AdsError} from '../google-ads/client.mjs';

export function placementGridPeriod({account,campaign,end=today()}){
 if(typeof account!=='string'||!/^\d{10}$/.test(account)||typeof campaign!=='string'||!/^\d{1,20}$/.test(campaign))throw new AdsError('Conta ou campanha inválida.',{status:400});
 dateRange(end,end);if(end>today())throw new AdsError('A data final não pode estar no futuro.',{status:400});
 return {account,campaign,start:shiftDay(end,-9),end};
}
// Daily reads use the same reconciliation, deductions and source coverage as the
// placement table. Never divide campaign-level totals between placements.
export function placementGrid({account,campaign,start,end,days}){
 const dates=daysBetween(start,end),channels=new Map(),byDay=new Map(days.map(d=>[d.date,d.report]));
 for(const {date,report}of days)for(const row of report.rows){
  if(!channels.has(row.key))channels.set(row.key,{key:row.key,placement:row.placement,type:row.type,cost_total:0,byDate:new Map()});
  const channel=channels.get(row.key);channel.cost_total+=row.cost||0;
  const status=!report.complete?'missing':report.stale?'stale':row.comparable?(row.cost===0?'zero_cost':'matched'):row.status;
  channel.byDate.set(date,{date,cost:row.cost,revenue:row.revenue,profit:['matched','zero_cost'].includes(status)?row.profit:null,roi:status==='matched'&&Number.isFinite(row.roi)?row.roi:null,status});
 }
 const rows=[...channels.values()].sort((a,b)=>b.cost_total-a.cost_total||a.placement.localeCompare(b.placement,'pt-BR')).map(({byDate,...row})=>({...row,cells:dates.map(date=>byDate.get(date)||{date,cost:null,revenue:null,profit:null,roi:null,status:!byDay.get(date)?.complete?'missing':byDay.get(date).stale?'stale':'no_activity'})}));
 const missing=days.length!==dates.length||days.some(d=>!d.report.complete),stale=days.some(d=>d.report.stale);
 return {account,campaign,start,end,dates,rows,today:today(),currency:'BRL',missing,stale,importing:days.some(d=>d.report.job?.status==='running'),deductions:days.at(-1)?.report.deductions,warnings:[...new Set(days.flatMap(d=>d.report.warnings||[])),...(missing?['Há dias sem coleta completa. Ausência de receita por utm_content não é preenchida nem rateada.']:[])]};
}
