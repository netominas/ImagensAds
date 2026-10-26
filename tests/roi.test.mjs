import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {openStorage} from '../lib/persistent.mjs';
import {hashPassword} from '../lib/auth.mjs';
import {createAppServer} from '../server.mjs';
import {attribution,site,revenueFacts,reconcile,finalURLs} from '../apps/roi/model.mjs';
import {dollarRates} from '../apps/roi/fx.mjs';
import {costFacts} from '../apps/roi/ads.mjs';
const date='2025-01-03',account='1234567890';
const cost=(extra={})=>({account,account_name:'Conta',campaign:'111',name:'Campanha',date,currency:'BRL',timezone:'America/Sao_Paulo',cost:10,site:'exemplo.com.br',utm:'promo',...extra});
const revenue=(extra={})=>({date,site:'exemplo.com.br',utm:'promo',network:'1234',network_name:'Rede',currency:'BRL',timezone:'America/Sao_Paulo',revenue:15,impressions:20,...extra});
const csv=(value='promo',money='15000000')=>({'Dimension.DATE':date,'Dimension.DOMAIN':'www.exemplo.com.br','Dimension.CUSTOM_CRITERIA':'utm_campaign='+value,'Column.AD_EXCHANGE_LINE_ITEM_LEVEL_REVENUE':money,'Column.AD_EXCHANGE_LINE_ITEM_LEVEL_IMPRESSIONS':'20'});

test('UTM resolution honors ad overrides, account fallback, case-sensitive values and registrable domains',()=>{
 const c={id:'111',trackingUrlTemplate:'{lpurl}?utm_campaign=campaign'},a={trackingUrlTemplate:'{lpurl}?utm_campaign={campaignId}&x={keyword}'};
 assert.equal(attribution('https://www.exemplo.com.br/page?old=1',c,{}, {},a).utm,'111');
 assert.equal(attribution('https://es.exemplo.com.br/',{id:'111'},{trackingUrlTemplate:'{lpurl}?utm_campaign=Nome+Da+Campanha'}).utm,'Nome Da Campanha');
 assert.equal(attribution('https://exemplo.com.br/',{id:'111',urlCustomParameters:[{key:'tag',value:'%5B+Guia+%5D'}]},{trackingUrlTemplate:'{lpurl}?utm_campaign={_tag}'}).utm,'[ Guia ]');
 assert.equal(site('https://sub.exemplo.co.uk/'),'exemplo.co.uk');assert.equal(site('https://es.exemplo.com.br/'),'exemplo.com.br');
 assert.equal(attribution('https://exemplo.com.br/',{id:'111',trackingUrlTemplate:'{lpurl}?utm_campaign={unknown}'}).utm,'');
});

test('GAM key-value reports count only utm_campaign, with micros converted once',()=>{
 const r={mode:'CUSTOM_CRITERIA',key:'1',rows:[csv(),{...csv(),'Dimension.CUSTOM_CRITERIA':'utm_source=google'},csv('/empty/')]};
 const facts=revenueFacts(r,{id:'1234',name:'Rede',currency:'BRL',timezone:'America/Sao_Paulo'});assert.equal(facts.length,1);assert.equal(facts[0].revenue,15);
});

test('configured final URLs are safe, deduplicated and do not change ROI aggregation',()=>{
 assert.deepEqual(finalURLs(['https://exemplo.com.br/pagina/','https://exemplo.com.br/pagina/','javascript:alert(1)','file:///secret','https://user:password@exemplo.com.br/','not-a-url']),['https://exemplo.com.br/pagina/']);
 const first='https://exemplo.com.br/pagina/',second='https://exemplo.com.br/outra/';
 const result=reconcile([cost({final_urls:[first]}),cost({final_urls:[first,second]})],[revenue()],{});
 assert.deepEqual(result.rows[0].final_urls,[first,second]);assert.equal(result.rows.length,1);assert.equal(result.rows[0].cost,20);
 assert.deepEqual(result.totals,reconcile([cost(),cost()],[revenue()],{}).totals);
 assert.deepEqual(reconcile([cost()],[revenue()],{}).rows[0].final_urls,[]);
});

