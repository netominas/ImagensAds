import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {fileURLToPath} from 'node:url';
import {runJob,validate} from './lib/generation.mjs';
import {memoryStore} from './lib/memory-store.mjs';
import {serveJob} from './netlify/functions/job.mjs';
import {login,logout,sessionStatus,requireSession,sameOrigin,authJSON} from './lib/auth.mjs';

export function createAppServer({env=process.env,authStore=memoryStore(),jobStore=memoryStore(),generate}={}){
  const allowed=new Set(['index.html','app.js','core.js','styles.css','login.js','login.css','access.js']);
  return createServer(async(req,res)=>{
    const send=response=>{
      res.writeHead(response.status,Object.fromEntries(response.headers));
      if(response.body)Readable.fromWeb(response.body).pipe(res);else res.end();
    };
    try{
      const origin=`http://${req.headers.host}`,url=new URL(req.url,origin);
      let raw='';
      if(!['GET','HEAD'].includes(req.method)){
        for await(const chunk of req){raw+=chunk;if(raw.length>64000){res.writeHead(413).end();return;}}
      }
      const request=new Request(url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:raw}:{})});
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
        let input;try{input=validate(JSON.parse(raw));}catch(e){return send(authJSON({error:e.message},400));}
        send(new Response(null,{status:202}));
        runJob(input,jobStore,generate).catch(()=>console.error('Falha na execução local da geração.'));
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
  createAppServer().listen(port,'127.0.0.1',()=>console.log(`AdStudio disponível em http://localhost:${port}`));
}
