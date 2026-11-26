const normalize=value=>String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');

// Native options remain the source of truth for report scope and saved settings.
export function sourceSelector({select,list,search,count,activityFilter=null,onVerify=null}){
 let choices=[];
 function filter(){
  const query=normalize(search.value);
  let visible=0;
  for(const choice of choices){const a=choice.activity,mode=activityFilter?.value||'',hasSpend=!!a?.last_spend,hasActive=(a?.active_campaigns||0)>0;
   const matches=!mode||mode==='spend'&&hasSpend||mode==='active'&&hasActive||mode==='overlooked'&&!choice.option.selected&&(hasSpend||hasActive)||mode==='selected'&&choice.option.selected||mode==='unknown'&&!a?.covered_days&&a?.active_campaigns==null;
   choice.row.hidden=!matches||!normalize(choice.text).includes(query);if(!choice.row.hidden)visible++;}
  count.textContent=select.selectedOptions.length+' de '+select.options.length+' selecionadas'+(query?' · '+visible+' encontradas':'');
  list.querySelector('.source-empty')?.remove();
  if(!visible){const empty=document.createElement('p');empty.className='source-empty';empty.textContent=query?'Nenhuma fonte encontrada.':'Nenhuma fonte disponível.';list.append(empty);}
 }
 search.addEventListener('input',filter);activityFilter?.addEventListener('change',filter);
 return {refresh(items){
  list.replaceChildren();choices=[];
  for(const option of select.options){
   const item=items.find(item=>item.id===option.value)||{},label=document.createElement('label'),input=document.createElement('input'),copy=document.createElement('span'),name=document.createElement('strong'),detail=document.createElement('small');
   label.className='source-choice';input.type='checkbox';input.value=option.value;input.checked=option.selected;
   name.textContent=item.name||option.value;
   const status=select.id==='accounts'?({ENABLED:'Ativa',SUSPENDED:'Suspensa',CANCELED:'Cancelada',CLOSED:'Encerrada',UNAVAILABLE:'Acesso indisponível'}[item.status]||'Estado não confirmado'):(item.available===false?'Acesso a revisar':'Acesso identificado');
   const id=select.id==='accounts'?option.value.replace(/^(\d{3})(\d{3})(\d{4})$/,'$1-$2-$3'):option.value;
   detail.textContent=[id,item.currency,status].filter(Boolean).join(' · ');
   copy.append(name,detail);label.append(input,copy);const row=document.createElement('div');row.className='source-row';row.append(label);list.append(row);
   const a=item.activity;
   if(select.id==='accounts'){
    const activity=document.createElement('small');activity.className='source-activity';
    const amount=a?.spend!=null?new Intl.NumberFormat('pt-BR',{style:'currency',currency:a.currency||'BRL'}).format(a.spend):'valor indisponível';
    const spend=a?.last_spend?'Gasto registrado: '+amount+' · último em '+a.last_spend.split('-').reverse().join('/'):(a?.covered_days?'Sem gasto nos dias importados':'Sem dados de gastos importados');
    const active=a?.active_campaigns==null?'Campanhas habilitadas: não verificado':a.active_campaigns+' campanha(s) habilitada(s)'+(a.activity_scope==='observed'?' observada(s)':' na consulta');
    activity.textContent=spend+' · '+(a?.covered_days||0)+'/30 dias importados. '+active+'.';copy.append(activity);
    if(a?.activity_checked_at){const stamp=document.createElement('small');stamp.textContent='Estado observado em '+new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Sao_Paulo'}).format(new Date(a.activity_checked_at));copy.append(stamp);}
    if(a?.stale){const stale=document.createElement('small');stale.textContent='Última coleta com falha; dados anteriores preservados.';copy.append(stale);}
    if(onVerify){const button=document.createElement('button');button.type='button';button.className='source-verify';button.textContent='Verificar campanhas';button.title='Consulta manual ao Google Ads desta conta. Usa a cota da API e não altera a seleção.';button.setAttribute('aria-label','Verificar campanhas de '+(item.name||option.value)+' '+id);button.onclick=async()=>{button.disabled=true;button.textContent='Consultando…';try{await onVerify(option.value);}catch{button.textContent='Tentar verificar';}finally{button.disabled=false;}};row.append(button);}
   }
   choices.push({row,option,activity:a,text:option.textContent+' '+status});
   input.addEventListener('change',()=>{option.selected=input.checked;filter();select.dispatchEvent(new Event('change',{bubbles:true}));});
  }
  filter();
 }};
}
