// Catalog order is stable across renames and restarts; new entries are appended.
// The same palette is shared by cards, table labels and distribution bars.
const palette=[
 {accent:'#1d4ed8',tint:'#eff6ff',border:'#bfdbfe'},
 {accent:'#166534',tint:'#f0fdf4',border:'#bbf7d0'},
 {accent:'#92400e',tint:'#fffbeb',border:'#fde68a'},
 {accent:'#6d28d9',tint:'#f5f3ff',border:'#ddd6fe'},
 {accent:'#be123c',tint:'#fff1f2',border:'#fecdd3'},
 {accent:'#155e75',tint:'#ecfeff',border:'#a5f3fc'},
 {accent:'#9a3412',tint:'#fff7ed',border:'#fed7aa'},
 {accent:'#475569',tint:'#f1f5f9',border:'#cbd5e1'},
 {accent:'#4338ca',tint:'#eef2ff',border:'#c7d2fe'},
 {accent:'#115e59',tint:'#f0fdfa',border:'#99f6e4'},
 {accent:'#a21caf',tint:'#fdf4ff',border:'#f5d0fe'},
 {accent:'#3f6212',tint:'#f7fee7',border:'#d9f99d'}
];
export function classificationColor(catalog,type,id){
 const entries=type==='group'?catalog.groups:catalog.categoryItems;
 const index=entries.findIndex(item=>item.id===id);
 return palette[index<0?7:(index+(type==='group'?9:0))%palette.length];
}
export function applyClassificationColor(element,catalog,type,id){
 const color=classificationColor(catalog,type,id);
 for(const [name,value] of Object.entries(color))element.style.setProperty('--expense-'+name,value);
 return element;
}
export function categoryId(catalog,name){return catalog.categoryItems.find(item=>item.name===name)?.id;}
export function colorExpenseRow(row,item,catalog,categoryColumn,groupColumn){
 row.classList.add('expense-colored-row');applyClassificationColor(row,catalog,'category',categoryId(catalog,item.category));
 for(const [column,type,id,name] of [[categoryColumn,'category',categoryId(catalog,item.category),item.category],[groupColumn,'group',item.area,catalog.groups.find(g=>g.id===item.area)?.name||item.area]]){
  const label=document.createElement('span');label.className='expense-color-label';label.textContent=name;applyClassificationColor(label,catalog,type,id);row.children[column].replaceChildren(label);
 }
}
