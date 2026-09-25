import {authJSON,sameOrigin} from './auth.mjs';
import {copyPresets,textModels} from '../public/copy-core.js';
import {generateCopy} from './copy-generation.mjs';
const modelOK=x=>typeof x==='string'&&/^[a-zA-Z0-9._-]{1,100}$/.test(x);
const idOK=x=>typeof x==='string'&&/^[a-zA-Z0-9-]{1,100}$/.test(x);
export function createCopyAPI(storage,generate=generateCopy){
 const db=storage.db,config=storage.store('copy-config');let active=0;
 db.exec('CREATE TABLE IF NOT EXISTS copies (id TEXT PRIMARY KEY, created INTEGER NOT NULL, data TEXT NOT NULL)');
 // Interrupted requests are never replayed automatically: the provider may have billed them.
 for(const row of db.prepare('SELECT id,data FROM copies').all()){const item=JSON.parse(row.data);if(item.status==='running')db.prepare('UPDATE copies SET data=? WHERE id=?').run(JSON.stringify({...item,status:'error',error:'Servidor reiniciado durante a geração. Confira o consumo antes de tentar novamente.'}),row.id);}
 const get=id=>{const row=db.prepare('SELECT data FROM copies WHERE id=?').get(id);return row?JSON.parse(row.data):null;};
 const save=item=>db.prepare('UPDATE copies SET data=? WHERE id=?').run(JSON.stringify(item),item.id);
 return async request=>{
  const url=new URL(request.url),path=url.pathname,method=request.method;
  if(!['GET','HEAD'].includes(method)&&!sameOrigin(request))return authJSON({error:'Origem não permitida.'},403);
  if(path==='/api/data/copy-config'){
   if(method==='GET')return authJSON(await config.get('settings',{type:'json'})||{templates:copyPresets,models:textModels});
   if(method!=='PUT')return authJSON({error:'Método não permitido.'},405);
   let data;try{data=await request.json();}catch{return authJSON({error:'Dados inválidos.'},400);}
   if(!data||!Array.isArray(data.templates)||!data.templates.length||data.templates.length>100||data.templates.some(p=>!p||!idOK(p.id)||typeof p.name!=='string'||!p.name.trim()||p.name.length>100||typeof p.prompt!=='string'||!p.prompt.trim()||p.prompt.length>14000)||new Set(data.templates.map(p=>p.id)).size!==data.templates.length)return authJSON({error:'Biblioteca de prompts inválida.'},400);
   if(!data.models||Object.entries(data.models).some(([p,m])=>!Object.hasOwn(textModels,p)||!modelOK(m)))return authJSON({error:'Modelo inválido.'},400);
   await config.setJSON('settings',{models:{...textModels,...data.models},templates:data.templates.map(p=>({id:p.id,name:p.name,prompt:p.prompt,category:String(p.category||'Personalizado').slice(0,60),description:String(p.description||'').slice(0,200)}))});return authJSON({ok:true});
  }
  if(path==='/api/data/copies'){
   if(method==='GET'){
    const offset=Math.max(0,Math.min(1000000,Math.trunc(Number(url.searchParams.get('offset')))||0));
    const items=db.prepare('SELECT data FROM copies ORDER BY created DESC LIMIT 50 OFFSET ?').all(offset).map(row=>{const {text,prompt,...meta}=JSON.parse(row.data);return meta;});
    return authJSON({items,total:db.prepare('SELECT count(*) AS n FROM copies').get().n});
   }
   if(method!=='POST')return authJSON({error:'Método não permitido.'},405);
   let d;try{d=await request.json();}catch{return authJSON({error:'Dados inválidos.'},400);}
   if(!d||!idOK(d.id)||!Object.hasOwn(textModels,d.provider)||!modelOK(d.model)||typeof d.prompt!=='string'||!d.prompt.trim()||d.prompt.length>24000||typeof d.theme!=='string'||!d.theme.trim()||d.theme.length>3000||!Number.isInteger(d.count)||d.count<1||d.count>10)return authJSON({error:'Confira tema, prompt, modelo e quantidade (1 a 10).'},400);
   if(get(d.id))return authJSON({id:d.id},202);
   if(active>=2)return authJSON({error:'Já há duas gerações de texto em andamento. Aguarde.'},429);
   const apiKey=(await storage.keys())[d.provider];if(!apiKey)return authJSON({error:'Cadastre a chave desta IA em Configurações.'},400);
   if(active>=2)return authJSON({error:'Aguarde as gerações em andamento.'},429);
   const item={id:d.id,created:Date.now(),provider:d.provider,model:d.model,prompt:d.prompt,theme:d.theme,count:d.count,templateName:String(d.templateName||'Personalizado').slice(0,100),status:'running',text:'',error:'',warning:''};
   const claimed=db.prepare('INSERT OR IGNORE INTO copies VALUES (?,?,?)').run(item.id,item.created,JSON.stringify(item));if(!claimed.changes)return authJSON({id:item.id},202);
   active++;
   Promise.resolve().then(()=>generate({provider:item.provider,model:item.model,prompt:item.prompt,apiKey})).then(result=>save({...item,...result,status:'done'})).catch(error=>save({...item,status:'error',error:error.name==='TimeoutError'?'A IA excedeu o tempo de resposta. Confira o consumo antes de tentar novamente.':error.message.includes(apiKey)?'Falha na geração.':error.message})).finally(()=>active--);
   return authJSON({id:item.id},202);
  }
  const match=path.match(/^\/api\/data\/copies\/([a-zA-Z0-9-]{1,100})$/);
  if(match){
   const item=get(match[1]);if(!item)return authJSON({error:'Texto não encontrado.'},404);
   if(method==='GET')return authJSON(item);
   if(item.status==='running')return authJSON({error:'Aguarde a conclusão da geração.'},409);
   if(method==='DELETE'){db.prepare('DELETE FROM copies WHERE id=?').run(item.id);return authJSON({ok:true});}
   if(method==='PUT'){let d;try{d=await request.json();}catch{return authJSON({error:'Dados inválidos.'},400);}if(typeof d?.text!=='string'||d.text.length>100000)return authJSON({error:'Texto inválido ou muito longo.'},400);save({...item,text:d.text,edited:Date.now()});return authJSON({ok:true});}
   return authJSON({error:'Método não permitido.'},405);
  }
  return authJSON({error:'Não encontrado.'},404);
 };
}

