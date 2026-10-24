import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {generateKeyPairSync,verify} from 'node:crypto';
import {openStorage} from '../lib/persistent.mjs';
import {hashPassword} from '../lib/auth.mjs';
import {createAppServer} from '../server.mjs';
import {createGoogleAdsClient,AdsError} from '../apps/google-ads/client.mjs';
import {validate,operations,rates,campaignReport,discover} from '../apps/google-ads/domain.mjs';
import {publicAddress} from '../apps/google-ads/page-reader.mjs';
import sharp from 'sharp';

const payload=(type='SEARCH')=>({account_id:'2824527639',type,theme:'Guia editorial',name:'Exemplo de campanha',business_name:'Exemplo',url:'https://example.com/',budget:10,cpc_bid:.2,country:'BR',language:'pt',context:'Conteúdo editorial para exemplo.',political:false,headlines:['Conheça Nosso Guia','Informações e Orientações','Confira Nosso Conteúdo'],descriptions:['Leia nosso guia informativo e confira as orientações.','Saiba mais no site.'],long_headline:type==='DISPLAY'?'Conheça nosso guia informativo':'',keywords:['guia informativo'],negatives:['login'],image_prompt:'Arte editorial original sem texto.',policy_notes:[]});
const customer={id:'2824527639',descriptiveName:'Conta de teste',manager:false,status:'ENABLED',currencyCode:'BRL',timeZone:'America/Sao_Paulo'};
function mockGoogle(){const calls=[];return {calls,configured:()=>true,accessible:async()=>({resourceNames:['customers/2824527639']}),async search(cid,q){
 if(q.includes('FROM geo_target_constant'))return [{geoTargetConstant:{resourceName:'geoTargetConstants/2076'}}];
 if(q.includes('FROM language_constant'))return [{languageConstant:{resourceName:'languageConstants/1006'}}];
 if(q.includes('FROM customer'))return [{customer}];
 if(q.includes('metrics.cost_micros'))return [{campaign:{id:'1'},metrics:{costMicros:'12300000',conversions:2.5,interactions:'100',clicks:'50',conversionsFromInteractionsRate:.025,costPerConversion:4920000,averageCpc:246000}}];
 return [{campaign:{id:'1',name:'Campanha teste',status:'PAUSED',advertisingChannelType:'SEARCH'},campaignBudget:{id:'9',amountMicros:'10000000',period:'DAILY'}}];
 },async mutate(cid,ops,options){calls.push({cid,ops,options});return {mutateOperationResponses:[{campaignResult:{resourceName:'customers/2824527639/campaigns/999'}}]};}};}

test('Google JWT uses pinned Google endpoints, single-flight token and paginated GAQL',async()=>{
 const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048}),seen=[];let pages=0;
 const credentials={type:'service_account',client_email:'service@test.iam.gserviceaccount.com',private_key:privateKey.export({type:'pkcs8',format:'pem'}),token_uri:'https://oauth2.googleapis.com/token'};
 const fetcher=async(url,options)=>{
  seen.push(url);
  if(url==='https://oauth2.googleapis.com/token'){
   const jwt=options.body.get('assertion'),parts=jwt.split('.'),claims=JSON.parse(Buffer.from(parts[1],'base64url'));
   assert.equal(claims.aud,url);assert.equal(claims.scope,'https://www.googleapis.com/auth/adwords');assert.equal(verify('RSA-SHA256',Buffer.from(parts.slice(0,2).join('.')),publicKey,Buffer.from(parts[2],'base64url')),true);
   return Response.json({access_token:'fake-token-for-test',expires_in:3600});
  }
  assert.equal(options.headers.Authorization,'Bearer fake-token-for-test');assert.equal(options.headers['login-customer-id'],'7629743493');
  const body=JSON.parse(options.body);pages++;
  return Response.json(pages===1?{results:[{campaign:{id:'1'}}],nextPageToken:'second'}:{results:[{campaign:{id:'2'}}]});
 };
 const client=createGoogleAdsClient({credentials,fetcher});
 assert.equal((await client.search('2824527639','SELECT campaign.id FROM campaign','7629743493')).length,2);
 assert.equal(seen.filter(u=>u.includes('oauth2')).length,1);assert.ok(seen.every(u=>u.startsWith('https://oauth2.googleapis.com/')||u.startsWith('https://googleads.googleapis.com/')));
 await assert.rejects(client.search('../secrets','SELECT customer.id FROM customer'));
});

