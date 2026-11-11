import {requireAccess,secureFetch} from '/access.js';
import {initFixed} from './fixed.js';
import {initCatalog,fillFinanceSelects} from './catalog.js';
import {createExpenseFilters} from './filters.js';
import {initNavigation,showExpenseEditor,showFinanceView} from './navigation.js';
import {applyClassificationColor,categoryId,colorExpenseRow} from './colors.js';
const $=id=>document.getElementById(id),form=$('expense-form'),month=$('month');
const money=cents=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(cents/100);
const localDate=()=>{const now=new Date();return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;};
let editing=null,expenses=[],loadVersion=0,busy=false,currentData=null;
let readOnly=false;
const filters=createExpenseFilters('monthly',renderRows);
month.value=localDate().slice(0,7);form.elements.date.value=localDate();
function message(text,error=false){$('message').textContent=text;$('message').classList.toggle('error',error);}
async function api(path='',options={}){
 const response=await secureFetch('/apps/financas/api/expenses'+path,{...options,headers:{'Content-Type':'application/json'},cache:'no-store'});
 const data=await response.json();if(!response.ok)throw Error(data.error||'Não foi possível concluir a operação.');return data;
}
function reset(){editing=null;form.reset();form.elements.date.value=month.value===localDate().slice(0,7)?localDate():month.value+'-01';$('form-title').textContent='Nova despesa';$('save').textContent='Adicionar despesa';$('cancel').hidden=true;}
function setBusy(value){busy=value;for(const element of form.elements)element.disabled=value;month.disabled=value;for(const button of $('expenses').querySelectorAll('button'))button.disabled=value;}
function cell(row,value,className){const td=document.createElement('td');td.textContent=value;if(className)td.className=className;row.append(td);return td;}
function renderRows(rows,filtered){
  const summary={total:0,paid:0,pending:0,categories:Object.create(null)};
  for(const row of rows){summary.total+=row.amount_cents;summary[row.status]+=row.amount_cents;summary.categories[row.category]=(Object.hasOwn(summary.categories,row.category)?summary.categories[row.category]:0)+row.amount_cents;}
  for(const key of ['total','paid','pending'])$(key).textContent=money(summary[key]);
  $('categories').replaceChildren();$('expenses').replaceChildren();
  for(const [name,value] of Object.entries(summary.categories).sort((a,b)=>b[1]-a[1])){
   if(!value)continue;
   const row=document.createElement('div');row.className='category-row';applyClassificationColor(row,currentData,'category',categoryId(currentData,name));const label=document.createElement('div');label.className='category-label';const title=document.createElement('span'),amount=document.createElement('strong');title.textContent=name;amount.textContent=money(value);label.append(title,amount);
   const track=document.createElement('div'),fill=document.createElement('div');track.className='category-track';fill.className='category-fill';fill.style.width=(value/summary.total*100)+'%';track.append(fill);row.append(label,track);$('categories').append(row);
  }
  if(!rows.length)$('categories').textContent='Nenhuma despesa para esta seleção.';
  $('count').textContent=`${rows.length} de ${expenses.length} lançamentos`;$('empty').hidden=rows.length>0;$('empty').textContent=filtered?'Nenhuma despesa corresponde aos filtros selecionados.':'Nenhuma despesa neste mês. Comece adicionando uma despesa da casa.';
  for(const expense of rows){
   const row=document.createElement('tr');cell(row,expense.date.split('-').reverse().join('/'));cell(row,expense.description);cell(row,expense.category);cell(row,currentData.groups.find(g=>g.id===expense.area)?.name||expense.area);
   colorExpenseRow(row,expense,currentData,2,3);
   const badge=document.createElement('span');badge.className='status '+expense.status;badge.textContent=expense.status==='paid'?'Pago':'Pendente';const status=document.createElement('td');status.append(badge);row.append(status);cell(row,money(expense.amount_cents),'number');
   if(readOnly){$('expenses').append(row);continue;}
   const actions=document.createElement('td');
   for(const [name,handler] of [['Editar',()=>edit(expense)],['Excluir',()=>remove(expense)]]){const button=document.createElement('button');button.type='button';button.textContent=name;button.setAttribute('aria-label',`${name}: ${expense.description}`);button.disabled=busy;button.onclick=handler;actions.append(button);}row.append(actions);$('expenses').append(row);
  }
}
async function load(){
 const version=++loadVersion;
 $('monthly-filters').hidden=true;$('total').textContent=$('paid').textContent=$('pending').textContent='—';$('categories').replaceChildren();$('expenses').replaceChildren();$('empty').hidden=true;$('count').textContent='Carregando…';
 try{
  const data=await api('?month='+encodeURIComponent(month.value));if(version!==loadVersion)return;
  currentData=data;expenses=data.expenses;fillFinanceSelects(data);filters.update(data,expenses);$('monthly-filters').hidden=false;
 }catch(error){if(version!==loadVersion)return;$('count').textContent='Dados indisponíveis';message(error.message,true);}
}
function edit(expense){if(busy)return;editing=expense;for(const name of ['description','date','category','status','area'])form.elements[name].value=expense[name];form.elements.amount.value=(expense.amount_cents/100).toFixed(2).replace('.',',');$('form-title').textContent='Editar despesa';$('save').textContent='Salvar alterações';$('cancel').hidden=false;showExpenseEditor('monthly',true);form.elements.description.focus();form.scrollIntoView({behavior:'smooth',block:'center'});}
async function remove(expense){
 if(busy||!confirm(`Excluir a despesa “${expense.description}” de ${money(expense.amount_cents)}?`))return;
 setBusy(true);try{await api('/'+expense.id,{method:'DELETE',body:JSON.stringify({revision:expense.revision})});if(editing?.id===expense.id)reset();message('Despesa excluída.');await load();}catch(error){message(error.message,true);}finally{setBusy(false);}
}
form.onsubmit=async event=>{
 event.preventDefault();if(busy||readOnly)return;
 const amount=form.elements.amount.value.trim();
 if(!/^\d{1,7}([,.]\d{1,2})?$/.test(amount)){message('Informe o valor sem separador de milhar, por exemplo 1234,56.',true);return;}
 const [whole,fraction='']=amount.replace(',','.').split('.'),amount_cents=Number(whole)*100+Number(fraction.padEnd(2,'0'));
 const body={amount_cents,...Object.fromEntries(['description','date','category','status','area'].map(name=>[name,form.elements[name].value])),...(editing?{revision:editing.revision}:{})};
 setBusy(true);
 try{await api(editing?'/'+editing.id:'',{method:editing?'PUT':'POST',body:JSON.stringify(body)});month.value=body.date.slice(0,7);reset();showFinanceView('monthly');message('Despesa salva.');await load();}catch(error){message(error.message,true);}finally{setBusy(false);}
};
$('cancel').onclick=()=>{reset();showFinanceView('monthly');};month.onchange=()=>{if(!month.checkValidity()||!month.value){message('Selecione um mês válido.',true);return;}reset();message('');void load();};
$('logout').onclick=async()=>{try{const response=await secureFetch('/api/logout',{method:'POST'});if(!response.ok)throw Error('Não foi possível sair.');localStorage.setItem('adstudio-logout',String(Date.now()));location.replace('/login');}catch(error){message(error.message,true);}};
window.addEventListener('storage',event=>{if(event.key==='adstudio-logout')location.replace('/login');});
window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
window.addEventListener('focus',()=>{void requireAccess();});
window.addEventListener('finance-catalog-changed',()=>{void load();});
window.addEventListener('finance-new-expense',reset);
const session=await requireAccess();
if(session){
 readOnly=session.role==='finance-reader';
 initNavigation(readOnly);
 if(!readOnly)await initCatalog();
 await initFixed(readOnly);
 await load();
}
