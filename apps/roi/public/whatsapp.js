const byId=id=>document.getElementById(id),form=byId('whatsapp-period'),status=byId('whatsapp-status');
const refresh=byId('whatsapp-refresh'),siteFilter=byId('whatsapp-site'),campaignFilter=byId('whatsapp-campaign'),group=byId('whatsapp-group');
const money=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}),number=new Intl.NumberFormat('pt-BR');
const date=day=>day.split('-').reverse().join('/');
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const shift=offset=>{const day=new Date(today+'T12:00:00Z');day.setUTCDate(day.getUTCDate()+offset);return day.toISOString().slice(0,10);};
const showMoney=value=>value==null?'—':money.format(value);
const campaignName=value=>value||'Sem detalhamento de campanha';
let data=null,timer=null,request=0;
form.elements.start.value=shift(-6);form.elements.end.value=today;
form.elements.start.max=form.elements.end.max=today;

function options(select,values,all,label){
 const selected=select.value;
 select.replaceChildren(new Option(all,''),...[...new Set(values)].sort().map(value=>new Option(label(value),value)));
 if([...select.options].some(option=>option.value===selected))select.value=selected;
}
const campaignKey=row=>JSON.stringify([row.detailed,row.campaign]);
function sum(rows,metric){return rows.length&&rows.every(row=>row[metric]!=null)?rows.reduce((total,row)=>total+row[metric],0):null;}
function appendRow(target,values,header=false){
 const tr=document.createElement('tr');
 for(const value of values){
  const cell=document.createElement(header?'th':'td');
  cell.textContent=value;
  tr.append(cell);
 }
 target.append(tr);
}
function render(){
 if(!data)return;
 const rows=data.rows.filter(row=>(!siteFilter.value||row.site===siteFilter.value)&&(!campaignFilter.value||campaignKey(row)===campaignFilter.value));
 const grouped=new Map(),daily=group.value==='daily';
 byId('whatsapp-date-header').hidden=!daily;
 for(const row of rows){
  const site=group.value==='campaign'?'Todos os sites':row.site;
  const campaign=group.value==='site'?'Todas as campanhas':campaignName(row.campaign);
  const key=JSON.stringify([daily?row.date:null,site,campaign]);
  if(!grouped.has(key))grouped.set(key,{date:row.date,site,campaign,impressions:0,gross:0,revenue:0});
  const entry=grouped.get(key);
  for(const metric of ['gross','revenue'])entry[metric]=entry[metric]==null||row[metric]==null?null:entry[metric]+row[metric];
  entry.impressions+=row.impressions;
 }
 const display=[...grouped.values()].sort((a,b)=>(daily?b.date.localeCompare(a.date):0)||(b.revenue??-Infinity)-(a.revenue??-Infinity)||a.site.localeCompare(b.site)||a.campaign.localeCompare(b.campaign));
 const body=byId('whatsapp-rows');body.replaceChildren();
 for(const row of display)appendRow(body,[...(daily?[date(row.date)]:[]),row.site||'Sem domínio',row.campaign,number.format(row.impressions),showMoney(row.gross),showMoney(row.revenue)]);
 if(!display.length){
  const cell=body.insertRow().insertCell();
  cell.colSpan=daily?6:5;cell.className='empty';
  cell.textContent='Nenhuma receita de WhatsApp disponível para este período e filtros. Confira a cobertura das redes.';
 }
 const impressions=rows.reduce((total,row)=>total+row.impressions,0);
 const gross=sum(rows,'gross'),revenue=sum(rows,'revenue');
 byId('whatsapp-total').textContent=showMoney(revenue);byId('whatsapp-gross').textContent=showMoney(gross);
 byId('whatsapp-impressions').textContent=rows.length?number.format(impressions):'—';
 byId('whatsapp-count').textContent=rows.length?number.format(new Set(rows.filter(row=>row.detailed).map(row=>row.campaign)).size):'—';
 const footer=byId('whatsapp-footer');footer.replaceChildren();footer.hidden=!rows.length;
 appendRow(footer,[...(daily?['']:[]),'Total filtrado','',number.format(impressions),showMoney(gross),showMoney(revenue)]);
 const days=(Date.parse(data.end)-Date.parse(data.start))/86400000+1;
 const messages=[date(data.start)+' a '+date(data.end)+' · '+display.length+' resultado(s).'];
 if(!data.coverage.length)messages.push('Selecione as redes GAM nas fontes do ROI.');
 if(data.coverage.some(network=>network.days<days))messages.push('Há dias sem coleta. Use Atualizar no GAM e confira a cobertura.');
 if(rows.some(row=>!row.detailed))messages.push('Parte da receita aguarda o detalhamento por campanha no GAM.');
 if(rows.some(row=>row.provisional))messages.push('Conversão com PTAX provisória em parte dos valores.');
 if(rows.some(row=>row.revenue==null))messages.push('Há valores em dólar aguardando cotação.');
 if(data.job)messages.push(data.job.message);
 status.textContent=messages.join(' ');
}
async function api(path,options){
 const response=await fetch('/apps/roi/api/whatsapp'+path,options);
 if(response.status===401){location.assign('/login');throw Error('Entre novamente para consultar o relatório.');}
 const result=await response.json();
 if(!response.ok)throw Error(result.error||'Falha ao consultar o relatório.');
 return result;
}
async function load(period){
 const current=++request;
 clearTimeout(timer);refresh.disabled=true;status.textContent='Consultando dados salvos…';
 try{
  const result=await api('?'+new URLSearchParams(period));
  if(current!==request)return;
  data=result;
  options(siteFilter,data.rows.map(row=>row.site),'Todos os sites',value=>value||'Sem domínio');
  const names=new Map(data.rows.map(row=>[campaignKey(row),campaignName(row.campaign)]));
  options(campaignFilter,[...names.keys()],'Todas as campanhas',value=>names.get(value));
  byId('whatsapp-deductions').textContent=!data.deductions?'A receita atribuída usa os valores brutos do GAM.':data.taxPending?'A receita atribuída considera o Revenue Share ativo. O imposto sobre lucro aguarda os custos dos grupos.':'A receita atribuída considera os descontos ativos do ROI.';
  const coverage=byId('whatsapp-coverage');coverage.replaceChildren();
  const days=(Date.parse(data.end)-Date.parse(data.start))/86400000+1;
  for(const network of data.coverage){
   const li=document.createElement('li');
   li.textContent=network.name+' · '+network.days+'/'+days+' dias coletados'+(network.collectedAt?' · Última coleta '+new Date(network.collectedAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}):'')+(network.error?' · '+network.error:'');
   coverage.append(li);
  }
  render();
  if(data.job?.running)timer=setTimeout(()=>void load(period),5000);
 }catch(error){if(current===request)status.textContent=error.message;}
 finally{if(current===request)refresh.disabled=Boolean(data?.job?.running);}
}
const period=()=>Object.fromEntries(new FormData(form));
form.addEventListener('submit',event=>{event.preventDefault();void load(period());});
byId('whatsapp-preset').addEventListener('change',event=>{
 const preset=event.target.value;if(preset==='custom')return;
 form.elements.start.value=preset==='7'?shift(-6):preset==='yesterday'?shift(-1):today;
 form.elements.end.value=preset==='yesterday'?shift(-1):today;
 void load(period());
});
for(const name of ['start','end'])form.elements[name].addEventListener('change',()=>{byId('whatsapp-preset').value='custom';});
for(const filter of [siteFilter,campaignFilter,group])filter.addEventListener('change',render);
refresh.addEventListener('click',async()=>{
 if(!form.reportValidity())return;
 const selected=period();refresh.disabled=true;
 try{
  await api('/refresh',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(selected)});
  await load(selected);
 }catch(error){status.textContent=error.message;refresh.disabled=false;}
});
void load(period());
