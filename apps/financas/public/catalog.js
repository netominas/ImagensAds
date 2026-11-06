import {secureFetch} from '/access.js';
export function fillFinanceSelects(data){
 for(const formId of ['fixed-form','expense-form']){
  const form=document.getElementById(formId);
  for(const [name,options] of [['category',data.categories.map(c=>new Option(c,c))],['area',data.groups.map(g=>new Option(g.name,g.id))]]){
   const select=form.elements[name],value=select.value;select.replaceChildren(...options);if([...select.options].some(o=>o.value===value))select.value=value;
  }
 }
}
export async function initCatalog(){
 const $=id=>document.getElementById(id),message=(text,error=false)=>{$('message').textContent=text;$('message').classList.toggle('error',error);};
 function render(data){
  fillFinanceSelects(data);
  for(const [id,names] of [['category-list',data.categories],['group-list',data.groups.map(g=>g.name)]])$(id).replaceChildren(...names.map(name=>{const tag=document.createElement('span');tag.textContent=name;return tag;}));
 }
 async function request(path,options={}){const response=await secureFetch('/apps/financas/api/'+path,{cache:'no-store',...options,headers:{'Content-Type':'application/json'}});const data=await response.json();if(!response.ok)throw Error(data.error||'Não foi possível concluir.');return data;}
 for(const type of ['category','group']){
  const form=$(type+'-form');form.onsubmit=async event=>{
   event.preventDefault();const button=form.querySelector('button');if(button.disabled)return;button.disabled=true;
   try{const data=await request(type==='category'?'categories':'groups',{method:'POST',body:JSON.stringify({name:form.elements.name.value})});render(data);form.reset();message(type==='category'?'Categoria criada.':'Grupo criado.');window.dispatchEvent(new CustomEvent('finance-catalog-changed',{detail:data}));}
   catch(e){message(e.message,true);}finally{button.disabled=false;}
  };
 }
 try{render(await request('catalog'));}catch(e){message(e.message,true);}
}