test('ROI never double-counts cost across networks and excludes ambiguous or incomplete joins',()=>{
 const costs=[cost()],revenues=[revenue(),revenue({network:'5678',currency:'USD',revenue:2})],rates={[date]:{rate:5}};
 let r=reconcile(costs,revenues,rates);assert.equal(r.rows[0].cost,10);assert.equal(r.rows[0].revenue,25);assert.equal(r.totals.profit,15);assert.equal(r.totals.roi,1.5);
 r=reconcile([cost(),cost({campaign:'222',name:'Outra campanha'})],[revenue()],{});assert.equal(r.pending[0].status,'ambiguous');assert.equal(r.rows.every(x=>x.profit===null),true);assert.equal(r.sites[0].profit,null);
 r=reconcile([cost(),cost({campaign:'222'})],[revenue()],{},[{network:'1234',site:'exemplo.com.br',utm:'promo',account,campaign:'111'}]);assert.equal(r.rows.find(x=>x.campaign==='111').profit,5);assert.equal(r.rows.find(x=>x.campaign==='222').profit,null);
 r=reconcile([cost()],[revenue({currency:'USD'})],{});assert.equal(r.rows[0].profit,null);assert.equal(r.rows[0].revenue,null);
 r=reconcile([cost({currency:'USD'})],[revenue()],{});assert.equal(r.rows[0].cost,null);assert.equal(r.rows[0].revenue,15);assert.equal(r.rows[0].profit,null);
 r=reconcile([cost()],[revenue()],{},[],{partial:true});assert.equal(r.rows[0].profit,null);
 r=reconcile([cost()],[revenue({timezone:'America/Los_Angeles'})],{});assert.equal(r.rows[0].comparable,false);
 r=reconcile([cost({cost:0})],[revenue()],{});assert.equal(r.rows[0].roi,null);
 // A row with both a confirmed UTM and an ambiguous one must not present a partial ROI as complete.
 r=reconcile([cost(),cost({utm:'shared'}),cost({campaign:'222',utm:'shared'})],[revenue(),revenue({utm:'shared'})],{});assert.equal(r.rows.find(x=>x.campaign==='111').profit,null);
});

test('BCB quotes use sale rates and fall back to the last published business day without inventing rates',async()=>{
 const rates=await dollarRates('2025-01-03','2025-01-05',async url=>{assert.equal(new URL(url).hostname,'olinda.bcb.gov.br');return Response.json({value:[{cotacaoVenda:6.1,dataHoraCotacao:'2025-01-03 13:00:00'},{cotacaoVenda:6.0,dataHoraCotacao:'2025-01-02 13:00:00'}]});});
 assert.equal(rates['2025-01-03'].rate,6.1);assert.equal(rates['2025-01-05'].rate,6.1);assert.equal(rates['2025-01-05'].quote_date,'2025-01-03');assert.equal(rates['2025-01-05'].previous_day,true);
});

test('Ads costs reconcile campaign totals with ad and PMax details without duplication',async()=>{
 const google={async search(cid,q){if(q.includes('FROM customer'))return [{customer:{currencyCode:'BRL',timeZone:'America/Sao_Paulo',trackingUrlTemplate:'{lpurl}?utm_campaign={campaignid}'}}];
 if(q.includes('FROM ad_group_ad'))return [{campaign:{id:'111'},segments:{date},metrics:{costMicros:'10000000'},adGroupAd:{ad:{finalUrls:['https://exemplo.com.br/']}}}];
 if(q.includes('FROM asset_group'))return [{campaign:{id:'222'},segments:{date},metrics:{costMicros:'20000000'},assetGroup:{finalUrls:['https://outro.com.br/','https://outro.com.br/outra/']}}];
 return [{campaign:{id:'111',name:'Pesquisa',advertisingChannelType:'SEARCH'},segments:{date},metrics:{costMicros:'10000000'}},{campaign:{id:'222',name:'Pmax',advertisingChannelType:'PERFORMANCE_MAX'},segments:{date},metrics:{costMicros:'20000000'}},{campaign:{id:'333',name:'Sem detalhamento'},segments:{date},metrics:{costMicros:'7000000'}}];}};
 const r=await costFacts(google,{id:account,name:'Conta',mcc:''},date,date);assert.equal(r.reduce((s,x)=>s+x.cost,0),37);assert.equal(r.length,3);assert.equal(r.find(x=>x.campaign==='333').site,'');assert.equal(r.find(x=>x.campaign==='222').utm,'222');
 assert.deepEqual(r.find(x=>x.campaign==='111').final_urls,['https://exemplo.com.br/']);
 assert.deepEqual(r.find(x=>x.campaign==='222').final_urls,['https://outro.com.br/','https://outro.com.br/outra/']);
});

