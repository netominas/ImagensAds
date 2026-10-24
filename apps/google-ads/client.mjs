import {readFile} from 'node:fs/promises';
import {createSign} from 'node:crypto';

export class AdsError extends Error{
 constructor(message,{status=502,details=[],requestId='',definite=false}={}){super(message);this.status=status;this.details=details;this.requestId=requestId;this.definite=definite;}
}
export function customerId(value){if(typeof value!=='string'||!/^\d{10}$/.test(value))throw new AdsError('ID de conta inválido.',{status:400});return value;}
export function createGoogleAdsClient({env=process.env,fetcher=fetch,credentials}={}){
 const version=env.GOOGLE_ADS_API_VERSION||'v25';if(!/^v\d{2}$/.test(version))throw Error('Versão Google Ads inválida.');
 let cachedCredentials,token,pending;
 async function identity(){
  if(cachedCredentials)return cachedCredentials;
  if(credentials)cachedCredentials=credentials;
  else{
   if(!env.GOOGLE_ADS_CREDENTIALS_FILE)throw new AdsError('A conta de serviço Google Ads ainda precisa ser configurada no servidor.',{status:400});
   try{cachedCredentials=JSON.parse(await readFile(env.GOOGLE_ADS_CREDENTIALS_FILE,'utf8'));}catch{throw new AdsError('Não foi possível carregar a credencial Google Ads no servidor.',{status:400});}
  }
  const c=cachedCredentials;
  if(c.type!=='service_account'||typeof c.client_email!=='string'||!c.client_email.endsWith('.iam.gserviceaccount.com')||typeof c.private_key!=='string'||c.token_uri!=='https://oauth2.googleapis.com/token')throw new AdsError('A credencial Google Ads não é uma conta de serviço válida.',{status:400});
  return c;
 }
 async function accessToken(){
  if(token&&token.until>Date.now()+60000)return token.value;
  if(pending)return pending;
  pending=(async()=>{
   const c=await identity(),now=Math.floor(Date.now()/1000),encode=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
   const data=encode({alg:'RS256',typ:'JWT'})+'.'+encode({iss:c.client_email,scope:'https://www.googleapis.com/auth/adwords',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600});
   const signer=createSign('RSA-SHA256');signer.update(data);signer.end();const assertion=data+'.'+signer.sign(c.private_key,'base64url');
   const response=await fetcher('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}),signal:AbortSignal.timeout(30000)});
   if(!response.ok)throw new AdsError('O Google não aceitou a autenticação da conta de serviço.',{status:502});
   const result=await response.json();if(typeof result.access_token!=='string'||!Number.isFinite(Number(result.expires_in)))throw new AdsError('Resposta de autenticação Google inválida.');
   token={value:result.access_token,until:Date.now()+Number(result.expires_in)*1000};return token.value;
  })();try{return await pending;}finally{pending=null;}
 }
 async function request(path,{mcc='',body}={}){
  if(mcc)customerId(mcc);
  const response=await fetcher('https://googleads.googleapis.com/'+version+'/'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+await accessToken(),'Content-Type':'application/json',...(mcc?{'login-customer-id':mcc}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(60000)});
  const data=await response.json();
  if(!response.ok){
   const errors=(data.error?.details||[]).flatMap(x=>Array.isArray(x.errors)?x.errors:[]);
   throw new AdsError('O Google Ads não aceitou a consulta ou configuração.',{status:response.status===403?403:422,definite:response.status>=400&&response.status<500&&response.status!==408,requestId:response.headers.get('request-id')||'',details:errors.map(e=>({message:String(e.message||'Solicitação recusada.').slice(0,2000),code:JSON.stringify(e.errorCode||{}),field:(e.location?.fieldPathElements||[]).map(x=>x.fieldName).join('.')}))});
  }
  return data;
 }
 return {
  configured:()=>Boolean(credentials||env.GOOGLE_ADS_CREDENTIALS_FILE),
  accessible:()=>request('customers:listAccessibleCustomers'),
  async search(cid,query,mcc=''){
   customerId(cid);const rows=[];let pageToken;
   do{const data=await request(`customers/${cid}/googleAds:search`,{mcc,body:{query,...(pageToken?{pageToken}:{})}});rows.push(...(data.results||[]));pageToken=data.nextPageToken;}while(pageToken);
   return rows;
  },
  mutate(cid,operations,{mcc='',validateOnly=true}={}){customerId(cid);return request(`customers/${cid}/googleAds:mutate`,{mcc,body:{mutateOperations:operations,validateOnly,partialFailure:false}});}
 };
}
