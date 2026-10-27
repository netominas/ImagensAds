import {readFile} from 'node:fs/promises';
import {createSign} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {XMLParser} from 'fast-xml-parser';
import {parse} from 'csv-parse/sync';
import {AdsError} from '../google-ads/client.mjs';

export const array=value=>value==null?[]:Array.isArray(value)?value:[value];
export const xml=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
export function dateRange(start,end){
 for(const d of [start,end])if(!/^\d{4}-\d{2}-\d{2}$/.test(d)||!Number.isFinite(Date.parse(d))||new Date(d).toISOString().slice(0,10)!==d)throw new AdsError('Datas inválidas.',{status:400});
 if(start>end||(Date.parse(end)-Date.parse(start))/86400000>92)throw new AdsError('Use um período de até 93 dias.',{status:400});
}
export function createAdManager({env=process.env,fetcher=fetch,wait=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 const version=env.AD_MANAGER_API_VERSION||'v202608';if(!/^v\d{6}$/.test(version))throw Error('Versão do Ad Manager inválida.');
 const parser=new XMLParser({removeNSPrefix:true,parseTagValue:false,ignoreAttributes:true});let token,pending;
 async function access(){
  if(token&&token.until>Date.now()+60000)return token.value;if(pending)return pending;
  pending=(async()=>{
   let c;try{c=JSON.parse(await readFile(env.GOOGLE_AD_MANAGER_CREDENTIALS_FILE||env.GOOGLE_ADS_CREDENTIALS_FILE,'utf8'));}catch{throw new AdsError('Configure a credencial do Ad Manager no servidor.',{status:400});}
   if(c.type!=='service_account'||!c.client_email?.endsWith('.iam.gserviceaccount.com')||c.token_uri!=='https://oauth2.googleapis.com/token')throw new AdsError('Credencial de serviço inválida.',{status:400});
   const enc=o=>Buffer.from(JSON.stringify(o)).toString('base64url'),now=Math.floor(Date.now()/1000),input=enc({alg:'RS256',typ:'JWT'})+'.'+enc({iss:c.client_email,scope:'https://www.googleapis.com/auth/admanager',aud:c.token_uri,iat:now,exp:now+3600});
   const signer=createSign('RSA-SHA256');signer.update(input);signer.end();
   const response=await fetcher(c.token_uri,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:input+'.'+signer.sign(c.private_key,'base64url')}),signal:AbortSignal.timeout(30000)});
   if(!response.ok)throw new AdsError('Falha na autenticação do Ad Manager.');const data=await response.json();if(!data.access_token)throw new AdsError('Resposta de autenticação inválida.');token={value:data.access_token,until:Date.now()+Number(data.expires_in)*1000};return token.value;
  })();try{return await pending;}finally{pending=null;}
 }
 async function soap(network,service,method,body=''){
  if(network&&!/^\d{1,20}$/.test(network))throw new AdsError('Rede inválida.',{status:400});
  const ns='https://www.google.com/apis/ads/publisher/'+version;
  const payload=`<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns="${ns}"><soap:Header><RequestHeader>${network?'<networkCode>'+network+'</networkCode>':''}<applicationName>AK Workspace ROI</applicationName></RequestHeader></soap:Header><soap:Body><${method}>${body}</${method}></soap:Body></soap:Envelope>`;
  const response=await fetcher(`https://ads.google.com/apis/ads/publisher/${version}/${service}`,{method:'POST',headers:{Authorization:'Bearer '+await access(),'Content-Type':'text/xml; charset=utf-8',SOAPAction:method},body:payload,signal:AbortSignal.timeout(60000)});
  const raw=await response.text();if(raw.length>12000000||/<!DOCTYPE/i.test(raw))throw new AdsError('Resposta Ad Manager inválida.');
  let result;try{result=parser.parse(raw)?.Envelope?.Body;}catch{throw new AdsError('Resposta Ad Manager inválida.');}
  if(!response.ok||result?.Fault)throw new AdsError('O Ad Manager recusou a consulta: '+String(result?.Fault?.faultstring||'Confira acesso e compatibilidade do relatório.').slice(0,1500),{status:422});
  if(!result||!Object.hasOwn(result,method+'Response'))throw new AdsError('Resposta Ad Manager incompleta.');return result[method+'Response'].rval;
 }
 async function keys(network){
  const result=[];for(let offset=0;offset<10000;offset+=500){const page=await soap(network,'CustomTargetingService','getCustomTargetingKeysByStatement',`<filterStatement><query>WHERE status = 'ACTIVE' LIMIT 500 OFFSET ${offset}</query></filterStatement>`);const rows=array(page?.results);result.push(...rows.map(k=>({id:String(k.id),name:k.name,displayName:k.displayName||k.name,reportableType:k.reportableType,type:k.type})));if(rows.length<500)break;}return result;
 }
 async function download(url){
  const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password||u.port||!['storage.googleapis.com','ads.google.com','admanager.google.com','googleads.g.doubleclick.net'].includes(u.hostname)&&!u.hostname.endsWith('.storage.googleapis.com'))throw new AdsError('Destino de download do relatório não permitido.');
  const response=await fetcher(u,{redirect:'error',signal:AbortSignal.timeout(60000)});if(!response.ok)throw new AdsError('Falha ao baixar relatório do Ad Manager.');
  let size=0;const chunks=[];for await(const chunk of response.body){size+=chunk.length;if(size>25000000)throw new AdsError('Relatório grande demais. Reduza o período.');chunks.push(chunk);}let buffer=Buffer.concat(chunks);if(buffer[0]===31&&buffer[1]===139)buffer=gunzipSync(buffer,{maxOutputLength:50000000});return parse(buffer,{columns:true,bom:true,skip_empty_lines:true,max_record_size:1000000});
 }
 async function report(network,{start,end,key,mode='CUSTOM_DIMENSION',progress=()=>{}}){
  dateRange(start,end);if(!/^\d{1,20}$/.test(key)||!['CUSTOM_DIMENSION','CUSTOM_CRITERIA'].includes(mode))throw new AdsError('Chave UTM inválida.',{status:400});
  const date=d=>{const [year,month,day]=d.split('-').map(Number);return `<year>${year}</year><month>${month}</month><day>${day}</day>`;};
  const query=`<dimensions>DATE</dimensions><dimensions>DOMAIN</dimensions><dimensions>${mode}</dimensions><columns>AD_EXCHANGE_LINE_ITEM_LEVEL_IMPRESSIONS</columns><columns>AD_EXCHANGE_LINE_ITEM_LEVEL_REVENUE</columns><columns>AD_EXCHANGE_LINE_ITEM_LEVEL_CLICKS</columns><columns>AD_EXCHANGE_LINE_ITEM_LEVEL_AVERAGE_ECPM</columns><columns>AD_EXCHANGE_COST_PER_CLICK</columns><columns>PROGRAMMATIC_RESPONSES_SERVED</columns><columns>TOTAL_PROGRAMMATIC_ELIGIBLE_AD_REQUESTS</columns><startDate>${date(start)}</startDate><endDate>${date(end)}</endDate><dateRangeType>CUSTOM_DATE</dateRangeType>${mode==='CUSTOM_DIMENSION'?'<customDimensionKeyIds>'+key+'</customDimensionKeyIds>':''}`;
  const job=await soap(network,'ReportService','runReportJob',`<reportJob><reportQuery>${query}</reportQuery></reportJob>`);const jid=String(job.id);if(!/^\d+$/.test(jid))throw new AdsError('Relatório sem identificador.');
  progress('Processando relatório de receita…');
  for(let i=0;i<80;i++){
   const status=await soap(network,'ReportService','getReportJobStatus',`<reportJobId>${jid}</reportJobId>`);if(status==='COMPLETED'){
    const url=await soap(network,'ReportService','getReportDownloadUrlWithOptions',`<reportJobId>${jid}</reportJobId><reportDownloadOptions><exportFormat>CSV_DUMP</exportFormat><includeReportProperties>false</includeReportProperties><includeTotalsRow>false</includeTotalsRow><useGzipCompression>false</useGzipCompression></reportDownloadOptions>`);
    return {rows:await download(url),report_id:jid,mode,key};
   }if(status==='FAILED')throw new AdsError('O relatório do Ad Manager falhou.');await wait(3000);
  }throw new AdsError('O relatório está demorando. Tente um período menor.');
 }
 async function paymentProfiles(network,{resource,saveResource=()=>{}}={}){
  if(!/^\d{1,20}$/.test(network))throw new AdsError('Rede inválida.',{status:400});
  const prefix='networks/'+network+'/';
  async function rest(path,body){
   if(!path.startsWith(prefix)||!/^networks\/\d+\/[a-zA-Z0-9/:]+$/.test(path))throw new AdsError('Recurso do relatório inválido.');
   const response=await fetcher('https://admanager.googleapis.com/v1/'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+await access(),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(60000)}),data=await response.json();
   if(!response.ok){const reason=(data.error?.details||[]).map(d=>d.reason||'').join(' ');throw new AdsError(reason.includes('DIMENSION_VIEW_NOT_ALLOWED')?'O Ad Manager não autorizou as dimensões de perfil de pagamento nesta rede.':reason.includes('SERVICE_DISABLED')?'A API REST do Ad Manager precisa ser habilitada no projeto Google Cloud.':'O Ad Manager não disponibilizou os perfis de pagamento com este acesso.',{status:422});}return data;
  }
  if(resource&&!new RegExp('^'+prefix+'reports/\\d+$').test(resource))throw new AdsError('Relatório inválido.');
  if(!resource){const created=await rest(prefix+'reports',{displayName:'AK Workspace - Perfis de pagamento',visibility:'HIDDEN',reportDefinition:{dimensions:['PAYMENT_PROFILE_ID','PAYMENT_PROFILE_NAME'],metrics:['AD_EXCHANGE_IMPRESSIONS'],dateRange:{relative:'LAST_30_DAYS'},reportType:'HISTORICAL'}});resource=created.name;if(!new RegExp('^'+prefix+'reports/\\d+$').test(resource||''))throw new AdsError('Relatório sem identificador válido.');saveResource(resource);}
  let operation=await rest(resource+':run',{});
  for(let attempt=0;!operation.done&&attempt<12;attempt++){if(typeof operation.name!=='string')throw new AdsError('Execução de relatório inválida.');await wait(Math.min(5000*2**attempt,15000));operation=await rest(operation.name);}
  if(!operation.done||operation.error)throw new AdsError('O relatório de perfis de pagamento não foi concluído. Tente atualizar novamente.');
  const result=operation.response?.reportResult;if(typeof result!=='string'||!result.startsWith(resource+'/results/'))throw new AdsError('Resultado de relatório inválido.');
  const rows=await rest(result+':fetchRows'),profiles=new Map();
  if(rows.nextPageToken)throw new AdsError('O relatório de perfis excedeu o limite de leitura.');
  for(const row of rows.rows||[]){const values=row.dimensionValues||[],id=String(values[0]?.stringValue??values[0]?.intValue??'');if(id&&id!=='0'&&id!=='(not applicable)'&&/^[\d-]+$/.test(id))profiles.set(id,{id,name:String(values[1]?.stringValue||''),status:'REPORT_LAST_30_DAYS'});}
  return [...profiles.values()];
 }
 return {soap,keys,report,paymentProfiles,async networks(){return array(await soap('','NetworkService','getAllNetworks')).map(n=>({id:String(n.networkCode),name:n.displayName,currency:n.currencyCode,timezone:n.timeZone}));}};
}
