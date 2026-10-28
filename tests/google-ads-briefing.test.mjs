import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {validate,operations} from '../apps/google-ads/domain.mjs';
import {createGoogleAdsAPI} from '../apps/google-ads/api.mjs';

const complete={account_id:'1234567890',type:'SEARCH',name:'Campanha teste',theme:'Guia',url:'https://example.com/guia',budget:25,country:'BR',language:'pt',headlines:['Conheça o Guia','Leia as Orientações','Informações no Site'],descriptions:['Confira as informações no nosso guia.','Leia o conteúdo completo no site.'],keywords:['guia informativo']};
test('all briefing fields can be absent in drafts while final validation still requires Google configuration',()=>{
 const partial=validate({context:'Definir tudo pelo prompt'});assert.equal(partial.account_id,'');assert.equal(partial.type,'');assert.equal(partial.budget,null);assert.equal(partial.cpc_bid,null);assert.deepEqual(partial.headlines,[]);
 assert.throws(()=>validate(partial,true),/ID de conta/);
 assert.throws(()=>validate({...complete,budget:null},true),/orçamento diário/);
 assert.throws(()=>validate({...complete,cpc_bid:-1}),/positivo/);
 assert.throws(()=>validate({...complete,url:'javascript:alert(1)'}),/URL/);
});
test('automatic bids need no CPC; manual CPC and target CPA map only to the selected bidding strategy',()=>{
 const ops=operations({payload:complete},'geoTargetConstants/2076','languageConstants/1000');assert.deepEqual(ops[1].campaignOperation.create.targetSpend,{});assert.equal(ops[1].campaignOperation.create.status,'PAUSED');assert.equal(ops[4].adGroupOperation.create.cpcBidMicros,undefined);
 const conversions=operations({payload:{...complete,bidding_strategy:'MAXIMIZE_CONVERSIONS',target_cpa:1.25}},'geoTargetConstants/2076','languageConstants/1000');assert.deepEqual(conversions[1].campaignOperation.create.maximizeConversions,{targetCpaMicros:'1250000'});assert.equal(conversions[1].campaignOperation.create.manualCpc,undefined);
 assert.throws(()=>validate({...complete,bidding_strategy:'MANUAL_CPC'},true),/CPC manual precisa/);
 const capped=operations({payload:{...complete,bidding_strategy:'MAXIMIZE_CLICKS',cpc_bid:.3}},'geoTargetConstants/2076','languageConstants/1000');assert.deepEqual(capped[1].campaignOperation.create.targetSpend,{cpcBidCeilingMicros:'300000'});assert.equal(capped[4].adGroupOperation.create.cpcBidMicros,undefined);
});

test('prompt-only drafts generate reviewed configuration, resolve an accessible account and validate without a CPC',async()=>{
 const db=new DatabaseSync(':memory:');let output={...complete,account_name:'Conta teste',cpc_bid:null,bidding_strategy:'MAXIMIZE_CLICKS',policy_notes:[],image_prompt:'Arte editorial',long_headline:'',negatives:[]},pageCalls=0,mutations=0;
 const storage={db,keys:async()=>({openai:'fake-test-key'}),settings:async()=>({models:{}}),store:()=>({get:async()=>null})};
 const google={configured:()=>true,accessible:async()=>({resourceNames:['customers/1234567890']}),search:async(id,q)=>q.includes('FROM geo_target_constant')?[{geoTargetConstant:{resourceName:'geoTargetConstants/2076'}}]:q.includes('FROM language_constant')?[{languageConstant:{resourceName:'languageConstants/1000'}}]:[{customer:{id:'1234567890',descriptiveName:'Conta teste',status:'ENABLED',manager:false,currencyCode:'BRL'}}],mutate:async(id,ops,options)=>{mutations++;assert.equal(options.validateOnly,true);assert.deepEqual(ops[1].campaignOperation.create.targetSpend,{});return {};}};
 const api=createGoogleAdsAPI(storage,{google,generateText:async({prompt})=>{assert.match(prompt,/INSTRUÇÕES E CAMPOS DO USUÁRIO/);assert.match(prompt,/MAXIMIZE_CLICKS/);return {text:JSON.stringify(output)};},pageReader:async url=>{pageCalls++;assert.equal(url,'https://example.com/guia');return {url,text:'Informações editoriais da página'};}});
 const request=(path,body)=>api(new Request('https://brief.test/apps/google-ads/api/'+path,{method:'POST',headers:{Origin:'https://brief.test','Content-Type':'application/json'},body:JSON.stringify(body)}));
 async function generate(d){const pending=await(await request('drafts/generate',{id:d.id,revision:d.revision,payload:d.payload,read_page:true})).json();let job;for(let i=0;i<100;i++){job=await(await api(new Request('https://brief.test/apps/google-ads/api/job?id='+pending.job_id))).json();if(job.status!=='running')break;await new Promise(r=>setTimeout(r,1));}assert.equal(job.status,'done',job.error);return job.result;}
 try{
  let d=await(await request('drafts/new',{payload:{context:'Crie Pesquisa na conta 1234567890, Brasil, português, 25 por dia, https://example.com/guia, maximizar cliques sem teto.'}})).json();assert.equal(d.payload.account_id,'');assert.equal(mutations,0);
  d=await generate(d);assert.equal(d.payload.account_id,'1234567890');assert.equal(d.payload.currency,'BRL');assert.equal(d.payload.cpc_bid,null);assert.equal(d.payload.budget,25);assert.equal(pageCalls,1);assert.equal(mutations,0);
  const validated=await(await request('drafts/validate',{id:d.id,revision:d.revision})).json();assert.equal(validated.status,'VALIDATED');assert.equal(mutations,1);
  output={...output,account_id:'9999999999',budget:null};let missing=await(await request('drafts/new',{payload:{context:'Prepare somente os materiais, sem orçamento nem conta definidos.'}})).json();missing=await generate(missing);assert.equal(missing.payload.account_id,'');assert.equal(missing.payload.budget,null);assert.equal(missing.status,'DRAFT');assert.equal((await request('drafts/validate',{id:missing.id,revision:missing.revision})).status,400);assert.equal(mutations,1);
 }finally{db.close();}
});
