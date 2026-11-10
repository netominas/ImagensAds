import {applyClassificationColor} from './colors.js';
export function selectExpenses(items,catalog,selection){
 const category=catalog.categoryItems.find(c=>c.id===selection.category);
 return items.filter(item=>(!category||item.category===category.name)&&(!selection.group||item.area===selection.group));
}

export function createExpenseFilters(prefix,onChange){
 const root=document.getElementById(prefix+'-filters');
 let catalog={categoryItems:[],groups:[]},items=[],selection={category:null,group:null};
 const money=c=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(c/100);
 function card(type,id,name,rows){
  const button=document.createElement('button'),title=document.createElement('span'),value=document.createElement('strong'),count=document.createElement('small');
  button.type='button';button.className='expense-filter-card';button.setAttribute('aria-pressed',String(selection[type]===id));button.setAttribute('aria-label','Filtrar por '+(type==='group'?'grupo: ':'categoria: ')+name);
  button.setAttribute('aria-controls',prefix==='fixed'?'fixed-items':'expenses');
  applyClassificationColor(button,catalog,type,id);
  title.textContent=name;value.textContent=money(rows.reduce((sum,row)=>sum+row.amount_cents,0));count.textContent=`${rows.length} ${rows.length===1?'despesa':'despesas'}`;button.append(title,value,count);
  button.onclick=()=>{selection[type]=selection[type]===id?null:id;render();notify();};
  return button;
 }
 function render(){
  // Restore focus to the selected card when its totals and pressed state are rendered again.
  if(!root.firstChild){
   const hint=document.createElement('p');hint.className='subtle';hint.textContent='Clique nos cards para filtrar. Combine um grupo e uma categoria; clique novamente para desmarcar.';root.append(hint);
   for(const [type,title] of [['group','Grupos'],['category','Categorias']]){const heading=document.createElement('h3'),grid=document.createElement('div');heading.textContent=title;grid.className='expense-filter-grid';grid.dataset.filterType=type;grid.setAttribute('aria-label','Filtrar por '+title.toLowerCase());root.append(heading,grid);}
   const actions=document.createElement('div'),status=document.createElement('p'),clear=document.createElement('button'),jump=document.createElement('a');actions.className='filter-status';status.id=prefix+'-filter-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');clear.type='button';clear.textContent='Mostrar todos';clear.onclick=()=>{selection={category:null,group:null};render();notify();};jump.href='#'+prefix+'-ledger';jump.textContent='Ver gastos ↓';actions.append(status,clear,jump);root.append(actions);
  }
  for(const [type,entries] of [['group',catalog.groups],['category',catalog.categoryItems]]){
   const grid=root.querySelector(`[data-filter-type="${type}"]`),active=document.activeElement,activeId=active?.parentElement===grid?active.dataset.filterId:null;
   grid.replaceChildren(...entries.map(entry=>{const rows=items.filter(i=>type==='group'?i.area===entry.id:i.category===entry.name);const button=card(type,entry.id,entry.name,rows);button.dataset.filterId=entry.id;return button;}));
   if(activeId){const next=[...grid.children].find(b=>b.dataset.filterId===activeId);next?.focus({preventScroll:true});}
  }
  const labels=[catalog.groups.find(g=>g.id===selection.group)?.name,catalog.categoryItems.find(c=>c.id===selection.category)?.name].filter(Boolean);
  const rows=selectExpenses(items,catalog,selection);document.getElementById(prefix+'-filter-status').textContent=(labels.length?'Filtro: '+labels.join(' · '):'Todos os gastos')+` — ${rows.length} de ${items.length} despesas · ${money(rows.reduce((sum,row)=>sum+row.amount_cents,0))}`;
  root.querySelector('.filter-status button').hidden=!labels.length;
 }
 function notify(){onChange(selectExpenses(items,catalog,selection),Boolean(selection.category||selection.group));}
 return {
  update(data,rows){catalog=data;items=rows;if(!data.categoryItems.some(c=>c.id===selection.category))selection.category=null;if(!data.groups.some(g=>g.id===selection.group))selection.group=null;render();notify();},
  clear(){selection={category:null,group:null};render();notify();}
 };
}
