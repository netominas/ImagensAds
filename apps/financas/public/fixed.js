import {secureFetch} from '/access.js';
export async function initFixed(){
 const $=id=>document.getElementById(id),form=$('fixed-form'),money=c=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(c/100);
 let editing=null,busy=false;
 const message=(text,error=false)=>{$('message').textContent=text;$('message').classList.toggle('error',error);};
 for(const mode of ['fixed','monthly'])$('show-'+mode).onclick=()=>{for(const view of ['fixed','monthly']){$(view+'-view').hidden=view!==mode;$('show-'+view).setAttribute('aria-pressed',String(view===mode));}$('monthly-filter').hidden=mode!=='monthly';message('');};
 async function api(path='',options={}){const response=await secureFetch('/apps/financas/api/fixed'+path,{cache:'no-store',...options,headers:{'Content-Type':'application/json'}});const data=await response.json();if(!response.ok)throw Error(data.error||'Não foi possível concluir.');return data;}
 function setBusy(value){busy=value;for(const element of form.elements)element.disabled=value;for(const button of $('fixed-items').querySelectorAll('button'))button.disabled=value;}
 function reset(){editing=null;form.reset();$('fixed-title').textContent='Nova despesa fixa';$('fixed-save').textContent='Adicionar despesa fixa';$('fixed-cancel').hidden=true;}
 function edit(item){if(busy)return;editing=item;for(const name of ['description','category','area'])form.elements[name].value=item[name];form.elements.amount.value=(item.amount_cents/100).toFixed(2).replace('.',',');$('fixed-title').textContent='Editar despesa fixa';$('fixed-save').textContent='Salvar alterações';$('fixed-cancel').hidden=false;form.elements.description.focus();form.scrollIntoView({block:'center',behavior:'smooth'});}
 async function remove(item){if(busy||!confirm(`Excluir a despesa fixa “${item.description}”?`))return;setBusy(true);try{await api('/'+item.id,{method:'DELETE',body:JSON.stringify({revision:item.revision})});if(editing?.id===item.id)reset();message('Despesa fixa excluída.');await load();}catch(e){message(e.message,true);}finally{setBusy(false);}}
 async function load(){
  try{
   const data=await api();for(const key of ['total','home','work'])$('fixed-'+key).textContent=money(data.summary[key]);
   const selected=form.elements.category.value;form.elements.category.replaceChildren(...data.categories.map(c=>new Option(c,c)));if(data.categories.includes(selected))form.elements.category.value=selected;
   $('fixed-items').replaceChildren();$('fixed-count').textContent=`${data.items.length} despesas`;$('fixed-empty').hidden=data.items.length>0;
   for(const item of data.items){const row=document.createElement('tr');for(const value of [item.description,item.category,item.area==='work'?'Trabalho':'Pessoal e casa',money(item.amount_cents)]){const td=document.createElement('td');td.textContent=value;row.append(td);}row.children[3].className='number';const actions=document.createElement('td');for(const [label,handler] of [['Editar',()=>edit(item)],['Excluir',()=>remove(item)]]){const button=document.createElement('button');button.type='button';button.textContent=label;button.setAttribute('aria-label',label+': '+item.description);button.onclick=handler;button.disabled=busy;actions.append(button);}row.append(actions);$('fixed-items').append(row);}
   $('fixed-categories').replaceChildren();
   for(const [name,amount] of Object.entries(data.summary.categories).sort((a,b)=>b[1]-a[1])){if(!amount)continue;const row=document.createElement('div'),label=document.createElement('div'),title=document.createElement('span'),value=document.createElement('strong'),track=document.createElement('div'),fill=document.createElement('div');row.className='category-row';label.className='category-label';title.textContent=name;value.textContent=money(amount);label.append(title,value);track.className='category-track';fill.className='category-fill';fill.style.width=amount/data.summary.total*100+'%';track.append(fill);row.append(label,track);$('fixed-categories').append(row);}
   if(!data.items.length)$('fixed-categories').textContent='Adicione suas despesas fixas para ver a distribuição.';
  }catch(e){for(const key of ['total','home','work'])$('fixed-'+key).textContent='—';$('fixed-count').textContent='Dados indisponíveis';message(e.message,true);}
 }
 form.onsubmit=async event=>{
  event.preventDefault();if(busy)return;const value=form.elements.amount.value.trim();if(!/^\d{1,7}([,.]\d{1,2})?$/.test(value)){message('Informe um valor como 1234,56, sem separador de milhar.',true);return;}
  const [whole,fraction='']=value.replace(',','.').split('.');const body={amount_cents:Number(whole)*100+Number(fraction.padEnd(2,'0')),...Object.fromEntries(['description','category','area'].map(n=>[n,form.elements[n].value])),...(editing?{revision:editing.revision}:{})};
  setBusy(true);try{await api(editing?'/'+editing.id:'',{method:editing?'PUT':'POST',body:JSON.stringify(body)});reset();message('Despesa fixa salva.');await load();}catch(e){message(e.message,true);}finally{setBusy(false);}
 };
 $('fixed-cancel').onclick=reset;await load();
}
