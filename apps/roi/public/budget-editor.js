export function budgetEditor({api,onChanged}){
 const $=id=>document.getElementById(id),dialog=$('budget-dialog'),form=$('budget-form');let current,quote,scope,busy=false,operation=null;
 const money=(micros,currency)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency}).format(Number(micros)/1e6);
 const values=new Map(),fetched=new Map(),pendingAccounts=new Set();
 function paint(){for(const button of document.querySelectorAll('.campaign-budget-button[data-budget-account]')){
  const data=values.get(button.dataset.budgetAccount+':'+button.dataset.budgetCampaign);
  if(data){const label=money(data.micros,data.currency)+(data.period==='DAILY'?'/dia':' total');button.textContent='✎ '+label;button.title='Alterar orçamento atual: '+label+(data.shared?' · compartilhado':'')+(data.stale?' · última consulta falhou; valor salvo':'')+(data.updated?' · consultado em '+new Date(data.updated).toLocaleString('pt-BR'):'');button.setAttribute('aria-label','Alterar orçamento da campanha '+button.dataset.budgetCampaign+': '+label);}
  else{button.textContent=pendingAccounts.has(button.dataset.budgetAccount)?'✎ …':'✎ —';button.title=pendingAccounts.has(button.dataset.budgetAccount)?'Carregando orçamento atual':'Orçamento indisponível. Clique para consultar e editar.';button.setAttribute('aria-label','Consultar orçamento da campanha '+button.dataset.budgetCampaign);}
 }}
 function rememberValue(data){for(const c of data.campaigns||[{id:data.campaign}])values.set(data.account+':'+c.id,{...data,campaign:c.id,micros:data.next??data.micros,updated:new Date().toISOString(),stale:false});paint();}
 async function loadValues(){
  const accounts=[...new Set([...document.querySelectorAll('.campaign-budget-button[data-budget-account]')].map(b=>b.dataset.budgetAccount))].filter(a=>!pendingAccounts.has(a)&&Date.now()-(fetched.get(a)||0)>=30*60000);if(!accounts.length){paint();return;}
  accounts.forEach(a=>pendingAccounts.add(a));paint();
  try{const data=await api('/campaign-budgets?'+new URLSearchParams({accounts:accounts.join(',')}));for(const item of data.items){const key=item.account+':'+item.campaign,old=values.get(key);if(!old?.updated||Date.parse(item.updated)>=Date.parse(old.updated))values.set(key,item);}for(const a of accounts)fetched.set(a,Date.now()-((data.warnings||[]).some(w=>w.account===a)?29*60000:0));}
  catch{for(const a of accounts)fetched.set(a,Date.now()-29*60000);}
  finally{accounts.forEach(a=>pendingAccounts.delete(a));paint();}
 }
 function message(text){$('budget-message').textContent=text;}
 function lock(value){busy=value;for(const field of form.elements)field.disabled=value;$('budget-close').disabled=value;$('budget-confirm').disabled=value;$('budget-check').disabled=value;}
 function resetQuote(){quote=null;$('budget-review').hidden=true;$('budget-confirm').hidden=true;$('budget-shared').checked=false;}
 function remember(value){try{if(value)localStorage.setItem('roi-budget-pending',JSON.stringify(value));else localStorage.removeItem('roi-budget-pending');}catch{}}
 function pending(){try{return JSON.parse(localStorage.getItem('roi-budget-pending'));}catch{return null;}}
 async function completed(result){
  rememberValue(result);
  operation=null;remember(null);$('budget-review').hidden=true;$('budget-confirm').hidden=true;$('budget-check').hidden=true;form.hidden=true;
  $('budget-current').textContent=money(result.next,result.currency)+(result.period==='DAILY'?' por dia':' no total');message('Orçamento atualizado no Google Ads. A alteração foi registrada no histórico de '+result.campaigns.length+' campanha(s).');
  await onChanged(result);
 }
 async function check(){
  if(!operation)return;lock(true);message('Consultando o resultado do envio…');
  try{const result=await api('/budget-operation?id='+encodeURIComponent(operation));if(result.status==='DONE')await completed(result);else if(result.status==='FAILED'){remember(null);message(result.error||'A alteração não foi aplicada. Feche e reabra o ajuste.');$('budget-check').hidden=true;}else{message(result.error||'O envio ainda está em andamento. Consulte o resultado novamente.');$('budget-check').hidden=false;}}
  catch(error){message(error.message+' Use Consultar resultado antes de repetir qualquer ajuste.');$('budget-check').hidden=false;}
  finally{lock(false);}
 }
 async function open(account,campaign){
  if(busy||dialog.open)return;scope={account,campaign};current=null;operation=null;resetQuote();form.reset();form.hidden=true;$('budget-check').hidden=true;$('budget-current').textContent='Consultando…';$('budget-name').textContent='Campanha '+campaign;message('Carregando orçamento atual do Google Ads…');dialog.showModal();lock(true);
  try{
   current=await api('/budget?'+new URLSearchParams(scope));rememberValue(current);$('budget-name').textContent=current.name;$('budget-current').textContent=money(current.micros,current.currency)+(current.period==='DAILY'?' por dia':' no total');$('budget-currency').textContent='Moeda da conta: '+current.currency;
   const existing=pending();if(existing?.account===account&&(existing.campaign===campaign||current.campaigns.some(c=>c.id===existing.campaign))){operation=existing.id;$('budget-check').hidden=false;message('Há um envio anterior a conferir. Use Consultar resultado.');}
   else if(current.blocked)message('Há uma alteração em andamento ou com resultado incerto neste orçamento. Confira o Google Ads antes de novos ajustes.');
   else{form.hidden=false;message('Defina o novo valor ou o percentual de aumento.');}
  }catch(error){message(error.message);}
  finally{lock(false);}
 }
 $('budget-close').onclick=()=>dialog.close();dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
 $('budget-mode').onchange=()=>{resetQuote();$('budget-value').value='';$('budget-value-label').textContent=$('budget-mode').value==='increase_percent'?'Aumentar em (%)':'Novo orçamento ('+(current?.currency||'')+')';};
 $('budget-value').oninput=resetQuote;
 form.onsubmit=async event=>{
  event.preventDefault();if(busy||!current||!form.reportValidity())return;lock(true);resetQuote();message('Validando o ajuste no Google Ads…');
  try{
   quote=await api('/budget-preview',{...scope,expected:current.micros,mode:$('budget-mode').value,value:$('budget-value').value.trim()});
   $('budget-before').textContent=money(quote.micros,quote.currency);$('budget-after').textContent=money(quote.next,quote.currency);$('budget-affected').replaceChildren(...quote.campaigns.map(c=>{const li=document.createElement('li');li.textContent=c.name+' · '+c.id;return li;}));
   $('budget-shared-label').hidden=!quote.shared;$('budget-review-label').textContent=quote.shared?'Orçamento compartilhado: todas estas campanhas serão afetadas.':'Campanha que receberá o ajuste';$('budget-review').hidden=false;$('budget-confirm').hidden=false;message('Confira os valores e confirme para aplicar no Google Ads.');
  }catch(error){message(error.message);}
  finally{lock(false);}
 };
 $('budget-confirm').onclick=async()=>{
  if(busy||!quote)return;if(quote.shared&&!$('budget-shared').checked){message('Marque a confirmação das campanhas que compartilham este orçamento.');return;}
  operation=quote.id;remember({...scope,id:operation});lock(true);$('budget-confirm').hidden=true;message('Aplicando no Google Ads…');
  try{await completed(await api('/budget-apply',{id:operation,confirmShared:$('budget-shared').checked}));}
  catch(error){form.hidden=true;message(error.message+' Consulte o resultado antes de repetir o envio.');$('budget-check').hidden=false;}
  finally{lock(false);}
 };
 $('budget-check').onclick=()=>void check();
 return {open,bind(){document.querySelectorAll('[data-budget-account]').forEach(button=>button.onclick=()=>void open(button.dataset.budgetAccount,button.dataset.budgetCampaign));void loadValues();}};
}
