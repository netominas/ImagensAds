import {secureFetch} from '/access.js';
import {applyClassificationColor} from './colors.js';
export function fillFinanceSelects(data){
 for(const formId of ['fixed-form','expense-form']){
  const form=document.getElementById(formId);
  for(const [name,options] of [['category',data.categories.map(c=>new Option(c,c))],['area',data.groups.map(g=>new Option(g.name,g.id))]]){
   const select=form.elements[name];let value=select.value;if(name==='category'&&data.rename?.type==='categories'&&value===data.rename.from)value=data.rename.to;select.replaceChildren(...options);if([...select.options].some(o=>o.value===value))select.value=value;
  }
 }
}
export async function initCatalog(){
 const $=id=>document.getElementById(id),message=(text,error=false)=>{$('message').textContent=text;$('message').classList.toggle('error',error);};
 const editing={category:null,group:null};let busy=false;
 function reset(type){const form=$(type+'-form');editing[type]=null;form.reset();form.querySelector('button[type="submit"]').textContent=type==='category'?'Criar categoria':'Criar grupo';$(type+'-cancel').hidden=true;form.elements.name.removeAttribute('aria-description');}
 function edit(type,item){if(busy)return;const form=$(type+'-form');editing[type]=item;form.elements.name.value=item.name;form.elements.name.setAttribute('aria-description','Renomeando '+item.name);form.querySelector('button[type="submit"]').textContent='Salvar nome';$(type+'-cancel').hidden=false;form.elements.name.focus();}
 function render(data){
  fillFinanceSelects(data);
  for(const [type,items] of [['category',data.categoryItems],['group',data.groups]])$(type+'-list').replaceChildren(...items.map(item=>{const row=document.createElement('div'),name=document.createElement('span'),button=document.createElement('button');row.className='catalog-item';name.className='expense-color-label';name.textContent=item.name;applyClassificationColor(name,data,type,item.id);button.type='button';button.textContent='Renomear';button.setAttribute('aria-label','Renomear '+(type==='category'?'categoria: ':'grupo: ')+item.name);button.disabled=busy;button.onclick=()=>edit(type,item);row.append(name,button);return row;}));
 }
 async function request(path,options={}){const response=await secureFetch('/apps/financas/api/'+path,{cache:'no-store',...options,headers:{'Content-Type':'application/json'}});const data=await response.json();if(!response.ok)throw Error(data.error||'Não foi possível concluir.');return data;}
 for(const type of ['category','group']){
  const cancel=document.createElement('button');cancel.id=type+'-cancel';cancel.type='button';cancel.textContent='Cancelar';cancel.hidden=true;cancel.onclick=()=>reset(type);$(type+'-form').append(cancel);
  const form=$(type+'-form');form.onsubmit=async event=>{
   event.preventDefault();if(busy)return;busy=true;for(const button of $('catalog-view').querySelectorAll('button'))button.disabled=true;
   const item=editing[type],path=type==='category'?'categories':'groups';
   try{const data=await request(path+(item?'/'+item.id:''),{method:item?'PUT':'POST',body:JSON.stringify({name:form.elements.name.value,...(item?{revision:item.revision}:{})})});render(data);reset(type);message(item?'Nome atualizado.':type==='category'?'Categoria criada.':'Grupo criado.');window.dispatchEvent(new CustomEvent('finance-catalog-changed',{detail:data}));}
   catch(e){message(e.message,true);}finally{busy=false;for(const button of $('catalog-view').querySelectorAll('button'))button.disabled=false;}
  };
 }
 try{render(await request('catalog'));}catch(e){message(e.message,true);}
}
