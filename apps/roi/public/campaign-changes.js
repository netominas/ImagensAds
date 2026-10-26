export function campaignChangePanel({api,onSaved=()=>{}}){
 const $=id=>document.getElementById(id),panel=$('campaign-changes'),form=$('change-form');
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const newId=()=>crypto.randomUUID().replaceAll('-','');
 let context=null,key='',items=[],types=[],recordId=newId(),version=0,saving=false;
 function message(text,error=false){$('change-message').textContent=text;$('change-message').classList.toggle('negative',error);}
 function busy(value){saving=value;for(const control of form.elements)control.disabled=value;$('changes-list').querySelectorAll('button').forEach(b=>b.disabled=value);$('change-retry').disabled=value;}
 function reset(){form.reset();recordId=newId();$('change-date').value=today();$('change-save').textContent='Salvar registro';$('change-editor-title').textContent='Adicionar alteração';$('change-cancel').hidden=true;}
 function render(){
  $('changes-count').textContent=items.length;
  $('changes-list').innerHTML=items.length?items.map(item=>`<article class="change-entry"><div class="change-entry-top"><div><time datetime="${esc(item.date)}">${esc(item.date.split('-').reverse().join('/'))}</time><strong>${esc(types.find(t=>t.value===item.type)?.label||item.type)}</strong></div><div class="change-actions">${item.source==='google_ads'?'<span class="change-origin">Google Ads · pelo painel</span>':`<button type="button" class="text-link" data-change-edit="${esc(item.id)}">Editar</button>`}</div></div><p>${esc(item.description)}</p></article>`).join(''):'<p class="changes-empty">Nenhuma alteração registrada nesta campanha.</p>';
  $('changes-list').querySelectorAll('[data-change-edit]').forEach(button=>button.onclick=()=>{const item=items.find(i=>i.id===button.dataset.changeEdit);if(!item||saving)return;recordId=item.id;$('change-type').value=item.type;$('change-date').value=item.date;$('change-description').value=item.description;$('change-save').textContent='Salvar edição';$('change-editor-title').textContent='Editar registro';$('change-cancel').hidden=false;$('change-editor').open=true;message('');$('change-type').focus();});
 }
 async function load(){
  const current=++version,scope={...context};message('Carregando histórico…');$('change-retry').hidden=true;busy(true);
  try{const data=await api('/campaign-changes?'+new URLSearchParams(scope));if(current!==version)return;items=data.items;types=data.types;$('change-type').innerHTML='<option value="">Selecione o tipo</option>'+types.map(t=>`<option value="${esc(t.value)}">${esc(t.label)}</option>`).join('');render();reset();message('');}
  catch(error){if(current===version){message(error.message,true);$('change-retry').hidden=false;}}
  finally{if(current===version)busy(false);}
 }
 $('change-retry').onclick=()=>void load();
 $('change-cancel').onclick=()=>{reset();$('change-editor').open=false;message('');};
 form.onsubmit=async event=>{
  event.preventDefault();if(saving||!context||!form.reportValidity())return;
  const current=version,body={...context,id:recordId,type:$('change-type').value,date:$('change-date').value,description:$('change-description').value};busy(true);message('Salvando…');
  try{const data=await api('/campaign-changes',body);if(current!==version)return;items=data.items;render();reset();$('change-editor').open=false;message('Registro salvo.');onSaved();}
  catch(error){if(current===version)message(error.message,true);}
  finally{if(current===version)busy(false);}
 };
 return {refresh:()=>context?load():Promise.resolve(),show(scope){panel.hidden=!scope;const next=scope?scope.account+':'+scope.campaign:'';if(next===key)return;key=next;context=scope;version++;items=[];$('changes-list').textContent='';$('changes-count').textContent='0';$('change-editor').open=false;reset();message('');if(scope)void load();}};
}
