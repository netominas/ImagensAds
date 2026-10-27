export const accountStateLabels={ENABLED:'Ativa',SUSPENDED:'Suspensa',CANCELED:'Cancelada',CLOSED:'Encerrada'};
export function paymentPanel({api}){
 const $=id=>document.getElementById(id),escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let data=null,visible=false,timer=null,loading=false;
 const date=value=>value?new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(new Date(value)):'Ainda não consultada';
 const status={APPROVED:'Aprovado',APPROVED_HELD:'Aprovado · aguardando orçamento',PENDING:'Pendente',CANCELLED:'Cancelado',REPORT_LAST_30_DAYS:'Presente no relatório GAM · últimos 30 dias'};
 function accountStateCell(a){
  if(a.kind!=='ads')return '<small>Não se aplica ao GAM</small>';
  const code=a.account_status,label=accountStateLabels[code]||'Não confirmado';
  return '<span class="account-state '+(Object.hasOwn(accountStateLabels,code)?code.toLowerCase():'unknown')+'">'+label+'</span>'+(a.status_error?'<small class="payment-error">'+escape(a.status_error)+(code?' Exibindo último estado confirmado.':'')+'</small>':'')+(a.status_updated?'<small>Verificado: '+escape(date(a.status_updated))+'</small>':'<small>Atualize para consultar o estado.</small>');
 }
 function render(){
  const query=$('payments-search').value.trim().toLocaleLowerCase('pt-BR'),kind=$('payments-kind').value,result=$('payments-result').value,accountState=$('payments-account-state').value;
  const items=(data?.items||[]).filter(a=>{const outcome=a.error?'error':!a.checked?'pending':a.profiles.length?'found':'empty';return (!accountState||(a.kind==='ads'&&(a.account_status||'UNKNOWN')===accountState))&&(!kind||a.kind===kind)&&(!result||outcome===result)&&(!query||[a.name,a.id,...a.profiles.flatMap(p=>[p.id,p.name,p.payments_account])].join(' ').toLocaleLowerCase('pt-BR').includes(query));});
  $('payments-rows').innerHTML=items.flatMap(a=>(a.profiles.length?a.profiles:[null]).map(p=>'<tr><td>'+escape(a.name||a.id)+(a.mcc_name?'<small>MCC: '+escape(a.mcc_name)+'</small>':'')+'</td><td>'+(a.kind==='ads'?'Google Ads':'Ad Manager')+'</td><td>'+escape(a.kind==='ads'?a.id.replace(/^(\d{3})(\d{3})(\d{4})$/,'$1-$2-$3'):a.id)+'</td><td>'+accountStateCell(a)+'</td><td class="payment-profile-id">'+escape(p?.id||'—')+(p?.payments_account?'<small>Conta de pagamentos: '+escape(p.payments_account)+'</small>':'')+'</td><td>'+escape(p?.name||'—')+'</td><td>'+(a.error?'<span class="payment-error">'+escape(a.error)+'</span>':p?escape(status[p.status]||p.status||'Identificado'):a.checked?'Nenhum perfil retornado pela API.':'Clique em Atualizar contas para consultar.')+(p?.start?'<small>Início: '+escape(p.start)+(p.end?' · Fim: '+escape(p.end):p.end_type==='FOREVER'?' · Sem data final':'')+'</small>':'')+'<small>Consulta: '+escape(date(a.checked))+'</small>'+(a.error&&a.updated?'<small>Último dado válido: '+escape(date(a.updated))+'</small>':'')+'</td></tr>')).join('')||'<tr><td colspan="7">'+(data?'Nenhuma conta corresponde aos filtros.':'Carregando contas…')+'</td></tr>';
  $('payments-count').textContent=data?items.length+' de '+data.items.length+' contas e redes · '+data.items.filter(a=>a.profiles.length).length+' com perfil identificado':'';
  $('payments-refresh').disabled=loading||Boolean(data?.progress?.running);
  if(data?.progress)$('payments-message').textContent=data.progress.running?'Consultando estados e perfis: '+data.progress.done+' de '+data.progress.total+' contas e redes.':'Consulta concluída: '+data.progress.done+' de '+data.progress.total+' contas e redes.';
 }
 async function load(refresh=false){if(loading)return;loading=true;render();try{data=await api(refresh?'/payments/refresh':'/payments',refresh?{}:undefined);render();}catch(error){$('payments-message').textContent=error.message;}finally{loading=false;render();clearTimeout(timer);if(visible&&data?.progress?.running)timer=setTimeout(()=>void load(),2000);}}
 $('payments-refresh').onclick=()=>void load(true);
 $('payments-search').oninput=render;for(const id of ['payments-kind','payments-result','payments-account-state'])$(id).onchange=render;
 return {show(value){if(value===visible)return;visible=value;clearTimeout(timer);if(visible)void load();}};
}
