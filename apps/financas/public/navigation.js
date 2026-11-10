const views=['fixed','monthly','expense','catalog'];
const headings={
 fixed:['Finanças','Acompanhe os gastos fixos da casa com seus filtros e resumos.'],
 monthly:['Lançamentos do mês','Confira os pagamentos e as despesas do período selecionado.'],
 expense:['Nova despesa','Cadastre uma despesa fixa mensal ou um lançamento com data.'],
 catalog:['Categorias e grupos','Organize suas classificações e altere os nomes quando precisar.']
};
function closeMenu(){document.getElementById('finance-sidebar').classList.remove('is-open');document.getElementById('menu-toggle').setAttribute('aria-expanded','false');}
export function showFinanceView(view){
 if(!views.includes(view))return;
 for(const name of views){document.getElementById(name+'-view').hidden=name!==view;const button=document.getElementById('show-'+name);if(name===view)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');}
 document.getElementById('monthly-filter').hidden=view!=='monthly';
 document.getElementById('page-title').textContent=headings[view][0];document.getElementById('page-description').textContent=headings[view][1];
 document.getElementById('message').textContent='';closeMenu();window.scrollTo({top:0,behavior:'instant'});
 const title=document.getElementById('page-title');title.tabIndex=-1;title.focus({preventScroll:true});
}
function selectEditor(type){document.getElementById('expense-type').value=type;for(const name of ['fixed','monthly'])document.getElementById(name+'-editor').hidden=name!==type;}
export function showExpenseEditor(type,editing=false){
 showFinanceView('expense');selectEditor(type);if(editing)document.getElementById('page-title').textContent='Editar despesa';
}
export function initNavigation(){
 for(const name of views)document.getElementById('show-'+name).onclick=()=>{
  if(name==='expense'){window.dispatchEvent(new Event('finance-new-expense'));showExpenseEditor(document.getElementById('expense-type').value);}
  else showFinanceView(name);
 };
 document.getElementById('expense-type').onchange=event=>selectEditor(event.target.value);
 const toggle=document.getElementById('menu-toggle');toggle.onclick=()=>{const open=document.getElementById('finance-sidebar').classList.toggle('is-open');toggle.setAttribute('aria-expanded',String(open));};
 window.addEventListener('keydown',event=>{if(event.key==='Escape'&&document.getElementById('finance-sidebar').classList.contains('is-open')){closeMenu();toggle.focus();}});
 showFinanceView('fixed');
}
