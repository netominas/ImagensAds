const normalize=value=>String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');

// Native options remain the source of truth for report scope and saved settings.
export function sourceSelector({select,list,search,count}){
 let choices=[];
 function filter(){
  const query=normalize(search.value);
  let visible=0;
  for(const choice of choices){choice.label.hidden=!normalize(choice.text).includes(query);if(!choice.label.hidden)visible++;}
  count.textContent=select.selectedOptions.length+' de '+select.options.length+' selecionadas'+(query?' · '+visible+' encontradas':'');
  list.querySelector('.source-empty')?.remove();
  if(!visible){const empty=document.createElement('p');empty.className='source-empty';empty.textContent=query?'Nenhuma fonte encontrada.':'Nenhuma fonte disponível.';list.append(empty);}
 }
 search.addEventListener('input',filter);
 return {refresh(items){
  list.replaceChildren();choices=[];
  for(const option of select.options){
   const item=items.find(item=>item.id===option.value)||{},label=document.createElement('label'),input=document.createElement('input'),copy=document.createElement('span'),name=document.createElement('strong'),detail=document.createElement('small');
   label.className='source-choice';input.type='checkbox';input.value=option.value;input.checked=option.selected;
   name.textContent=item.name||option.value;
   const status=select.id==='accounts'?({ENABLED:'Ativa',SUSPENDED:'Suspensa',CANCELED:'Cancelada',CLOSED:'Encerrada',UNAVAILABLE:'Acesso indisponível'}[item.status]||'Estado não confirmado'):(item.available===false?'Acesso a revisar':'Acesso identificado');
   const id=select.id==='accounts'?option.value.replace(/^(\d{3})(\d{3})(\d{4})$/,'$1-$2-$3'):option.value;
   detail.textContent=[id,item.currency,status].filter(Boolean).join(' · ');
   copy.append(name,detail);label.append(input,copy);list.append(label);
   choices.push({label,text:option.textContent+' '+status});
   input.addEventListener('change',()=>{option.selected=input.checked;filter();select.dispatchEvent(new Event('change',{bubbles:true}));});
  }
  filter();
 }};
}
