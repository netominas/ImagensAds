import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {fileURLToPath} from 'node:url';
import {runJob,validate} from './lib/generation.mjs';
import {dataAPI} from './lib/data-api.mjs';
import {createCopyAPI} from './lib/copy-api.mjs';
import {hashPassword,authSettings} from './lib/auth.mjs';
import {timingSafeEqual} from 'node:crypto';
import {memoryStore} from './lib/memory-store.mjs';
import {serveJob} from './netlify/functions/job.mjs';
import {login,logout,sessionStatus,requireSession,sameOrigin,authJSON} from './lib/auth.mjs';

export function createAppServer({env=process.env,authStore=memoryStore(),jobStore=memoryStore(),generate,generateText,storage}={}){
  const copyAPI=storage?createCopyAPI(storage,generateText):null;
  let activeJobs=0;
  const allowed=new Set(['index.html','app.js','core.js','styles.css','login.js','login.css','access.js','activate.html','activate.js','copy.js','copy-core.js','copy.css']);
  return createServer(async(req,res)=>{
    const send=response=>{
      res.writeHead(response.status,Object.fromEntries(response.headers));
      if(response.body)Readable.fromWeb(response.body).pipe(res);else res.end();
    };
    try{
      res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','no-referrer');
      res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
      const origin=env.APP_ORIGIN||`http://${req.headers.host}`,url=new URL(req.url,origin);
      const isData=url.pathname.startsWith('/api/data/');
      if(isData){
        if(!storage)return send(authJSON({error:'Não encontrado.'},404));
        const denied=await requireSession(new Request(url,{headers:req.headers}),authStore,env);if(denied)return send(denied);
      }
      let raw='';
      if(!['GET','HEAD'].includes(req.method)){
        const chunks=[];let size=0;const limit=isData?29*1024*1024:64000;
        for await(const chunk of req){size+=chunk.length;if(size>limit){res.writeHead(413).end();return;}chunks.push(chunk);}raw=Buffer.concat(chunks).toString();
      }
      const request=new Request(url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:raw}:{})});
      if(url.pathname==='/api/activate'){
        if(req.method!=='POST'||!sameOrigin(request)||!storage||authSettings(env))return send(authJSON({error:'Ativação indisponível.'},403));
        let data;try{data=JSON.parse(raw);}catch{return send(authJSON({error:'Dados inválidos.'},400));}
        const a=Buffer.from(String(data.token||'')),b=Buffer.from(env.SETUP_TOKEN||'');
        if(b.length!==64||a.length!==b.length||!timingSafeEqual(a,b))return send(authJSON({error:'Link inválido.'},403));
        if(typeof data.email!=='string'||data.email.length>254||!data.email.includes('@'))return send(authJSON({error:'Informe um e-mail válido.'},400));
        let hash;try{hash=await hashPassword(data.password);}catch(e){return send(authJSON({error:e.message},400));}
        const admin={ADMIN_EMAIL:data.email.trim().toLowerCase(),ADMIN_PASSWORD_HASH:hash};
        const saved=await storage.store('config').setJSON('administrator',admin,{onlyIfNew:true});
        if(!saved.modified)return send(authJSON({error:'O acesso já foi configurado.'},409));
        Object.assign(env,admin);delete env.SETUP_TOKEN;
        return send(authJSON({ok:true}));
      }
      if(isData)return send(await (url.pathname.startsWith('/api/data/cop')?copyAPI(request):dataAPI(request,storage)));
      if(['/api/login','/.netlify/functions/login'].includes(url.pathname))return send(await login(request,authStore,{env,ip:req.socket.remoteAddress}));
      if(['/api/logout','/.netlify/functions/logout'].includes(url.pathname))return send(await logout(request,authStore));
      if(['/api/session','/.netlify/functions/session'].includes(url.pathname))return send(await sessionStatus(request,authStore,env));
      if(['/studio','/.netlify/functions/studio','/.netlify/functions/job','/.netlify/functions/generate-background'].includes(url.pathname)){
        const denied=await requireSession(request,authStore,env);
        if(denied){
          if(url.pathname.endsWith('studio'))return send(new Response(null,{status:303,headers:{Location:'/','Cache-Control':'no-store'}}));
          return send(denied);
        }
        if(url.pathname.endsWith('studio'))return send(new Response(await readFile(new URL('./private/studio.html',import.meta.url)),{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'private, no-store','Vary':'Cookie'}}));
        if(url.pathname.endsWith('/job'))return send(await serveJob(request,jobStore));
        if(req.method!=='POST')return send(authJSON({error:'Método não permitido.'},405));
        if(!sameOrigin(request))return send(authJSON({error:'Origem não permitida.'},403));
        let input;try{const data=JSON.parse(raw);if(storage)data.apiKey=(await storage.keys())[data.provider]||data.apiKey;input=validate(data);}catch(e){return send(authJSON({error:e.message},400));}
        if(activeJobs>=2)return send(authJSON({error:'Há gerações em andamento. Aguarde a conclusão.'},429));
        let outputStore=jobStore;
        if(storage){
          const meta={theme:String(input.theme||'Criativo').slice(0,3000),prompt:input.prompt,model:input.model,provider:input.provider,w:input.width,h:input.height,jobToken:input.token,created:Date.now()};
          outputStore={...jobStore,async set(key,value,options){
            const match=key.match(/\/image-(\d+)$/);
            if(match){const index=Number(match[1]);const b=Buffer.from(value);const mime=b[0]===137?'image/png':b.toString('ascii',0,4)==='RIFF'?'image/webp':'image/jpeg';storage.addImage({...meta,id:`${input.token}-${index}`,index},mime,b);return {modified:true};}
            return jobStore.set(key,value,options);
          }};
        }
        send(new Response(null,{status:202}));
        activeJobs++;
        runJob(input,outputStore,generate).catch(()=>console.error('Falha na execução da geração.')).finally(()=>activeJobs--);
        return;
      }
      const file=url.pathname==='/'?'index.html':url.pathname.slice(1);
      if(!allowed.has(file)){res.writeHead(404).end('Not found');return;}
      res.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8','Cache-Control':'no-store'}).end(await readFile(new URL(`./public/${file}`,import.meta.url)));
    }catch{if(!res.headersSent)res.writeHead(500);res.end('Erro interno.');}
  });
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  try{process.loadEnvFile('.env');}catch(error){if(error.code!=='ENOENT')throw error;}
  const port=Number(process.env.PORT||8888);
  let options={};
  if(process.env.DATA_DIR){
    const {openStorage}=await import('./lib/persistent.mjs');
    const storage=openStorage(process.env.DATA_DIR,process.env.STORAGE_SECRET);
    const admin=await storage.store('config').get('administrator',{type:'json'});if(admin)Object.assign(process.env,admin);
    const authStore=storage.store('auth'),jobStore=storage.store('jobs');
    for(const row of storage.db.prepare("SELECT key,value FROM entries WHERE scope='jobs' AND key LIKE '%/job'").all()){
      const state=JSON.parse(Buffer.from(row.value).toString());if(state.status==='running')await jobStore.setJSON(row.key,{...state,status:'done',errors:[...(state.errors||[]),{index:state.images.length,message:'Servidor reiniciado. Confira o consumo antes de gerar novamente.'}]});
    }
    options={storage,authStore,jobStore};
  }
  createAppServer(options).listen(port,'127.0.0.1',()=>console.log(`AdStudio disponível em http://localhost:${port}`));
}
