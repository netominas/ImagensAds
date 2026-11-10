import {secureFetch} from '/access.js';
import {fillFinanceSelects} from './catalog.js';
import {createExpenseFilters} from './filters.js';
import {showExpenseEditor,showFinanceView} from './navigation.js';
import {applyClassificationColor,categoryId,colorExpenseRow} from './colors.js';
export async function initFixed(){
 const $=id=>document.getElementById(id),form=$('fixed-form'),money=c=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(c/100);
 let editing=null,busy=false,currentData=null;
 const filters=createExpenseFilters('fixed',renderRows);
 const message=(text,error=false)=>{$('message').textContent=text;$('message').classList.toggle('error',error);};
 async function api(path='',options={}){const response=await secureFetch('/apps/financas/api/fixed'+path,{cache:'no-store',...options,headers:{'Content-Type':'application/json'}});const data=await response.json();if(!response.ok)throw Error(data.error||'Não foi possível concluir.');return data;}
 function setBusy(value){busy=value;for(const element of form.elements)element.disabled=value;for(const button of $('fixed-items').querySelectorAll('button'))button.disabled=value;}
 function reset(){editing=null;form.reset();$('fixed-title').textContent='Nova despesa fixa';$('fixed-save').textContent='Adicionar despesa fixa';$('fixed-cancel').hidden=true;}
 function edit(item){if(busy)return;editing=item;for(const name of ['description','category','area'])form.elements[name].value=item[name];form.elements.amount.value=(item.amount_cents/100).toFixed(2).replace('.',',');$('fixed-title').textContent='Editar despesa fixa';$('fixed-save').textContent='Salvar alterações';$('fixed-cancel').hidden=false;showExpenseEditor('fixed',true);form.elements.description.focus();form.scrollIntoView({block:'center',behavior:'smooth'});}
 async function remove(item){if(busy||!confirm(`Excluir a despesa fixa “${item.description}”?`))return;setBusy(true);try{await api('/'+item.id,{method:'DELETE',body:JSON.stringify({revision:item.revision})});if(editing?.id===item.id)reset();message('Despesa fixa excluída.');await load();}catch(e){message(e.message,true);}finally{setBusy(false);}}
 function renderRows(items,filtered){
  $('fixed-selected-total').textContent=money(items.reduce((sum,item)=>sum+item.amount_cents,0));$('fixed-selected-count').textContent=String(items.length);
  $('fixed-items').replaceChildren();$('fixed-count').textContent=`${items.length} de ${currentData.items.length} despesas`;$('fixed-empty').hidden=items.length>0;$('fixed-empty').textContent=filtered?'Nenhuma despesa corresponde aos filtros selecionados.':'Nenhuma despesa fixa cadastrada.';
  for(const item of items){const row=document.createElement('tr');for(const value of [item.description,item.category,currentData.groups.find(g=>g.id===item.area)?.name||item.area,money(item.amount_cents)]){const td=document.createElement('td');td.textContent=value;row.append(td);}row.children[3].className='number';colorExpenseRow(row,item,currentData,1,2);const actions=document.createElement('td');for(const [label,handler] of [['Editar',()=>edit(item)],['Excluir',()=>remove(item)]]){const button=document.createElement('button');button.type='button';button.textContent=label;button.setAttribute('aria-label',label+': '+item.description);button.onclick=handler;button.disabled=busy;actions.append(button);}row.append(actions);$('fixed-items').append(row);}
 }
 async function load(){
  $('fixed-filters').hidden=true;
  try{
   const data=await api();currentData=data;$('fixed-total').textContent=money(data.summary.total);
   fillFinanceSelects(data);
   filters.update(data,data.items);$('fixed-filters').hidden=false;
   $('fixed-categories').replaceChildren();
   for(const [name,amount] of Object.entries(data.summary.categories).sort((a,b)=>b[1]-a[1])){if(!amount)continue;const row=document.createElement('div'),label=document.createElement('div'),title=document.createElement('span'),value=document.createElement('strong'),track=document.createElement('div'),fill=document.createElement('div');row.className='category-row';applyClassificationColor(row,data,'category',categoryId(data,name));label.className='category-label';title.textContent=name;value.textContent=money(amount);label.append(title,value);track.className='category-track';fill.className='category-fill';fill.style.width=amount/data.summary.total*100+'%';track.append(fill);row.append(label,track);$('fixed-categories').append(row);}
   if(!data.items.length)$('fixed-categories').textContent='Adicione suas despesas fixas para ver a distribuição.';
  }catch(e){for(const id of ['fixed-total','fixed-selected-total','fixed-selected-count'])$(id).textContent='—';$('fixed-items').replaceChildren();$('fixed-count').textContent='Dados indisponíveis';message(e.message,true);}
 }
 form.onsubmit=async event=>{
  event.preventDefault();if(busy)return;const value=form.elements.amount.value.trim();if(!/^\d{1,7}([,.]\d{1,2})?$/.test(value)){message('Informe um valor como 1234,56, sem separador de milhar.',true);return;}
  const [whole,fraction='']=value.replace(',','.').split('.');const body={amount_cents:Number(whole)*100+Number(fraction.padEnd(2,'0')),...Object.fromEntries(['description','category','area'].map(n=>[n,form.elements[n].value])),...(editing?{revision:editing.revision}:{})};
  setBusy(true);try{await api(editing?'/'+editing.id:'',{method:editing?'PUT':'POST',body:JSON.stringify(body)});reset();showFinanceView('fixed');message('Despesa fixa salva.');await load();}catch(e){message(e.message,true);}finally{setBusy(false);}
 };
 $('fixed-cancel').onclick=()=>{reset();showFinanceView('fixed');};window.addEventListener('finance-new-expense',reset);window.addEventListener('finance-catalog-changed',()=>{void load();});await load();
}
