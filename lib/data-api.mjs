import {authJSON,sameOrigin} from './auth.mjs';
import {presets,providers} from '../public/core.js';

export async function dataAPI(request,storage){
  const url=new URL(request.url),path=url.pathname,method=request.method;
  if(!['GET','HEAD'].includes(method)&&!sameOrigin(request))return authJSON({error:'Origem não permitida.'},403);
  if(path==='/api/data/settings'){
    if(method==='GET'){
      const settings=await storage.settings(),keys=await storage.keys();
      return authJSON({...settings,templates:settings.templates||presets,configuredKeys:Object.fromEntries(Object.keys(providers).map(p=>[p,Boolean(keys[p])]))});
    }
    if(method!=='PUT')return authJSON({error:'Método não permitido.'},405);
    let data;try{data=await request.json();}catch{return authJSON({error:'JSON inválido.'},400);}
    const settings=await storage.settings();
    if(data.templates!==undefined){
      if(!Array.isArray(data.templates)||!data.templates.length||data.templates.length>100||data.templates.some(p=>!p||typeof p.id!=='string'||p.id.length>100||typeof p.name!=='string'||!p.name.trim()||p.name.length>200||typeof p.prompt!=='string'||!p.prompt.trim()||p.prompt.length>14000))return authJSON({error:'Biblioteca inválida.'},400);
      settings.templates=data.templates.map(({id,name,prompt,description,icon})=>({id,name,prompt,description:String(description||'').slice(0,1000),icon:String(icon||'✧').slice(0,20)}));
    }
    if(data.models!==undefined){
      if(!data.models||typeof data.models!=='object'||Object.entries(data.models).some(([p,v])=>!Object.hasOwn(providers,p)||typeof v!=='string'||!/^[a-zA-Z0-9._-]{1,100}$/.test(v)))return authJSON({error:'Modelo inválido.'},400);
      settings.models=data.models;
    }
    if(data.keys!==undefined){
      if(!data.keys||typeof data.keys!=='object'||Object.entries(data.keys).some(([p,v])=>!Object.hasOwn(providers,p)||typeof v!=='string'||(v!==''&&(v.length<10||v.length>1024||/[\r\n]/.test(v)))))return authJSON({error:'Chave inválida.'},400);
      const keys=await storage.keys();for(const [p,v] of Object.entries(data.keys)){if(v)keys[p]=v;else delete keys[p];}await storage.saveKeys(keys);
    }
    await storage.saveSettings(settings);return authJSON({ok:true});
  }
  if(path==='/api/data/images'&&method==='GET')return authJSON(storage.images());
  if(path==='/api/data/images'&&method==='POST'){
    let data;try{data=await request.json();}catch{return authJSON({error:'JSON inválido.'},400);}
    const {id,mime,base64}=data;
    if(typeof id!=='string'||!/^[a-zA-Z0-9-]{1,100}$/.test(id)||!['image/png','image/jpeg','image/webp'].includes(mime)||typeof base64!=='string'||base64.length>28*1024*1024)return authJSON({error:'Imagem inválida.'},400);
    const bytes=Buffer.from(base64,'base64');if(!bytes.length||bytes.length>20*1024*1024)return authJSON({error:'Imagem muito grande ou vazia.'},400);
    const meta={id,theme:String(data.theme||'Imagem importada').slice(0,3000),provider:'upload',w:1080,h:1080,created:Date.now()};
    storage.addImage(meta,mime,bytes);return authJSON(meta,201);
  }
  const match=path.match(/^\/api\/data\/images\/([a-zA-Z0-9-]{1,100})$/);
  if(match){
    if(method==='DELETE'){storage.deleteImage(match[1]);return authJSON({ok:true});}
    if(method==='GET'){
      const image=storage.image(match[1]);if(!image)return authJSON({error:'Imagem não encontrada.'},404);
      return new Response(image.bytes,{headers:{'Content-Type':image.mime,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff',...(url.searchParams.has('download')?{'Content-Disposition':`attachment; filename="adstudio-${match[1]}.${image.mime==='image/jpeg'?'jpg':image.mime.split('/')[1]}"`}:{})}});
    }
    return authJSON({error:'Método não permitido.'},405);
  }
  return authJSON({error:'Não encontrado.'},404);
}
