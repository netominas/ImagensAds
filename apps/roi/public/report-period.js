export function previousMonth(now=new Date()){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit'}).formatToParts(now),part=type=>Number(parts.find(p=>p.type===type).value);
 const end=new Date(Date.UTC(part('year'),part('month')-1,0,12)),start=new Date(Date.UTC(end.getUTCFullYear(),end.getUTCMonth(),1,12));
 return {start:start.toISOString().slice(0,10),end:end.toISOString().slice(0,10)};
}
export function reportPeriod(url,now=new Date()){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now),part=type=>parts.find(p=>p.type===type).value;
 const today=part('year')+'-'+part('month')+'-'+part('day'),startDay=new Date(today+'T12:00:00Z');startDay.setUTCDate(startDay.getUTCDate()-6);const week=startDay.toISOString().slice(0,10);
 const params=url.searchParams,explicit=params.get('start')&&params.get('end');
 if(explicit){const start=params.get('start'),end=params.get('end'),month=previousMonth(now);return {start,end,preset:end===today&&start===today?'today':end===today&&start===week?'7':start===month.start&&end===month.end?'last_month':'custom'};}
 const detail=Boolean(params.get('account')&&params.get('campaign'));
 return {start:detail?week:today,end:today,preset:detail?'7':'today'};
}

// Placement dates are independent from the parent campaign report.
export function placementPeriod(preset,now=new Date()){
 const current=reportPeriod(new URL('https://roi.local/?account=1&campaign=1'),now);
 if(preset==='7')return {start:current.start,end:current.end};
 if(preset==='today')return {start:current.end,end:current.end};
 if(preset==='yesterday'){const day=new Date(current.end+'T12:00:00Z');day.setUTCDate(day.getUTCDate()-1);const yesterday=day.toISOString().slice(0,10);return {start:yesterday,end:yesterday};}
 throw new Error('Período de placements inválido.');
}
export function validatePlacementPeriod(start,end,now=new Date()){
 for(const date of [start,end])if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)throw new Error('Informe datas válidas para os placements.');
 if(start>end)throw new Error('A data inicial deve ser anterior ou igual à data final.');
 if(end>placementPeriod('today',now).end)throw new Error('A data final não pode estar no futuro.');
 if((Date.parse(end)-Date.parse(start))/86400000>92)throw new Error('Use um período de até 93 dias.');
 return {start,end};
}