test('campaign operations stay paused, reject unsupported formats and preserve fractional metrics',()=>{
 const ops=operations({payload:payload()},'geoTargetConstants/2076','languageConstants/1006');
 assert.equal(ops[1].campaignOperation.create.status,'PAUSED');assert.equal(ops[0].campaignBudgetOperation.create.amountMicros,'10000000');assert.equal(ops[4].adGroupOperation.create.cpcBidMicros,'200000');
 assert.equal(ops[5].adGroupCriterionOperation.create.keyword.matchType,'PHRASE');
 for(const type of ['PERFORMANCE_MAX','DEMAND_GEN'])assert.throws(()=>validate(payload(type)),/não estão implementados/);
 assert.equal(rates(60,2.5,100,50).cost_per_conversion,24);assert.equal(rates(0,0,0,0).cpc,null);
 assert.throws(()=>operations({payload:payload('DISPLAY')},'geoTargetConstants/2076','languageConstants/1006'),/quadrado e paisagem/);
 const display=operations({payload:payload('DISPLAY')},'geoTargetConstants/2076','languageConstants/1006',[{role:'landscape',bytes:Buffer.from('landscape')},{role:'square',bytes:Buffer.from('square')}]);
 assert.equal(display.at(-1).adGroupAdOperation.create.ad.responsiveDisplayAd.marketingImages.length,1);
 assert.equal(display[1].campaignOperation.create.status,'PAUSED');
});

test('reports keep zero-activity campaigns, use micro-units, and reject invalid date ranges',async()=>{
 const result=await campaignReport(mockGoogle(),{id:'2824527639',mcc:''},'2026-10-01','2026-10-07');
 assert.equal(result.rows[0].cost,12.3);assert.equal(result.rows[0].budget,10);assert.equal(result.rows[0].cost_per_conversion,4.92);assert.equal(result.rows[0].cpc,.246);
 await assert.rejects(campaignReport(mockGoogle(),{id:'2824527639',mcc:''},'2026-02-31','2026-03-07'));
 await assert.rejects(campaignReport(mockGoogle(),{id:'2824527639',mcc:''},'2026-10-07','2026-10-01'));
});

test('page reader rejects loopback, private, mapped and documentation networks',()=>{
 for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','100.64.0.1','192.168.1.1','::1','::ffff:127.0.0.1','2001:db8::1','2002:7f00:1::'])assert.equal(publicAddress(ip),false,ip);
 assert.equal(publicAddress('8.8.8.8'),true);assert.equal(publicAddress('2606:4700:4700::1111'),true);
});

