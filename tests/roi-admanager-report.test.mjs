import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {createAdManager} from '../apps/roi/admanager.mjs';

test('GAM custom dimension requests follow the SOAP schema order through report download',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'roi-report-')),file=join(directory,'credential.json');
 const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
 await writeFile(file,JSON.stringify({type:'service_account',client_email:'test@example.iam.gserviceaccount.com',
  private_key:privateKey.export({type:'pkcs8',format:'pem'}),token_uri:'https://oauth2.googleapis.com/token'}));
 const fetcher=async(url,options)=>{
  if(String(url)==='https://oauth2.googleapis.com/token')return Response.json({access_token:'mock',expires_in:3600});
  if(String(url)==='https://storage.googleapis.com/roi-test/report')return new Response('Dimension.DATE,Dimension.DOMAIN\n2026-11-17,example.com\n');
  const method=options.headers.SOAPAction;
  let value;
  if(method==='runReportJob'){
   const xml=options.body;
   assert.match(xml,/<customDimensionKeyIds>1<\/customDimensionKeyIds><customDimensionKeyIds>2<\/customDimensionKeyIds><startDate>/);
   assert.ok(xml.indexOf('<customDimensionKeyIds>')<xml.indexOf('<dateRangeType>'));
   value='<id>55</id>';
  }else if(method==='getReportJobStatus')value='COMPLETED';
  else if(method==='getReportDownloadUrlWithOptions')value='https://storage.googleapis.com/roi-test/report';
  else throw Error('Unexpected SOAP request');
  return new Response(`<Envelope><Body><${method}Response><rval>${value}</rval></${method}Response></Body></Envelope>`);
 };
 try{
  const client=createAdManager({env:{GOOGLE_AD_MANAGER_CREDENTIALS_FILE:file},fetcher});
  const report=await client.report('1234',{start:'2026-11-17',end:'2026-11-17',key:'1',additionalKeys:['2']});
  assert.equal(report.report_id,'55');
  assert.equal(report.rows[0]['Dimension.DOMAIN'],'example.com');
 }finally{
  assert.ok(resolve(directory).startsWith(resolve(tmpdir())+sep));
  await rm(directory,{recursive:true,force:true});
 }
});
