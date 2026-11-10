import {placementGridPanel} from './placement-grid.js';
import {placementPeriod,validatePlacementPeriod} from './report-period.js';
import {stickyReportHeader} from './sticky-report.js';
export function placementsPanel({api,readOnly=false}){
 const $=id=>document.getElementById(id),panel=$('placements-panel'),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=v=>v==null?'—':new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:2}).format(v),pct=v=>v==null?'—':new Intl.NumberFormat('pt-BR',{style:'percent',maximumFractionDigits:1}).format(v),date=v=>v?.split('-').reverse().join('/')||'';
 const status={deductions_pending:'Descontos pendentes',matched:'Vinculado',cost_only:'Sem receita vinculada',revenue_only:'Sem custo identificado',timezone:'Fusos diferentes',incomplete:'Coleta pendente',ambiguous_campaign:'Campanha ambígua',revenue_overlap:'Receita divergente',unmapped_type:'Formato ainda não conciliado'};
 const columns=[['placement','Placement'],['clicks','Cliques Ads'],['cost','Custo'],['revenue','Receita'],['profit','Lucro'],['roi','ROI %'],['ecpm','eCPM'],['pmr','PMR'],['cpc','CPC GAM'],['conversion_rate','Conversão'],['cost_per_conversion','Custo/Conv'],['ads_cpc','CPC Ads']];
 let context=null,key='',version=0,timer=null,busy=false,data=null,sort='cost',direction=-1,exportRows=[],ownPeriod=false,pendingEnsure=false;
 const grid=placementGridPanel({api,readOnly});$('placements-grid').onclick=()=>{if(context)grid.open({...context,name:document.getElementById('campaign-detail-name').textContent});};
 stickyReportHeader(panel);$('placements-refresh').textContent=readOnly?'Recarregar placements':'Atualizar placements';
 function message(text){$('placements-message').textContent=text;}
 function filtered(){const q=$('placements-search').value.trim().toLocaleLowerCase('pt-BR'),filter=$('placements-filter').value;return (data?.rows||[]).filter(r=>!q||r.placement.toLocaleLowerCase('pt-BR').includes(q)).filter(r=>filter==='all'||(filter==='matched'?r.comparable:!r.comparable)).sort((a,b)=>{const x=a[sort],y=b[sort];if(x==null)return y==null?0:1;if(y==null)return -1;return (typeof x==='string'?x.localeCompare(y,'pt-BR'):x-y)*direction;});}
 function render(){
  const rows=filtered();exportRows=rows;$('placements-count').textContent=data?.rows.length||0;$('placements-showing').textContent=rows.length+' placements';$('placements-period').textContent=(context?date(context.start)+' a '+date(context.end):'')+(data?.deductions?.enabled?' · Descontos ativos · receita após Revenue Share e imposto configurados':'');$('placements-export').disabled=!rows.length;
  $('placements-head').innerHTML='<tr>'+columns.map(([k,label])=>'<th scope="col" aria-sort="'+(sort===k?(direction===1?'ascending':'descending'):'none')+'"><button type="button" data-placement-sort="'+k+'">'+label+(sort===k?(direction===1?' ↑':' ↓'):'')+'</button></th>').join('')+'</tr>';
  $('placements-head').querySelectorAll('[data-placement-sort]').forEach(b=>b.onclick=()=>{if(sort===b.dataset.placementSort)direction*=-1;else{sort=b.dataset.placementSort;direction=sort==='placement'?1:-1;}render();});
  $('placements-body').innerHTML=rows.length?rows.map(r=>'<tr><td><strong>'+esc(r.placement)+'</strong><small>'+esc(status[r.status]||r.status)+' · '+esc(({WEBSITE:'Site',MOBILE_APPLICATION:'Aplicativo',YOUTUBE_CHANNEL:'Canal YouTube',YOUTUBE_VIDEO:'Vídeo YouTube'})[r.type]||r.type)+'</small></td>'+columns.slice(1).map(([k])=>'<td class="'+(['profit','roi'].includes(k)&&r[k]!=null?(r[k]<0?'negative':'positive'):'')+'">'+(k==='clicks'?(r.clicks??'—'):['roi','pmr','conversion_rate'].includes(k)?pct(r[k]):money(r[k]))+'</td>').join('')+'</tr>').join(''):'<tr><td class="empty" colspan="12">'+(data?.job?.status==='running'?'Importando placements em segundo plano…':data?.complete?'Nenhum placement para este período ou filtro.':'Os dados de placements ainda não foram importados para este período.')+'</td></tr>';
  const t=data?.totals||{};$('placements-summary').innerHTML=[['Custo vinculado',money(t.cost)],['Receita vinculada',money(t.revenue)],['Lucro vinculado',money(t.profit)],['ROI vinculado',pct(t.roi)]].map(([label,value])=>'<div><small>'+label+'</small><strong>'+value+'</strong></div>').join('');
  const c=data?.coverage;$('placements-coverage').textContent=c?`${c.matched} de ${c.placements} placements com ROI calculado. Custo total da campanha: ${money(c.campaign_cost)}. Custo detalhado por placement: ${money(c.detail_cost)}. Diferença sem rateio: ${money(c.cost_difference)}. Receita bruta identificada por utm_content: ${money(c.tracked_revenue)}. Atualizado: ${data.updated_at?new Date(data.updated_at).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}):'aguardando coleta'}.`:'';
  $('placements-sources').replaceChildren(...(data?.sources||[]).map(source=>{const li=document.createElement('li');li.textContent=source.name+' · '+(source.error|| (source.complete?'Coleta disponível':'Período ainda não importado'));return li;}));
 }
 function controls(){$('placements-refresh').disabled=busy||data?.job?.status==='running';}
 function schedule(delay=4000){clearTimeout(timer);if(context)timer=setTimeout(()=>void load(false),delay);}
 async function load(ensure=false){if(!context||busy)return;const current=version,scope={...context};busy=true;controls();try{
  const response=await api('/placements?'+new URLSearchParams(scope));if(current!==version)return;data=response;render();message(data.job?.status==='running'?'Atualizando placements e receita em segundo plano…':(data.warnings||[]).join(' '));
  if((ensure||pendingEnsure)&&!readOnly){if(data.job?.status==='running'){pendingEnsure=true;schedule();return;}pendingEnsure=false;const result=await api('/placements/ensure',scope);if(current!==version)return;if(result.id){message('Atualizando placements e receita em segundo plano…');schedule();}}
  if(data.job?.status==='running')schedule();
 }catch(e){if(current===version){message(e.message);if(/outra coleta de placements/.test(e.message)){pendingEnsure=true;schedule(15000);}}}finally{if(current===version){busy=false;controls();}}
 }
 $('placements-refresh').onclick=async()=>{if(!context||busy)return;if(readOnly){void load(false);return;}const current=version,scope={...context};busy=true;controls();try{await api('/placements/refresh',scope);if(current!==version)return;message('Atualizando placements e receita em segundo plano…');schedule();}catch(e){if(current===version)message(e.message);}finally{if(current===version){busy=false;controls();}}};
 function dateInputs(scope){
  const today=placementPeriod('today').end;$('placements-start').max=today;$('placements-end').max=today;
  if(!scope)return;$('placements-start').value=scope.start;$('placements-end').value=scope.end;
  $('placements-preset').value=['today','yesterday','7'].find(p=>{const range=placementPeriod(p);return range.start===scope.start&&range.end===scope.end;})||'custom';
 }
 function changeContext(scope){context=scope?{...scope}:null;version++;clearTimeout(timer);data=null;busy=false;pendingEnsure=false;message('');render();controls();if(scope)void load(true);}
 function applyDates(){if(!context)return;try{const range=validatePlacementPeriod($('placements-start').value,$('placements-end').value);ownPeriod=true;dateInputs(range);changeContext({...context,...range});}catch(e){message(e.message);}}
 $('placements-dates').onsubmit=event=>{event.preventDefault();applyDates();};
 $('placements-preset').onchange=()=>{const preset=$('placements-preset').value;if(preset==='custom'){$('placements-start').focus();return;}dateInputs(placementPeriod(preset));applyDates();};
 for(const id of ['placements-start','placements-end'])$(id).oninput=()=>{$('placements-preset').value='custom';};
 $('placements-search').oninput=render;$('placements-filter').onchange=render;
 $('placements-export').onclick=()=>{if(!exportRows.length)return;const safe=value=>'"'+String(value??'').replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"',records=[columns.map(c=>c[1]),...exportRows.map(r=>columns.map(([k])=>r[k]))],blob=new Blob(['\ufeff'+records.map(r=>r.map(safe).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='roi-placements-'+context.campaign+'-'+context.start+'-'+context.end+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 return {refresh:()=>context&&!busy?load(false):Promise.resolve(),show(scope){
  panel.hidden=!scope;const next=scope?JSON.stringify(scope):'';if(next===key)return;key=next;
  const sameCampaign=scope&&context&&scope.account===context.account&&scope.campaign===context.campaign;
  // Parent refreshes must not overwrite a period chosen inside this block.
  if(sameCampaign&&ownPeriod)return;
  if(!sameCampaign){grid.close();$('placements-disclosure').open=false;}
  ownPeriod=false;sort='cost';direction=-1;$('placements-search').value='';$('placements-filter').value='all';dateInputs(scope);changeContext(scope);
 }};
}
