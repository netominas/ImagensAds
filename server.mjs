import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {runJob,validate} from './lib/generation.mjs';
import {memoryStore} from './lib/memory-store.mjs';
import {serveJob} from './netlify/functions/job.mjs';
const store=memoryStore();
const allowed=new Set(['index.html','app.js','core.js','styles.css']);
createServer(async(req,res)=>{
  try{
    const origin=`http://${req.headers.host}`;const url=new URL(req.url,origin);
    if(url.pathname==='/.netlify/functions/generate-background'){
      if(req.method!=='POST'){res.writeHead(405).end();return;}
      if(req.headers.origin&&req.headers.origin!==origin){res.writeHead(403).end();return;}
      let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>64000){res.writeHead(413).end();return;}}
      let input;try{input=validate(JSON.parse(raw));}catch(e){res.writeHead(400,{'Content-Type':'application/json'}).end(JSON.stringify({error:e.message}));return;}
      res.writeHead(202).end();runJob(input,store).catch(()=>console.error('Falha na execução local da geração.'));return;
    }
    if(url.pathname==='/.netlify/functions/job'){
      const response=await serveJob(new Request(url,{method:req.method,headers:req.headers}),store);res.writeHead(response.status,Object.fromEntries(response.headers));Readable.fromWeb(response.body).pipe(res);return;
    }
    const file=url.pathname==='/'?'index.html':url.pathname.slice(1);
    if(!allowed.has(file)){res.writeHead(404).end('Not found');return;}
    res.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8','Cache-Control':'no-store'}).end(await readFile(new URL(`./public/${file}`,import.meta.url)));
  }catch{res.writeHead(500).end('Erro interno.');}
}).listen(8888,'127.0.0.1',()=>console.log('AdStudio disponível em http://localhost:8888'));