test('ROI shares login, blocks private files and cross-origin changes, persists snapshots and isolates studio data',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ak-roi-'));let storage=openStorage(dir,'9'.repeat(64));
 await storage.saveKeys({gemini:'private-fake-key-keep'});await storage.saveSettings({templates:[{id:'keep',prompt:'Manter'}],models:{}});storage.addImage({id:'keep-image'},'image/png',Buffer.from([1]));
 const google={configured:()=>true,accessible:async()=>({resourceNames:['customers/'+account]}),search:async(cid,q)=>q.includes('metrics.optimization_score_url')?[{customer:{id:account},metrics:{optimizationScoreUrl:'https://adwords.google.com/aw/recommendations?ocid=7654321&authuser=3'}}]:[{customer:{id:account,descriptiveName:'Conta',manager:false,status:'ENABLED',currencyCode:'BRL',timeZone:'America/Sao_Paulo'}}]};
 const gam={networks:async()=>[{id:'1234',name:'Rede',currency:'BRL',timezone:'America/Sao_Paulo'}],keys:async()=>[{id:'1',name:'utm_campaign',reportableType:'ON'}],report:async()=>({mode:'CUSTOM_CRITERIA',key:'1',report_id:'77',rows:[csv()]})};
 const env={ADMIN_EMAIL:'roi@example.test',ADMIN_PASSWORD_HASH:await hashPassword('roi-test-password-only')};
 const server=createAppServer({env,storage,authStore:storage.store('auth'),googleAds:google,roiOptions:{admanager:gam,loadCosts:async()=>[cost({final_urls:['https://exemplo.com.br/pagina/']})],rates:async()=>({})}});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port,prefix='/apps/roi/api';let cookie,run;
 const request=(path,body,origin=base)=>fetch(base+path,{method:body?'POST':'GET',redirect:'manual',headers:{'Content-Type':'application/json',Origin:origin,...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});
 try{
  for(const path of ['/apps/roi/','/apps/roi/sites','/apps/roi/vinculos'])assert.equal((await request(path)).status,303);
  assert.equal((await request(prefix+'/status')).status,401);assert.equal((await request(prefix+'/google-ads-link?account='+account+'&campaign=111')).status,401);for(const path of ['/apps/roi/private/index.html','/apps/roi/api.mjs','/apps/roi/admanager.mjs','/.tools/production-smoke.mjs'])assert.equal((await request(path)).status,404);
  const login=await request('/api/login',{email:env.ADMIN_EMAIL,password:'roi-test-password-only'});cookie=login.headers.get('set-cookie').split(';')[0];
  for(const path of ['/apps/roi/','/apps/roi/sites','/apps/roi/vinculos','/apps/criativos/','/apps/google-ads/'])assert.equal((await request(path)).status,200);
  const destination=await request(prefix+'/google-ads-link?account='+account+'&campaign=111');assert.equal(destination.status,303);assert.equal(destination.headers.get('location'),'https://ads.google.com/aw/campaigns?campaignId=111&ocid=7654321');
  assert.equal((await request(prefix+'/google-ads-link?account=9999999999&campaign=111')).status,403);assert.equal((await request(prefix+'/google-ads-link?account='+account+'&campaign=invalid')).status,400);
  assert.equal((await request(prefix+'/sync',{start:date,end:date,accounts:[account],networks:['1234']},'https://evil.example')).status,403);
  assert.equal((await request(prefix+'/sync',{start:date,end:date,accounts:['9999999999'],networks:['1234']})).status,400);
  const r=await request(prefix+'/sync',{start:date,end:date,accounts:[account],networks:['1234']});assert.equal(r.status,202);const job=await r.json();
  for(let attempt=0;attempt<50;attempt++){run=await(await request(prefix+'/run?id='+job.id)).json();if(run.status!=='running')break;await new Promise(r=>setTimeout(r,5));}
  assert.equal(run.status,'done');assert.equal(run.result.totals.profit,5);assert.equal(run.result.rows[0].name,'Campanha');assert.equal(run.result.sites[0].site,'exemplo.com.br');assert.equal(run.result.revenue_label,'Receita estimada Ad Exchange');
  assert.deepEqual(run.result.rows[0].final_urls,['https://exemplo.com.br/pagina/']);
  const rule={network:'1234',site:'exemplo.com.br',utm:'promo',account,campaign:'111'};
  assert.equal((await request(prefix+'/links',{...rule,campaign:'invalid'})).status,400);
  const linked=await(await request(prefix+'/links',rule)).json();assert.equal(linked.links.length,1);
  assert.equal((await(await request(prefix+'/catalog')).json()).links[0].campaign,'111');
  assert.equal((await fetch(base+prefix+'/links',{method:'DELETE',headers:{Cookie:cookie,Origin:base,'Content-Type':'application/json'},body:JSON.stringify({id:linked.links[0].id})})).status,200);
  assert.equal((await(await request(prefix+'/catalog')).json()).links.length,0);
  assert.equal((await(await request(prefix+'/run?id='+job.id)).json()).config.links.length,0);
  assert.equal((await storage.keys()).gemini,'private-fake-key-keep');assert.equal(storage.images()[0].id,'keep-image');assert.equal((await storage.settings()).templates[0].id,'keep');assert.equal(storage.db.prepare('SELECT ocid FROM roi_google_ads_accounts WHERE account=?').get(account).ocid,'7654321');
  await request('/api/logout',{});assert.equal((await request(prefix+'/run?id='+job.id)).status,401);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));storage.close();}
 try{storage=openStorage(dir,'9'.repeat(64));assert.equal(JSON.parse(storage.db.prepare('SELECT result FROM roi_runs WHERE id=?').get(run.id).result).totals.profit,5);assert.equal((await storage.keys()).gemini,'private-fake-key-keep');}finally{storage.close();const absolute=resolve(dir);assert.ok(absolute.startsWith(resolve(tmpdir())+sep));await rm(absolute,{recursive:true,force:true});}
});
