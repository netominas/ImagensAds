const byId=id=>document.getElementById(id);
const form=byId('push-period'),status=byId('push-status'),refresh=byId('push-refresh'),body=byId('push-rows');
const siteFilter=byId('push-site'),providerFilter=byId('push-provider'),typeFilter=byId('push-type'),search=byId('push-search');
const money=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const number=new Intl.NumberFormat('pt-BR');
const date=value=>value.split('-').reverse().join('/');
const showMoney=value=>value==null?'—':money.format(value);
const providers={aiweb:'AIWeb',pushalert:'PushAlert',pushnews:'PushNews'};
const types={welcome:'Welcome',broadcast:'Broadcast',other:'Outro'};
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const start=new Date(today+'T12:00:00Z');
start.setUTCDate(start.getUTCDate()-6);
form.elements.start.value=start.toISOString().slice(0,10);
form.elements.end.value=today;
form.elements.start.max=form.elements.end.max=today;
let data=null,timer=null,request=0,lastQuery=null;

function providerLabel(value){return Object.hasOwn(providers,value)?providers[value]:value;}
function options(select,values,all,label){
 const current=select.value;
 select.replaceChildren(new Option(all,''),...[...new Set(values)].filter(Boolean).sort().map(value=>new Option(label(value),value)));
 if([...select.options].some(option=>option.value===current))select.value=current;
}
function sumRevenue(rows){return rows.length&&rows.every(row=>row.revenue!=null)?rows.reduce((sum,row)=>sum+row.revenue,0):null;}
function render(){
 if(!data)return;
 const query=search.value.trim().toLowerCase();
 const rows=data.rows.filter(row=>(!siteFilter.value||row.site===siteFilter.value)&&(!providerFilter.value||row.provider===providerFilter.value)&&
  (!typeFilter.value||row.type===typeFilter.value)&&(!query||row.campaign.toLowerCase().includes(query)))
  .sort((a,b)=>b.date.localeCompare(a.date)||(b.revenue??-Infinity)-(a.revenue??-Infinity)||a.campaign.localeCompare(b.campaign));
 body.replaceChildren();
 for(const row of rows){
  const tr=body.insertRow();
  for(const value of [date(row.date),row.site||'Sem domínio',providerLabel(row.provider),types[row.type],row.campaign,
   row.mediums.length?row.mediums.join(', ')+(row.inferred?' · parcial':''):'Inferido pela campanha',
   number.format(row.impressions),showMoney(row.gross),showMoney(row.revenue)])tr.insertCell().textContent=value;
 }
 if(!rows.length){
  const cell=body.insertRow().insertCell();
  cell.colSpan=9;cell.className='empty';cell.textContent='Nenhuma campanha de Push encontrada para os filtros selecionados.';
 }
 byId('push-total').textContent=showMoney(sumRevenue(rows));
 for(const type of ['welcome','broadcast'])byId('push-'+type).textContent=showMoney(sumRevenue(rows.filter(row=>row.type===type)));
 byId('push-impressions').textContent=rows.length?number.format(rows.reduce((sum,row)=>sum+row.impressions,0)):'—';
 const messages=[date(lastQuery.start)+' a '+date(lastQuery.end)+' · '+rows.length+' linha(s) por data e campanha.'];
 if(!data.coverage.length)messages.push('Nenhuma rede GAM está selecionada nas fontes do ROI.');
 if(data.coverage.some(network=>network.days<data.days))messages.push('Há dias sem coleta em algumas redes. Consulte a cobertura abaixo.');
 if(rows.some(row=>row.provisional))messages.push('Parte da conversão usa PTAX provisória.');
 if(rows.some(row=>row.revenue==null))messages.push('Há valores sem câmbio disponível.');
 if(data.job)messages.push(data.job.message);
 status.textContent=messages.join(' ');
}
async function api(path,options){
 const response=await fetch('/apps/roi/api/push'+path,options);
 if(response.status===401){location.assign('/login');throw Error('Entre novamente para abrir o relatório.');}
 const result=await response.json();
 if(!response.ok)throw Error(result.error||'Falha ao consultar o relatório.');
 return result;
}
async function load(period,{poll=false}={}){
 const current=++request;
 clearTimeout(timer);
 if(!poll){status.textContent='Consultando dados salvos…';refresh.disabled=true;}
 try{
  const result=await api('?'+new URLSearchParams(period));
  if(current!==request)return;
  const days=(Date.parse(period.end)-Date.parse(period.start))/86400000+1;
  data={...result,days};lastQuery=period;
  options(siteFilter,data.rows.map(row=>row.site),'Todos os sites',value=>value);
  options(providerFilter,data.rows.map(row=>row.provider),'Todos os fornecedores',providerLabel);
  byId('push-deductions').textContent=!data.deductions?'A receita atribuída usa os valores brutos do GAM.':data.taxPending?'A receita atribuída inclui Revenue Share quando ativo. O imposto sobre lucro aguarda informação de custo.':'A receita atribuída considera os descontos ativos configurados no ROI.';
  const coverage=byId('push-coverage');coverage.replaceChildren();
  for(const network of data.coverage){
   const item=document.createElement('li');
   item.textContent=network.name+' · '+network.days+'/'+days+' dias coletados · '+network.exactDays+' com consulta de utm_medium'+
    (network.exactAt?' · Consulta direta em '+new Date(network.exactAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}):'')+(network.error?' · '+network.error:'');
   coverage.append(item);
  }
  render();
  if(data.job?.running)timer=setTimeout(()=>void load(lastQuery,{poll:true}),5000);
 }catch(error){if(current===request)status.textContent=error.message;}
 finally{if(current===request)refresh.disabled=Boolean(data?.job?.running);}
}
const selectedPeriod=()=>Object.fromEntries(new FormData(form));
form.addEventListener('submit',event=>{event.preventDefault();void load(selectedPeriod());});
for(const filter of [siteFilter,providerFilter,typeFilter])filter.addEventListener('change',render);
search.addEventListener('input',render);
refresh.addEventListener('click',async()=>{
 if(!form.reportValidity())return;
 const period=selectedPeriod();
 refresh.disabled=true;
 try{
  await api('/refresh',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(period)});
  await load(period);
 }catch(error){status.textContent=error.message;refresh.disabled=false;}
});
void load(selectedPeriod());
