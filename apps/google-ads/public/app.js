import {secureFetch} from '/access.js';
import './session.js';
const $ = id => document.getElementById(id);
const state = {accounts:[], data:null, rows:[], sort:'cost', dir:-1, page:1, size:12, currency:'BRL', request:0};
const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = value => value == null ? '—' : new Intl.NumberFormat('pt-BR',{style:'currency',currency:state.currency}).format(value);
const percent = value => value == null ? '—' : new Intl.NumberFormat('pt-BR',{style:'percent',minimumFractionDigits:2,maximumFractionDigits:2}).format(value);
const number = value => new Intl.NumberFormat('pt-BR',{maximumFractionDigits:2}).format(value);
const prettyId = id => id.replace(/^(\d{3})(\d{3})(\d{4})$/,'$1-$2-$3');
const channels = {SEARCH:'Pesquisa',DISPLAY:'Display',PERFORMANCE_MAX:'Performance Max',DEMAND_GEN:'Demand Gen',VIDEO:'Vídeo',SHOPPING:'Shopping',MULTI_CHANNEL:'App',SMART:'Smart',LOCAL:'Local'};
function notice(message='') { $('notice').hidden=!message; $('notice').textContent=message; }
function iso(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function dates(){
  if($('preset').value==='custom') return;
  const end=new Date(), start=new Date();
  if($('preset').value==='month'){start.setDate(1);}else{end.setDate(end.getDate()-1);start.setTime(end.getTime());start.setDate(start.getDate()-Number($('preset').value)+1);}
  $('start').value=iso(start);$('end').value=iso(end);
}
async function api(path){const response=await secureFetch(path);const result=await response.json();if(!response.ok)throw Error([result.error,...(result.codes||[])].join(' '));return result;}
function empty(title, detail='', loading=false){$('rows').innerHTML=`<tr><td colspan="6"><div class="empty">${loading?'<span class="loader"></span>':''}<strong>${escapeHTML(title)}</strong><p>${escapeHTML(detail)}</p></div></td></tr>`;}
function totals(rows){
  const t=rows.reduce((t,r)=>{for(const k of ['cost','conversions','interactions','clicks'])t[k]+=r[k];return t;},{cost:0,conversions:0,interactions:0,clicks:0});
  t.conversion_rate=t.interactions?t.conversions/t.interactions:null;t.cost_per_conversion=t.conversions?t.cost/t.conversions:null;t.cpc=t.clicks?t.cost/t.clicks:null;return t;
}
function filtered(){const q=$('search').value.trim().toLocaleLowerCase('pt-BR'),status=$('status').value;return(state.data?.rows||[]).filter(r=>(!q||`${r.name} ${r.id}`.toLocaleLowerCase('pt-BR').includes(q))&&(status==='all'||r.status===status));}
function render(){
  const rows=filtered();rows.sort((a,b)=>{const x=a[state.sort],y=b[state.sort];if(x==null)return y==null?0:1;if(y==null)return -1;return(typeof x==='string'?x.localeCompare(y,'pt-BR'):x-y)*state.dir;});state.rows=rows;
  const t=totals(rows);$('k-cost').textContent=money(t.cost);$('k-rate').textContent=percent(t.conversion_rate);$('k-cpa').textContent=money(t.cost_per_conversion);$('k-cpc').textContent=money(t.cpc);$('conversion-count').textContent=`${number(t.conversions)} conversões no período`;
  $('count').textContent=rows.length;state.page=Math.min(state.page,Math.max(1,Math.ceil(rows.length/state.size)));
  const start=(state.page-1)*state.size,subset=rows.slice(start,start+state.size);
  if(!rows.length)empty('Nenhuma campanha encontrada',state.data?.rows.length?'Ajuste a busca ou os filtros para visualizar as campanhas.':'Esta conta não retornou campanhas não removidas.');
  else $('rows').innerHTML=subset.map(r=>`<tr><td><div class="campaign-name" title="${escapeHTML(r.name)}"><span class="status-dot ${r.status==='ENABLED'?'':'paused'}" role="img" aria-label="${r.status==='ENABLED'?'Habilitada':'Pausada'}" title="${r.status==='ENABLED'?'Habilitada (não confirma veiculação)':'Pausada'}"></span><div class="text"><span>${escapeHTML(r.name)}</span><span class="campaign-meta">${escapeHTML(channels[r.channel]||r.channel)} · ${escapeHTML(r.id)}</span></div></div></td><td>${money(r.budget)}<span class="budget-caption">${r.budget_period==='DAILY'?'por dia':r.budget_period==='CUSTOM_PERIOD'?'total da campanha':'período não informado'}${r.shared_budget?' · compartilhado':''}</span></td><td class="cost-cell">${money(r.cost)}</td><td>${r.conversion_rate==null?'—':`<span class="rate-pill">${percent(r.conversion_rate)}</span>`}</td><td>${money(r.cost_per_conversion)}</td><td>${money(r.cpc)}</td></tr>`).join('');
  $('totals').hidden=!rows.length;$('totals').innerHTML=`<tr><td>Total das ${rows.length} campanhas filtradas</td><td title="Orçamentos podem ser compartilhados e ter períodos diferentes">—</td><td>${money(t.cost)}</td><td>${percent(t.conversion_rate)}</td><td>${money(t.cost_per_conversion)}</td><td>${money(t.cpc)}</td></tr>`;
  $('showing').textContent=rows.length?`Exibindo ${start+1}–${Math.min(start+state.size,rows.length)} de ${rows.length} campanhas`:'0 campanhas';$('page-label').textContent=`Página ${state.page} de ${Math.max(1,Math.ceil(rows.length/state.size))}`;$('prev').disabled=state.page<=1;$('next').disabled=start+state.size>=rows.length;$('export').disabled=!rows.length;
  document.querySelectorAll('[data-sort]').forEach(b=>{b.querySelector('.sort-mark').textContent=b.dataset.sort===state.sort?(state.dir===1?'↑':'↓'):'';b.closest('th').setAttribute('aria-sort',b.dataset.sort===state.sort?(state.dir===1?'ascending':'descending'):'none');});
}
async function load(refresh=false){
  const account=state.accounts.find(a=>a.id===$('account').value);if(!account)return;
  if(!$('start').value||!$('end').value||$('start').value>$('end').value){notice('Selecione uma data inicial e final válidas.');return;}
  const request=++state.request;state.data=null;state.rows=[];$('export').disabled=true;$('totals').hidden=true;notice();document.body.classList.add('loading');$('refresh').disabled=true;
  ['k-cost','k-rate','k-cpa','k-cpc'].forEach(id=>$(id).textContent='—');$('conversion-count').textContent='Conversões no período';$('count').textContent='—';$('showing').textContent='Carregando…';$('updated').textContent='Consultando Google Ads…';$('prev').disabled=true;$('next').disabled=true;
  $('account-context').textContent=`${prettyId(account.id)} · ${account.mcc_name} · ${account.currency} · ${account.timezone}`;
  empty('Carregando campanhas','Buscando orçamento e resultados do período selecionado.',true);
  try{
    const data=await api(`/apps/google-ads/api/campaigns?${new URLSearchParams({account:account.id,start:$('start').value,end:$('end').value,...(refresh?{refresh:'1'}:{})})}`);
    if(request!==state.request)return;state.data=data;state.currency=account.currency;state.page=1;render();
    $('updated').textContent=`Atualizado em ${new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(data.updated_at))}`;
    if(account.status!=='ENABLED')notice(`Conta com status ${account.status}. Os indicadores mostram o histórico disponível.`);
  }catch(e){if(request!==state.request)return;notice(e.message);empty('Não foi possível carregar as campanhas','Verifique o acesso à conta e clique em Atualizar para tentar novamente.');$('updated').textContent='Falha na atualização';$('showing').textContent='Consulta não concluída';}
  finally{if(request===state.request){document.body.classList.remove('loading');$('refresh').disabled=false;}}
}
async function init(){
  dates();try{
    const result=await api('/apps/google-ads/api/accounts');state.accounts=result.accounts;
    if(!state.accounts.length){empty('Nenhuma conta disponível','Conceda acesso à conta de serviço no Google Ads.');$('account').innerHTML='<option>Nenhuma conta</option>';return;}
    const groups=Map.groupBy?Map.groupBy(state.accounts,a=>a.mcc_name):state.accounts.reduce((m,a)=>{if(!m.has(a.mcc_name))m.set(a.mcc_name,[]);m.get(a.mcc_name).push(a);return m;},new Map());
    $('account').innerHTML=Array.from(groups,([name,items])=>`<optgroup label="${escapeHTML(name)}">${items.map(a=>`<option value="${a.id}">${escapeHTML(a.name)} · ${prettyId(a.id)}${a.status==='ENABLED'?'':` · ${escapeHTML(a.status)}`}</option>`).join('')}</optgroup>`).join('');
    if(state.accounts.some(a=>a.id==='2824527639'))$('account').value='2824527639';$('account').disabled=false;$('refresh').disabled=false;
    await load();if(result.warnings.length)notice(result.warnings.join(' '));
  }catch(e){notice(e.message);empty('Conexão indisponível','Recarregue a página para tentar novamente.');$('account').innerHTML='<option>Falha ao carregar contas</option>';}
}
$('account').addEventListener('change',()=>load());$('preset').addEventListener('change',()=>{dates();if($('preset').value!=='custom')load();});
['start','end'].forEach(id=>$(id).addEventListener('change',()=>{$('preset').value='custom';}));$('refresh').addEventListener('click',()=>load(true));
['search','status'].forEach(id=>$(id).addEventListener(id==='search'?'input':'change',()=>{state.page=1;if(state.data)render();}));
document.querySelectorAll('[data-sort]').forEach(b=>b.addEventListener('click',()=>{state.dir=state.sort===b.dataset.sort?-state.dir:(b.dataset.sort==='name'?1:-1);state.sort=b.dataset.sort;if(state.data)render();}));
$('prev').addEventListener('click',()=>{state.page--;render();});$('next').addEventListener('click',()=>{state.page++;render();});
$('export').addEventListener('click',()=>{
  const safe=value=>{let s=String(value??'');if(/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
  const csv=[['Nome da campanha','Orçamento atual','Período do orçamento','Compartilhado','Custo','Taxa de conversão','Custo por conversão','CPC médio','ID campanha','Status','Moeda'],...state.rows.map(r=>[r.name,r.budget,r.budget_period,r.shared_budget?'Sim':'Não',r.cost,r.conversion_rate==null?'':percent(r.conversion_rate),r.cost_per_conversion,r.cpc,r.id,r.status,state.currency])].map(r=>r.map(safe).join(';')).join('\r\n');
  const url=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=`campanhas-${state.data.account.id}-${state.data.start}-${state.data.end}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
init();
