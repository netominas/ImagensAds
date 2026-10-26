import {createGoogleAdsLinks} from './google-ads-links.mjs';
import {randomBytes} from 'node:crypto';
import {authJSON,sameOrigin} from '../../lib/auth.mjs';
import {AdsError,createGoogleAdsClient} from '../google-ads/client.mjs';
import {discover} from '../google-ads/domain.mjs';
import {createAdManager,dateRange} from './admanager.mjs';
import {dollarRates,today} from './fx.mjs';
import {costFacts} from './ads.mjs';
import {reconcile,revenueFacts,site} from './model.mjs';
const id=()=>randomBytes(16).toString('hex');
export function createROIAPI(storage,{env=process.env,google=createGoogleAdsClient({env}),admanager=createAdManager({env}),rates=dollarRates,loadCosts=costFacts}={}){
 const db=storage.db;let active=false,catalogCache,catalogPending;
 db.exec(`CREATE TABLE IF NOT EXISTS roi_runs (id TEXT PRIMARY KEY,status TEXT NOT NULL,start TEXT NOT NULL,end TEXT NOT NULL,config TEXT NOT NULL,result TEXT,progress TEXT NOT NULL,error TEXT,created TEXT NOT NULL,finished TEXT);
 CREATE TABLE IF NOT EXISTS roi_links (id TEXT PRIMARY KEY,network TEXT NOT NULL,site TEXT NOT NULL,utm TEXT NOT NULL,account TEXT NOT NULL,campaign TEXT NOT NULL,UNIQUE(network,site,utm));
 CREATE TABLE IF NOT EXISTS roi_settings (id INTEGER PRIMARY KEY CHECK(id=1),data TEXT NOT NULL);`);
 db.prepare("UPDATE roi_runs SET status='error',error='Sincronização interrompida pelo reinício. Os relatórios anteriores foram preservados.' WHERE status='running'").run();
 const googleAdsLink=createGoogleAdsLinks(db,google);
 const links=()=>db.prepare('SELECT * FROM roi_links ORDER BY site,utm').all();
 const config=()=>{const r=db.prepare('SELECT data FROM roi_settings WHERE id=1').get();return r?JSON.parse(r.data):null;};
 async function catalog(refresh=false){
  if(!refresh&&catalogCache&&Date.now()-catalogCache.at<600000)return catalogCache.data;if(catalogPending)return catalogPending;
  catalogPending=(async()=>{const [ads,networks]=await Promise.all([discover(google),admanager.networks()]);const data={accounts:ads.accounts,networks,warnings:ads.warnings};catalogCache={data,at:Date.now()};return data;})();try{return await catalogPending;}finally{catalogPending=null;}
 }
 function getRun(rid){if(!/^[a-f0-9]{32}$/.test(rid||''))throw new AdsError('Sincronização inválida.',{status:400});const r=db.prepare('SELECT * FROM roi_runs WHERE id=?').get(rid);if(!r)throw new AdsError('Relatório não encontrado.',{status:404});return {...r,config:JSON.parse(r.config),result:r.result?JSON.parse(r.result):null};}
 async function sync(run,scope,data,rules){
  const costs=[],revenues=[],warnings=[...data.warnings],sources=[],reportIds=[];let quotes={},partial=Boolean(data.warnings.length);
  const progress=message=>db.prepare('UPDATE roi_runs SET progress=? WHERE id=?').run(message,run);
  const selectedAccounts=data.accounts.filter(a=>scope.accounts.includes(a.id)),selectedNetworks=data.networks.filter(n=>scope.networks.includes(n.id));
  let cursor=0,done=0;
  await Promise.all(Array.from({length:Math.min(3,selectedAccounts.length)},async()=>{for(;;){const account=selectedAccounts[cursor++];if(!account)break;try{costs.push(...await loadCosts(google,account,scope.start,scope.end));sources.push({kind:'ads',id:account.id,name:account.name,ok:true});}catch{partial=true;warnings.push('Falha ao consultar a conta Google Ads '+account.name+' ('+account.id+').');sources.push({kind:'ads',id:account.id,name:account.name,ok:false});}done++;progress(`Custos Google Ads: ${done} de ${selectedAccounts.length} contas`);}}));
  for(const network of selectedNetworks){
   try{progress('Consultando receita de '+network.name+'…');const keys=await admanager.keys(network.id),key=keys.find(k=>k.name==='utm_campaign');
    if(!key||key.reportableType==='OFF')throw new AdsError('utm_campaign não está habilitada para relatórios nesta rede.');
    const report=await admanager.report(network.id,{start:scope.start,end:scope.end,key:key.id,mode:String(key.reportableType).includes('DIMENSION')?'CUSTOM_DIMENSION':'CUSTOM_CRITERIA',progress:m=>progress(network.name+': '+m)});
    revenues.push(...revenueFacts(report,network));reportIds.push({network:network.id,id:report.report_id});sources.push({kind:'gam',id:network.id,name:network.name,currency:network.currency,ok:true});
   }catch(e){partial=true;warnings.push('Receita de '+network.name+': '+(e instanceof AdsError?e.message:'Não foi possível processar o relatório.'));sources.push({kind:'gam',id:network.id,name:network.name,ok:false});}
  }
  if([...costs,...revenues].some(r=>r.currency==='USD')){try{progress('Consultando dólar diário no Banco Central…');quotes=await rates(scope.start,scope.end);}catch{warnings.push('Cotação BCB indisponível. Valores em dólares aguardam conversão.');}}
  const joined=reconcile(costs,revenues,quotes,rules,{partial});
  const result={...joined,warnings,sources,rates:quotes,report_ids:reportIds,currency:'BRL',revenue_metric:'AD_EXCHANGE_LINE_ITEM_LEVEL_REVENUE',revenue_label:'Receita estimada Ad Exchange',start:scope.start,end:scope.end,updated_at:new Date().toISOString(),cost_records:costs.length,revenue_records:revenues.length};
  db.prepare("UPDATE roi_runs SET status='done',result=?,progress='Concluído',finished=? WHERE id=?").run(JSON.stringify(result),new Date().toISOString(),run);
 }
 const api=async request=>{
  const url=new URL(request.url),path=url.pathname.slice('/apps/roi/api'.length),method=request.method;
  if(!['GET','HEAD'].includes(method)&&!sameOrigin(request))return authJSON({error:'Origem não permitida.'},403);
  try{
   if(method==='GET'){
    if(path==='/google-ads-link'){const account=url.searchParams.get('account'),campaign=url.searchParams.get('campaign');if(!/^\d{10}$/.test(account||'')||!/^\d{1,20}$/.test(campaign||''))throw new AdsError('Conta ou campanha inválida.',{status:400});const data=await catalog(),selected=data.accounts.find(a=>a.id===account);if(!selected)throw new AdsError('Esta conta não está disponível para o painel.',{status:403});const destination=await googleAdsLink(selected,campaign);return new Response(null,{status:303,headers:{Location:destination,'Cache-Control':'private, no-store','Vary':'Cookie'}});}
    if(path==='/catalog')return authJSON({...await catalog(url.searchParams.get('refresh')==='1'),settings:config(),links:links()});
    if(path==='/status'){const running=db.prepare("SELECT id,progress FROM roi_runs WHERE status='running' ORDER BY created DESC LIMIT 1").get(),latest=db.prepare("SELECT id FROM roi_runs WHERE status='done' ORDER BY created DESC LIMIT 1").get();return authJSON({running:running||null,latest:latest?.id||null,active_jobs:active?1:0});}
    if(path==='/run')return authJSON(getRun(url.searchParams.get('id')));
    if(path==='/history')return authJSON({runs:db.prepare('SELECT id,status,start,end,progress,error,created FROM roi_runs ORDER BY created DESC LIMIT 20').all()});
    return authJSON({error:'Não encontrado.'},404);
   }
   if(!['POST','DELETE'].includes(method))return authJSON({error:'Método não permitido.'},405);
   if(!request.headers.get('content-type')?.startsWith('application/json'))return authJSON({error:'Envie JSON.'},415);
   let body;try{body=await request.json();}catch{return authJSON({error:'JSON inválido.'},400);}if(!body||typeof body!=='object'||Array.isArray(body))throw new AdsError('Dados inválidos.',{status:400});
   if(path==='/links'&&method==='DELETE'){if(typeof body.id!=='string'||!/^[a-f0-9]{32}$/.test(body.id))throw new AdsError('Vínculo inválido.',{status:400});db.prepare('DELETE FROM roi_links WHERE id=?').run(body.id);return authJSON({links:links()});}
   if(path==='/links'&&method==='POST'){
    const data=await catalog();if(!data.networks.some(n=>n.id===body.network)||!data.accounts.some(a=>a.id===body.account)||!/^\d{1,20}$/.test(body.campaign||'')||typeof body.utm!=='string'||body.utm.length<1||body.utm.length>1000||typeof body.site!=='string'||site(body.site)!==body.site)throw new AdsError('Confira rede, domínio, UTM, conta e ID da campanha.',{status:400});
    const old=db.prepare('SELECT id FROM roi_links WHERE network=? AND site=? AND utm=?').get(body.network,body.site,body.utm);db.prepare('INSERT OR REPLACE INTO roi_links VALUES (?,?,?,?,?,?)').run(old?.id||id(),body.network,body.site,body.utm,body.account,body.campaign);return authJSON({links:links()});
   }
   if(path==='/sync'&&method==='POST'){
    if(active)throw new AdsError('Há uma sincronização em andamento.',{status:409});dateRange(body.start,body.end);if(body.end>today())throw new AdsError('A data final não pode estar no futuro.',{status:400});
    const data=await catalog();for(const [field,available]of [['accounts',data.accounts],['networks',data.networks]])if(!Array.isArray(body[field])||!body[field].length||body[field].length>120||new Set(body[field]).size!==body[field].length||body[field].some(v=>!available.some(a=>a.id===v)))throw new AdsError('Selecione contas e redes disponíveis.',{status:400});
    if(active)throw new AdsError('Há uma sincronização em andamento.',{status:409});
    const scope={start:body.start,end:body.end,accounts:body.accounts,networks:body.networks},rid=id(),rules=links();
    db.prepare('INSERT INTO roi_runs VALUES (?,?,?,?,?,?,?,?,?,?)').run(rid,'running',scope.start,scope.end,JSON.stringify({...scope,links:rules}),null,'Iniciando consultas…',null,new Date().toISOString(),null);
    db.prepare('INSERT OR REPLACE INTO roi_settings VALUES (1,?)').run(JSON.stringify({accounts:scope.accounts,networks:scope.networks}));active=true;
    Promise.resolve().then(()=>sync(rid,scope,data,rules)).catch(()=>db.prepare("UPDATE roi_runs SET status='error',error='Não foi possível concluir a sincronização. O relatório anterior foi preservado.' WHERE id=?").run(rid)).finally(()=>active=false);return authJSON({id:rid},202);
   }
   return authJSON({error:'Não encontrado.'},404);
  }catch(e){return authJSON({error:e instanceof AdsError?e.message:'Não foi possível concluir a consulta.'},e instanceof AdsError?e.status:502);}
 };api.activeJobs=()=>active?1:0;return api;
}
