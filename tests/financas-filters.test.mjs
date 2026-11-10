import test from 'node:test';
import assert from 'node:assert/strict';
import {selectExpenses} from '../apps/financas/public/filters.js';

test('expense filters intersect groups and categories, preserve source rows and track renamed categories by ID',()=>{
 const catalog={categoryItems:[{id:'cat-1',name:'Moradia'},{id:'cat-2',name:'Saúde'},{id:'cat-3',name:'Sem gastos'}],groups:[{id:'home',name:'Casa'},{id:'work',name:'Trabalho'}]};
 const items=[{id:'1',category:'Moradia',area:'home',amount_cents:1251540},{id:'2',category:'Moradia',area:'work',amount_cents:45710},{id:'3',category:'Saúde',area:'home',amount_cents:100}];
 const before=structuredClone(items),ids=selection=>selectExpenses(items,catalog,selection).map(i=>i.id);
 assert.deepEqual(ids({category:null,group:null}),['1','2','3']);
 assert.deepEqual(ids({category:'cat-1',group:null}),['1','2']);
 assert.deepEqual(ids({category:null,group:'home'}),['1','3']);
 assert.deepEqual(ids({category:'cat-1',group:'work'}),['2']);
 assert.deepEqual(ids({category:'cat-2',group:'work'}),[]);
 assert.deepEqual(ids({category:'cat-3',group:null}),[]);
 assert.deepEqual(items,before);
 const renamed={...catalog,categoryItems:catalog.categoryItems.map(c=>c.id==='cat-1'?{...c,name:'Imóveis'}:c)};
 const renamedItems=items.map(i=>i.category==='Moradia'?{...i,category:'Imóveis'}:i);
 assert.deepEqual(selectExpenses(renamedItems,renamed,{category:'cat-1',group:'work'}).map(i=>i.id),['2']);
});
