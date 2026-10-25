export function campaignRows(result,{account,campaign,site=''}){
 return (result?.rows||[]).filter(r=>r.account===account&&r.campaign===campaign&&(!site||(site==='Sem site identificado'?!r.site||r.site===site:r.site===site)));
}
export function dailyReport(rows,rates={},start,end){
 if(!rows.length)return [];
 const days=new Map(),get=date=>{if(!days.has(date))days.set(date,{date,cost:0,revenue:0,comparable:rows.every(r=>r.comparable),missingCost:false,missingRevenue:false});return days.get(date);};
 // Only fill dates of an existing campaign in this saved report, never invent a campaign.
 if(/^\d{4}-\d{2}-\d{2}$/.test(start||'')&&/^\d{4}-\d{2}-\d{2}$/.test(end||'')){
  const date=new Date(start+'T00:00:00Z');for(let n=0;n<93&&date.toISOString().slice(0,10)<=end;n++,date.setUTCDate(date.getUTCDate()+1))get(date.toISOString().slice(0,10));
 }
 for(const row of rows)for(const [kind,entries]of [['cost',row.cost_original||[]],['revenue',row.revenue_original||[]]])for(const entry of entries){
  if((start&&entry.date<start)||(end&&entry.date>end))continue;
  const day=get(entry.date),rate=entry.currency==='BRL'?1:entry.currency==='USD'?rates[entry.date]?.rate:null;
  if(rate==null||!Number.isFinite(rate)||!Number.isFinite(entry.amount)){day[kind==='cost'?'missingCost':'missingRevenue']=true;day.comparable=false;}
  else day[kind]+=entry.amount*rate;
 }
 return [...days.values()].sort((a,b)=>a.date.localeCompare(b.date)).map(day=>{
  const cost=day.missingCost?null:day.cost,revenue=day.missingRevenue||rows.some(r=>r.revenue==null)?null:day.revenue,comparable=day.comparable&&cost!=null&&revenue!=null,profit=comparable?revenue-cost:null;
  return {date:day.date,cost,revenue,profit,roi:comparable&&cost>0?profit/cost:null,comparable};
 });
}