test('AK session protects Google Ads pages and APIs; drafts, images and existing studio survive reopen',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ak-google-ads-'));let storage=openStorage(dir,'7'.repeat(64));
 const env={ADMIN_EMAIL:'test@example.test',ADMIN_PASSWORD_HASH:await hashPassword('test-password-only-for-this-suite')},google=mockGoogle();
 await storage.saveKeys({gemini:'private-fake-key-not-for-network'});await storage.saveSettings({templates:[{id:'keep',name:'Original',prompt:'Preservar'}],models:{gemini:'test-image-model'}});storage.addImage({id:'original-studio-image',theme:'Manter'},'image/png',Buffer.from([1,2,3]));
 const server=createAppServer({env,storage,authStore:storage.store('auth'),jobStore:storage.store('jobs'),googleAds:google});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port,api='/apps/google-ads/api/';let cookie,draftId;
 const send=(path,body,method='POST',origin=base)=>fetch(base+path,{method,headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});
 try{
  for(const path of ['/apps/google-ads/','/apps/google-ads/criar']){const r=await fetch(base+path,{redirect:'manual'});assert.equal(r.status,303);assert.equal(r.headers.get('location'),'/login');}
  for(const path of ['accounts','creator/status','drafts','image','job','health'])assert.equal((await fetch(base+api+path)).status,401);
  for(const path of ['/apps/google-ads/private/create.html','/apps/google-ads/api.mjs','/runtime.env','/.env','/data/adstudio.sqlite','/apps/google-ads/../../private/dashboard.html'])assert.equal((await fetch(base+path)).status,404);
  assert.equal((await fetch(base+'/apps/google-ads/creator.js')).status,200);
  const login=await send('/api/login',{email:env.ADMIN_EMAIL,password:'test-password-only-for-this-suite'});assert.equal(login.status,200);cookie=login.headers.get('set-cookie').split(';')[0];
  for(const path of ['/','/apps/criativos/','/apps/google-ads/','/apps/google-ads/criar'])assert.equal((await send(path,null,'GET')).status,200);
  const html=await(await send('/apps/google-ads/',null,'GET')).text();assert.match(html,/Todas as aplicações/);
  const status=await(await send(api+'creator/status',null,'GET')).json();assert.equal(status.configured,true);assert.equal(status.provider,'gemini');assert.equal(JSON.stringify(status).includes('private-fake'),false);
  assert.equal((await send(api+'drafts/new',{payload:payload()},'POST','https://evil.example')).status,403);
  let d=await(await send(api+'drafts/new',{payload:payload()})).json();draftId=d.id;assert.equal(d.status,'DRAFT');
  assert.equal((await send(api+'drafts/publish',{id:d.id,revision:d.revision})).status,409);assert.equal(google.calls.length,0);
  d=await(await send(api+'drafts/validate',{id:d.id,revision:d.revision})).json();assert.equal(d.status,'VALIDATED');assert.equal(google.calls[0].options.validateOnly,true);
  const oldRevision=d.revision;d=await(await send(api+'drafts/save',{id:d.id,revision:d.revision,payload:d.payload})).json();assert.equal(d.status,'DRAFT');
  assert.equal((await send(api+'drafts/save',{id:d.id,revision:oldRevision,payload:d.payload})).status,409);
  d=await(await send(api+'drafts/validate',{id:d.id,revision:d.revision})).json();
  const options={id:d.id,revision:d.revision};d=await(await send(api+'drafts/publish',options)).json();assert.equal(d.status,'CREATED');assert.equal(d.result.campaign_status,'PAUSED');
  const count=google.calls.length;assert.equal((await send(api+'drafts/publish',options)).status,200);assert.equal(google.calls.length,count);
  let display=await(await send(api+'drafts/new',{payload:payload('DISPLAY')})).json();
  const image=await sharp({create:{width:1200,height:800,channels:3,background:'#dceade'}}).png().toBuffer();
  display=await(await send(api+'drafts/upload',{id:display.id,revision:display.revision,image:image.toString('base64')})).json();assert.equal(display.payload.images.length,2);
  const picture=await send(api+'image?draft='+display.id+'&name='+display.payload.images[0].name,null,'GET');assert.equal(picture.status,200);assert.match(picture.headers.get('content-type'),/image\/jpeg/);
  const meta=await sharp(Buffer.from(await picture.arrayBuffer())).metadata();assert.equal(meta.width,1200);assert.equal(meta.height,628);
  let uncertain=await(await send(api+'drafts/new',{payload:payload()})).json();
  uncertain=await(await send(api+'drafts/validate',{id:uncertain.id,revision:uncertain.revision})).json();
  const originalMutate=google.mutate;let attempts=0;
  google.mutate=async()=>{attempts++;throw new Error('Network timeout after sending request');};
  assert.equal((await send(api+'drafts/publish',{id:uncertain.id,revision:uncertain.revision})).status,502);
  uncertain=await(await send(api+'draft?id='+uncertain.id,null,'GET')).json();assert.equal(uncertain.status,'UNKNOWN');
  assert.equal((await send(api+'drafts/publish',{id:uncertain.id,revision:uncertain.revision})).status,409);assert.equal(attempts,1);google.mutate=originalMutate;
  assert.equal(storage.images()[0].id,'original-studio-image');assert.equal((await storage.settings()).templates[0].id,'keep');assert.equal((await storage.keys()).gemini,'private-fake-key-not-for-network');
  await send('/api/logout',{});assert.equal((await send(api+'drafts',null,'GET')).status,401);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));storage.close();}
 try{storage=openStorage(dir,'7'.repeat(64));assert.equal(storage.db.prepare('SELECT status FROM google_ads_drafts WHERE id=?').get(draftId).status,'CREATED');assert.equal(storage.images()[0].id,'original-studio-image');assert.equal((await readFile(join(dir,'adstudio.sqlite'))).includes(Buffer.from('private-fake-key-not-for-network')),false);}finally{storage.close();const absolute=resolve(dir);assert.ok(absolute.startsWith(resolve(tmpdir())));await rm(absolute,{recursive:true,force:true});}
});
