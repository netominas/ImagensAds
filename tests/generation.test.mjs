import test from 'node:test';
import assert from 'node:assert/strict';
import {validate,openaiSize,providerRequest,extractImage,generateOne,runJob} from '../lib/generation.mjs';
import {memoryStore} from '../lib/memory-store.mjs';
import {serveJob} from '../netlify/functions/job.mjs';
import {composePrompt,cropRect,nearestRatio} from '../public/core.js';
const input={provider:'openai',apiKey:'test-key-not-real',model:'gpt-image-2.5-sunburst',prompt:'A landscape',width:336,height:280,count:4,token:'a'.repeat(64)};
test('rejects invalid requests before billing',()=>{
  for(const patch of [{count:0},{count:5},{count:1.5},{width:0},{height:4097},{provider:'unknown'},{provider:'constructor'},{model:'../invalid'},{apiKey:'a'},{token:'bad'},{prompt:''}])assert.throws(()=>validate({...input,...patch}));
  assert.equal(validate(input),input);
});
test('provider payloads use fixed hosts and provider-specific parameters',()=>{
  const openai=providerRequest(input);assert.equal(openai.url,'https://api.openai.com/v1/images/generations');assert.equal(openai.body.n,1);assert.equal(openai.body.size,'1152x960');assert.equal(openai.body.output_format,'jpeg');assert.equal(openai.headers.Authorization,'Bearer test-key-not-real');
  const gemini=providerRequest({...input,provider:'gemini',model:'gemini-3.1-flash-image'});assert.equal(gemini.body.generationConfig.responseFormat.image.aspectRatio,'ASPECT_RATIO_FIVE_BY_FOUR');assert.equal(gemini.headers['x-goog-api-key'],input.apiKey);assert.equal(gemini.headers.Authorization,undefined);
  const grok=providerRequest({...input,provider:'grok'});assert.equal(grok.body.response_format,'b64_json');assert.equal(grok.body.aspect_ratio,'5:4');
});
test('Gemini extracts final image and skips thinking images',()=>{assert.deepEqual(extractImage('gemini',{candidates:[{content:{parts:[{thought:true,inlineData:{data:'thought'}},{inlineData:{data:'final',mimeType:'image/png'}}]}}]}),{base64:'final',mime:'image/png'});assert.throws(()=>extractImage('gemini',{candidates:[]}));});
test('errors never echo credentials or provider response',async()=>{
  await assert.rejects(generateOne(input,async()=>new Response(JSON.stringify({error:input.apiKey}),{status:401})),/Chave de API inválida/);
});
test('partial successes persist and duplicate jobs do not bill twice',async()=>{
  const store=memoryStore();let calls=0;
  const generate=async()=>{calls++;if(calls===2)throw new Error('Saldo insuficiente');return {base64:Buffer.from('test').toString('base64'),mime:'image/png'};};
  await Promise.all([runJob(input,store,generate),runJob(input,store,generate)]);
  assert.equal(calls,4);const state=await store.get(`${input.token}/job`,{type:'json'});assert.equal(state.status,'done');assert.equal(state.images.length,3);assert.equal(state.errors.length,1);assert.equal(JSON.stringify(state).includes(input.apiKey),false);
  const req=new Request('http://localhost/.netlify/functions/job?image=0',{headers:{'x-job-token':input.token}});const response=await serveJob(req,store);assert.equal(response.status,200);assert.equal(await response.text(),'test');
  const other=await serveJob(new Request('http://localhost/.netlify/functions/job',{headers:{'x-job-token':'b'.repeat(64)}}),store);assert.deepEqual(await other.json(),{status:'pending'});
});
test('job access validates tokens and expires results',async()=>{
  const store=memoryStore();assert.equal((await serveJob(new Request('http://localhost/job'),store)).status,400);
  await store.setJSON(`${input.token}/job`,{created:Date.now()-90000000,images:[]});assert.equal((await serveJob(new Request('http://localhost/job',{headers:{'x-job-token':input.token}}),store)).status,410);
});
test('crop stays in source bounds and matches output aspect for all positions',()=>{
  for(const [w,h] of [[336,280],[300,250],[1080,1080],[728,90],[1080,1920]])for(const zoom of [1,1.5,3])for(const x of [0,.5,1])for(const y of [0,.5,1]){
    const r=cropRect(1536,1024,w,h,zoom,x,y);assert.ok(r.sx>=0&&r.sy>=0&&r.sx+r.sw<=1536.00001&&r.sy+r.sh<=1024.00001);assert.ok(Math.abs(r.sw/r.sh-w/h)<1e-10);
  }
  assert.equal(nearestRatio(1080,1920),'9:16');assert.equal(nearestRatio(1080,1080),'1:1');
});
test('prompt templates substitute all placeholders and include output directions',()=>{
  const result=composePrompt('{{tema}}. {{tema}}','Café','Luz suave',336,280,false);assert.ok(result.includes('Café. Café'));assert.ok(result.includes('336 × 280'));assert.ok(result.includes('Não inclua textos'));assert.ok(composePrompt('Fotografia','Café','',300,250,true).includes('Tema: Café'));
});

test('OpenAI custom dimensions preserve ad ratios within API constraints',()=>{
  for(const [w,h] of [[336,280],[300,250],[1080,1080],[1080,1350],[1080,1920],[300,600],[728,90],[32,4096],[4096,32],[1200,628]]){
    const [ow,oh]=openaiSize('gpt-image-2.5-sunburst',w,h).split('x').map(Number);
    assert.equal(ow%16,0);assert.equal(oh%16,0);assert.ok(ow*oh>=655360&&ow*oh<=1572864);assert.ok(ow<=3840&&oh<=3840);assert.ok(ow/oh>=1/3&&ow/oh<=3);
    if(w===336||w===300||w===1080)assert.equal(ow/oh,w/h);
  }
  assert.equal(openaiSize('gpt-image-1',336,280),'1536x1024');
});
