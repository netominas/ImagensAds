import test from 'node:test';
import assert from 'node:assert/strict';
import {quickCampaignChange} from '../apps/roi/public/campaign-changes.js';

function fixture(){
 const elements=new Map(),element=()=>({value:'',disabled:false,textContent:'',classList:{toggle(){}},focus(){this.focused=true;},addEventListener(type,fn){this[type]=fn;}});
 for(const id of ['quick-change-dialog','quick-change-form','quick-change-message','quick-change-close','quick-change-cancel','quick-change-name','quick-change-date','quick-change-description'])elements.set(id,element());
 const get=id=>elements.get(id),dialog=get('quick-change-dialog'),form=get('quick-change-form');
 form.elements=[get('quick-change-date'),get('quick-change-description'),get('quick-change-cancel')];form.reset=()=>form.elements.forEach(e=>e.value='');form.reportValidity=()=>true;
 dialog.showModal=()=>dialog.open=true;dialog.close=()=>{dialog.open=false;dialog.closeEvent?.();};dialog.addEventListener=(type,fn)=>dialog[type==='close'?'closeEvent':type]=fn;
 const button={...element(),isConnected:true,dataset:{noteAccount:'1234567890',noteCampaign:'42',noteName:'Campanha <teste>'}},root={querySelectorAll:()=>[button]};
 return {get,dialog,form,button,root,document:{getElementById:get}};
}

test('quick change keeps its campaign and id across retries, blocks duplicate submit, resets on the next campaign',async()=>{
 const f=fixture(),previous=globalThis.document;globalThis.document=f.document;
 let rejectRequest,resolveRequest,calls=[],saved=[];
 try{
  const panel=quickCampaignChange({api:(path,body)=>{calls.push({path,body});return new Promise((resolve,reject)=>{resolveRequest=resolve;rejectRequest=reject;});},onSaved:body=>saved.push(body)});
  panel.bind(f.root);f.button.onclick();assert.equal(f.dialog.open,true);assert.equal(f.get('quick-change-name').textContent,'Campanha <teste>');assert.match(f.get('quick-change-date').value,/^\d{4}-\d{2}-\d{2}$/);
  f.get('quick-change-description').value='Ajuste de segmentação';f.get('quick-change-date').value='2026-11-20';
  const event={preventDefault(){}},first=f.form.onsubmit(event);await f.form.onsubmit(event);assert.equal(calls.length,1);
  let prevented=false;f.dialog.cancel({preventDefault(){prevented=true;}});assert.equal(prevented,true);
  rejectRequest(new Error('Falha temporária'));await first;assert.equal(f.dialog.open,true);assert.equal(f.get('quick-change-description').value,'Ajuste de segmentação');assert.equal(f.get('quick-change-message').textContent,'Falha temporária');
  const retry=f.form.onsubmit(event);assert.equal(calls[0].body.id,calls[1].body.id);assert.equal(calls[1].body.type,'general');assert.equal(calls[1].body.campaign,'42');assert.equal(calls[1].body.date,'2026-11-20');resolveRequest({});await retry;assert.equal(f.dialog.open,false);assert.equal(saved.length,1);
  f.button.dataset.noteCampaign='43';f.button.onclick();assert.equal(f.get('quick-change-description').value,'');f.get('quick-change-description').value='Nova campanha';const next=f.form.onsubmit(event);assert.equal(calls[2].body.campaign,'43');assert.notEqual(calls[2].body.id,calls[0].body.id);resolveRequest({});await next;
 }finally{globalThis.document=previous;}
});

test('quick change does not bind write actions for readers',()=>{
 const f=fixture(),previous=globalThis.document;globalThis.document=f.document;
 try{quickCampaignChange({api:()=>assert.fail('reader cannot save'),readOnly:true}).bind(f.root);assert.equal(f.button.onclick,undefined);assert.equal(f.dialog.open,undefined);}finally{globalThis.document=previous;}
});
