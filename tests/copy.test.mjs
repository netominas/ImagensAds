import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStorage} from '../lib/persistent.mjs';
import {createCopyAPI} from '../lib/copy-api.mjs';
import {generateCopy,textRequest} from '../lib/copy-generation.mjs';
import {composeCopy,copyPresets} from '../public/copy-core.js';
test('copy providers extract final text and hide provider errors',async()=>{
 for(const [provider,data] of Object.entries({openai:{output:[{type:'message',content:[{type:'output_text',text:'Olá'}]}]},gemini:{candidates:[{content:{parts:[{thought:true,text:'hidden'},{text:'Olá'}]}}]},grok:{choices:[{message:{content:'Olá'}}]}})){
 const input={provider,model:'test-model',prompt:'Teste',apiKey:'secret'};
 assert.equal((await generateCopy(input,async()=>Response.json(data))).text,'Olá');
 await assert.rejects(generateCopy(input,async()=>new Response('secret',{status:401})),/Chave de API inválida/);
 assert.ok(textRequest(input).url.startsWith('https://'));
 }
 assert.match(composeCopy(copyPresets[0].prompt,{theme:'Café',count:2}),/2 variações/);
});
test('copies persist, deduplicate paid calls and support editing and deletion',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'copies-'));let s=openStorage(dir,'c'.repeat(64)),calls=0,finish;
 try{await s.saveKeys({openai:'test-secret'});let api=createCopyAPI(s,async()=>{calls++;await new Promise(r=>finish=r);return {text:'Texto criado',warning:''};});
 const req=(path,method='GET',body)=>api(new Request('https://test.example/api/data/'+path,{method,headers:{Origin:'https://test.example','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}));
 const config=await (await req('copy-config')).json();assert.equal(config.templates.length,4);
 assert.equal((await req('copy-config','PUT',config)).status,200);
 const input={id:'test-id',provider:'openai',model:'test-model',prompt:'Crie texto',theme:'Teste',count:1};
 assert.equal((await req('copies','POST',input)).status,202);assert.equal((await req('copies','POST',input)).status,202);
 assert.equal(calls,1);assert.equal((await req('copies/test-id','DELETE')).status,409);finish();
 for(let i=0;i<20;i++){if((await (await req('copies/test-id')).json()).status==='done')break;await new Promise(r=>setTimeout(r,5));}
 assert.equal((await req('copies/test-id','PUT',{text:'Editado'})).status,200);
 s.close();s=openStorage(dir,'c'.repeat(64));api=createCopyAPI(s);
 assert.equal((await (await req('copies/test-id')).json()).text,'Editado');
 assert.equal((await (await req('copies?offset=0.5')).json()).total,1);
 assert.equal((await req('copies/test-id','DELETE')).status,200);assert.equal((await req('copies/test-id')).status,404);
 assert.equal((await api(new Request('https://test.example/api/data/copies',{method:'POST',headers:{Origin:'https://evil.example'}}))).status,403);
 }finally{s.close();await rm(dir,{recursive:true,force:true});}
});
