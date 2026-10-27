import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createPayments} from '../apps/roi/payments.mjs';
import {createROIAPI} from '../apps/roi/api.mjs';

test('payment profiles read local storage, refresh once per account, retain valid data on failure and persist on recreation',async()=>{
 const db=new DatabaseSync(':memory:');let calls=0,fail=false,release;
 const gate=new Promise(r=>release=r),catalog=async()=>({accounts:[{id:'1234567890',mcc:'9999999999',name:'Conta'}],networks:[{id:'1234',name:'Rede'}]});
 const google={search:async(id,query,mcc)=>{calls++;assert.equal(id,'1234567890');assert.equal(mcc,'9999999999');assert.match(query,/FROM billing_setup$/);await gate;if(fail)throw Error('secret-token');return [{billingSetup:{id:'10',status:'APPROVED',paymentsAccountInfo:{paymentsProfileId:'1234-5678-9012',paymentsProfileName:'Perfil',paymentsAccountId:'1234-5678-9012-3456'}}}];}};
 const admanager={paymentProfiles:async(id,{resource,saveResource})=>{assert.equal(id,'1234');if(!resource)saveResource('networks/1234/reports/1');else assert.equal(resource,'networks/1234/reports/1');return [];}};
 const payments=createPayments(db,{google,admanager,catalog});
 try{
  assert.equal((await payments.list()).items.length,2);assert.equal(calls,0);
  await payments.refresh();await payments.refresh();assert.equal(calls,1);release();await payments.settled();
  const found=await payments.list();assert.equal(found.items[0].profiles[0].id,'1234-5678-9012');assert.equal(found.items[1].profiles.length,0);assert.ok(found.items[1].checked);assert.equal(found.progress.done,2);
  fail=true;await payments.refresh();await payments.settled();const stale=(await payments.list()).items[0];assert.equal(stale.profiles[0].id,'1234-5678-9012');assert.ok(stale.error);assert.equal(stale.error.includes('secret-token'),false);assert.equal(stale.updated,found.items[0].updated);
  assert.equal((await createPayments(db,{google,admanager,catalog}).list()).items[0].profiles[0].id,'1234-5678-9012');
 }finally{db.close();}
});

test('payment API reads cached account list and rejects refresh from other origins',async()=>{
 const db=new DatabaseSync(':memory:'),api=createROIAPI({db},{google:{configured:()=>false},admanager:{}});
 try{
  db.prepare('INSERT OR REPLACE INTO roi_metadata VALUES (?,?,?)').run('catalog',JSON.stringify({accounts:[{id:'1234567890'}],networks:[]}),new Date().toISOString());
  const cached=await api(new Request('https://roi.test/apps/roi/api/payments'));assert.equal(cached.status,200);assert.equal((await cached.json()).items[0].checked,null);
  assert.equal((await api(new Request('https://roi.test/apps/roi/api/payments/refresh',{method:'POST',headers:{Origin:'https://other.test','Content-Type':'application/json'},body:'{}'}))).status,403);
 }finally{api.stopAuto();db.close();}
});


test('GAM profile reports use bounded official resources, reuse hidden definitions and explain restricted dimensions',async()=>{
 const {generateKeyPairSync}=await import('node:crypto'),{mkdtemp,writeFile,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path'),{createAdManager}=await import('../apps/roi/admanager.mjs');
 const dir=await mkdtemp(join(tmpdir(),'roi-payment-test-')),file=join(dir,'credential.json');
 const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});await writeFile(file,JSON.stringify({type:'service_account',client_email:'test@example.iam.gserviceaccount.com',private_key:privateKey.export({type:'pkcs8',format:'pem'}),token_uri:'https://oauth2.googleapis.com/token'}));
 let denied=false,created=0,saved;
 const fetcher=async(url,options)=>{
  if(url==='https://oauth2.googleapis.com/token')return Response.json({access_token:'mock',expires_in:3600});
  assert.ok(url.startsWith('https://admanager.googleapis.com/v1/networks/1234/'));
  if(url.endsWith('/reports')){created++;const body=JSON.parse(options.body);assert.equal(body.visibility,'HIDDEN');assert.deepEqual(body.reportDefinition.dimensions,['PAYMENT_PROFILE_ID','PAYMENT_PROFILE_NAME']);if(denied)return Response.json({error:{details:[{reason:'REPORT_ERROR_DIMENSION_VIEW_NOT_ALLOWED'}]}},{status:400});return Response.json({name:'networks/1234/reports/1'});}
  if(url.endsWith(':run'))return Response.json({done:true,response:{reportResult:'networks/1234/reports/1/results/2'}});
  if(url.endsWith(':fetchRows'))return Response.json({rows:[{dimensionValues:[{stringValue:'1234-5678-9012'},{stringValue:'Perfil GAM'}]},{dimensionValues:[{intValue:'0'}]}]});
  throw Error('Unexpected URL');
 };
 try{
  const gam=createAdManager({env:{GOOGLE_ADS_CREDENTIALS_FILE:file},fetcher});
  const first=await gam.paymentProfiles('1234',{saveResource:r=>saved=r});assert.equal(first.length,1);assert.equal(first[0].name,'Perfil GAM');
  await gam.paymentProfiles('1234',{resource:saved});assert.equal(created,1);
  await assert.rejects(gam.paymentProfiles('1234',{resource:'networks/9999/reports/1'}),/inválido/);
  denied=true;await assert.rejects(gam.paymentProfiles('1234'),/não autorizou/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
