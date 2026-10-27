export function reportPeriod(url,now=new Date()){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now),part=type=>parts.find(p=>p.type===type).value;
 const today=part('year')+'-'+part('month')+'-'+part('day'),startDay=new Date(today+'T12:00:00Z');startDay.setUTCDate(startDay.getUTCDate()-6);const week=startDay.toISOString().slice(0,10);
 const params=url.searchParams,explicit=params.get('start')&&params.get('end');
 if(explicit){const start=params.get('start'),end=params.get('end');return {start,end,preset:end===today&&start===today?'today':end===today&&start===week?'7':'custom'};}
 const detail=Boolean(params.get('account')&&params.get('campaign'));
 return {start:detail?week:today,end:today,preset:detail?'7':'today'};
}
