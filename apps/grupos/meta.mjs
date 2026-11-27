// Leitura (somente leitura) das campanhas e dos leads da Meta Marketing API.
// O token fica só no servidor (runtime.env) e nunca vai para o navegador nem para os registros.
//   META_ACCESS_TOKEN  token do usuário do sistema   META_AD_ACCOUNT  conta de anúncios (act_123… ou só os números)
//   META_API_VERSION   opcional (padrão v24.0)
const CACHE_MS=5*60*1000,MIN_REFRESH_MS=60*1000,MAX_PAGES=30;
const LEAD='lead'; // mesmo valor do evento Lead do pixel (offsite_conversion.fb_pixel_lead)

const metaError=(message,status=502)=>Object.assign(new Error(message),{status});

export function createMeta(env=process.env,{fetchImpl=globalThis.fetch,clock=()=>Date.now()}={}){
 const token=String(env.META_ACCESS_TOKEN||'').trim();
 const raw=String(env.META_AD_ACCOUNT||'').trim().replace(/^act_/i,'');
 const account=/^\d{5,25}$/.test(raw)?'act_'+raw:'';
 const version=/^v\d{1,2}\.\d$/.test(String(env.META_API_VERSION||''))?env.META_API_VERSION:'v24.0';
 const configured=!!token&&!!account;
 const cache=new Map(); // chave -> {at, value} | {pending}

 async function call(path,params){
  const query=new URLSearchParams({...params,access_token:token});
  let response;
  try{response=await fetchImpl(`https://graph.facebook.com/${version}/${path}?${query}`,{signal:AbortSignal.timeout(45000)});}
  catch{throw metaError('Não foi possível falar com a Meta agora. Tente de novo em instantes.');}
  const data=await response.json().catch(()=>({}));
  if(!response.ok||data.error){
   const code=data.error?.code;
   if([4,17,32,613,80000,80004].includes(code))throw metaError('A Meta limitou as consultas por alguns minutos. Tente de novo depois.',429);
   if(code===190)throw metaError('O token da Meta foi recusado (expirado ou sem permissão).');
   throw metaError('A Meta não devolveu os dados (erro '+(code??response.status)+').');
  }
  return data;
 }
 async function pages(path,params){
  const out=[];
  let after;
  for(let i=0;i<MAX_PAGES;i++){
   const data=await call(path,after?{...params,after}:params);
   out.push(...(data.data||[]));
   after=data.paging?.next?data.paging.cursors?.after:null;
   if(!after)break;
  }
  return out;
 }
 // Resultado em cache por alguns minutos; consultas iguais simultâneas viram uma só.
 async function cached(key,fresh,load){
  const hit=cache.get(key),now=clock();
  if(hit?.pending)return hit.pending;
  if(hit&&now-hit.at<(fresh?MIN_REFRESH_MS:CACHE_MS))return hit.value;
  const pending=load().then(value=>{cache.set(key,{at:clock(),value});return value;},error=>{if(hit)cache.set(key,hit);else cache.delete(key);throw error;});
  cache.set(key,{...(hit||{at:0}),pending});
  return pending;
 }

 return {
  configured,account,
  // [{id, name, status}]
  campaigns:({fresh=false}={})=>cached('campaigns',fresh,async()=>(await pages(`${account}/campaigns`,{fields:'id,name,effective_status',limit:'500'}))
   .map(c=>({id:String(c.id),name:String(c.name||c.id),status:String(c.effective_status||'')}))),
  // [{id, name, day, spend, impressions, leads}] — uma linha por campanha e dia (calendário da conta de anúncios)
  insights:(since,until,{fresh=false}={})=>cached(`insights|${since}|${until}`,fresh,async()=>(await pages(`${account}/insights`,
   {level:'campaign',time_increment:'1',time_range:JSON.stringify({since,until}),fields:'campaign_id,campaign_name,spend,impressions,actions',limit:'500'}))
   .map(r=>({id:String(r.campaign_id),name:String(r.campaign_name||r.campaign_id),day:String(r.date_start),spend:Number(r.spend)||0,
    impressions:Number(r.impressions)||0,leads:Number((r.actions||[]).find(a=>a.action_type===LEAD)?.value)||0}))),
 };
}
