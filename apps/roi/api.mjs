import {createBudgets} from './budgets.mjs';
import {createCampaignChanges,changeTypes} from './campaign-changes.mjs';
import {createGoogleAdsLinks} from './google-ads-links.mjs';
import {createROIWarehouse} from './warehouse.mjs';
import {createROIScheduler} from './scheduler.mjs';
import {randomBytes} from 'node:crypto';
import {authJSON,sameOrigin} from '../../lib/auth.mjs';
import {AdsError,createGoogleAdsClient} from '../google-ads/client.mjs';
import {discover} from '../google-ads/domain.mjs';
import {createAdManager,dateRange} from './admanager.mjs';
import {dollarRates,today} from './fx.mjs';
import {costFacts} from './ads.mjs';
import {revenueFacts,site} from './model.mjs';
const id=()=>randomBytes(16).toString('hex');
export function createROIAPI(storage,{env=process.env,google=createGoogleAdsClient({env}),admanager=createAdManager({env}),rates=dollarRates,loadCosts=costFacts,autoSync=env.ROI_AUTO_SYNC==='true'}={}){
 const db=storage.db;let active=false,catalogPending;
 db.exec(`CREATE TABLE IF NOT EXISTS roi_runs (id TEXT PRIMARY KEY,status TEXT NOT NULL,start TEXT NOT NULL,end TEXT NOT NULL,config TEXT NOT NULL,result TEXT,progress TEXT NOT NULL,error TEXT,created TEXT NOT NULL,finished TEXT);
 CREATE TABLE IF NOT EXISTS roi_links (id TEXT PRIMARY KEY,network TEXT NOT NULL,site TEXT NOT NULL,utm TEXT NOT NULL,account TEXT NOT NULL,campaign TEXT NOT NULL,UNIQUE(network,site,utm));
 CREATE TABLE IF NOT EXISTS roi_settings (id INTEGER PRIMARY KEY CHECK(id=1),data TEXT NOT NULL);`);
 db.prepare("UPDATE roi_runs SET status='error',error='Sincronização interrompida pelo reinício. Os dados e relatórios anteriores foram preservados.' WHERE status='running'").run();
 const warehouse=createROIWarehouse(db),googleAdsLink=createGoogleAdsLinks(db,google),campaignChanges=createCampaignChanges(db);
 const budgets=createBudgets(db,google,{accountFor:async account=>{if(typeof account!=='string'||!/^\d{10}$/.test(account))throw new AdsError('Conta inválida.',{status:400});const a=(await catalog()).accounts.find(a=>a.id===account);if(!a)throw new AdsError('Conta indisponível para este painel.',{status:403});return a;}});
 const links=()=>db.prepare('SELECT * FROM roi_links ORDER BY site,utm').all();
 const config=()=>{const r=db.prepare('SELECT data FROM roi_settings WHERE id=1').get();return r?JSON.parse(r.data):null;};
 function seedCatalog(){
  const saved=db.prepare("SELECT result FROM roi_runs WHERE status='done' AND result IS NOT NULL AND json_type(result,'$.rows')='array' ORDER BY created DESC LIMIT 1").get();if(!saved)return null;
  const report=JSON.parse(saved.result),accounts=new Map(),networks=new Map();
  for(const source of report.sources||[]){if(source.kind==='ads'){const row=report.rows.find(r=>r.account===source.id);accounts.set(source.id,{id:source.id,name:source.name,status:'ENABLED',currency:row?.cost_original?.[0]?.currency||'',mcc:''});}else networks.set(source.id,{id:source.id,name:source.name,currency:source.currency||'',timezone:''});}
  for(const account of config()?.accounts||[])if(!accounts.has(account))accounts.set(account,{id:account,name:account,status:'ENABLED',currency:'',mcc:''});
  return {accounts:[...accounts.values()],networks:[...networks.values()],warnings:[],seeded:true,updated_at:report.updated_at};
 }
 const seeded=!warehouse.meta('catalog')?seedCatalog():null;if(seeded)warehouse.putMeta('catalog',seeded);
 async function refreshCatalog(){
  if(catalogPending)return catalogPending;
  catalogPending=(async()=>{const [ads,networks]=await Promise.all([discover(google),admanager.networks()]);const prior=warehouse.meta('catalog'),selected=config();if(prior&&selected){for(const account of prior.accounts)if(selected.accounts.includes(account.id)&&!ads.accounts.some(a=>a.id===account.id))ads.accounts.push({...account,status:'UNAVAILABLE'});for(const network of prior.networks)if(selected.networks.includes(network.id)&&!networks.some(n=>n.id===network.id))networks.push(network);}
  const data={accounts:ads.accounts,networks,warnings:ads.warnings,updated_at:new Date().toISOString(),seeded:false};warehouse.putMeta('catalog',data);return data;})();try{return await catalogPending;}finally{catalogPending=null;}
 }
 async function catalog(){return warehouse.meta('catalog')||await refreshCatalog();}
 function defaults(data){return config()||{accounts:data.accounts.filter(a=>a.status==='ENABLED').map(a=>a.id),networks:data.networks.map(n=>n.id)};}
 function scopeFrom(body,data,{dates=true}={}){
  if(dates){dateRange(body.start,body.end);if(body.end>today())throw new AdsError('A data final não pode estar no futuro.',{status:400});}
  for(const [field,available]of [['accounts',data.accounts],['networks',data.networks]])if(!Array.isArray(body[field])||!body[field].length||body[field].length>120||new Set(body[field]).size!==body[field].length||body[field].some(v=>!available.some(a=>a.id===v)))throw new AdsError('Selecione contas e redes disponíveis.',{status:400});
  return {...(dates?{start:body.start,end:body.end}:{}),accounts:body.accounts,networks:body.networks};
 }
 function getRun(rid){if(!/^[a-f0-9]{32}$/.test(rid||''))throw new AdsError('Sincronização inválida.',{status:400});const r=db.prepare('SELECT * FROM roi_runs WHERE id=?').get(rid);if(!r)throw new AdsError('Relatório não encontrado.',{status:404});return {...r,config:JSON.parse(r.config),result:r.result?JSON.parse(r.result):null};}
 function databaseReport(scope){const result=warehouse.read(scope,links(),warehouse.meta('catalog')||{});result.warnings.push(...(warehouse.meta('collection_warnings')||[]));return {id:'database',database:true,status:'done',start:scope.start,end:scope.end,config:{...scope,links:links()},result};}
 function runningJob(){return db.prepare("SELECT id,progress FROM roi_runs WHERE status='running' ORDER BY created DESC LIMIT 1").get()||null;}
 function launch(scope,{mode='manual',plan=null}={}){
  if(active)throw new AdsError('Há uma atualização em andamento.',{status:409});active=true;
  const rid=id(),rules=links();db.prepare('INSERT INTO roi_runs VALUES (?,?,?,?,?,?,?,?,?,?)').run(rid,'running',scope.start,scope.end,JSON.stringify({...scope,links:rules,mode}),null,'Preparando atualização em segundo plano…',null,new Date().toISOString(),null);
  const promise=collect(rid,scope,rules,plan).catch(()=>{db.prepare("UPDATE roi_runs SET status='error',error='A coleta falhou. Os dados e relatórios anteriores foram preservados.',finished=? WHERE id=?").run(new Date().toISOString(),rid);return {complete:false};}).finally(()=>{active=false;});
  return {id:rid,promise};
 }
 async function collect(run,scope,rules,plan){
  const progress=message=>db.prepare('UPDATE roi_runs SET progress=? WHERE id=?').run(message,run);
  let data=warehouse.meta('catalog')||{accounts:[],networks:[],warnings:[]},catalogError='';try{progress('Atualizando catálogo de contas e redes…');data=await refreshCatalog();}catch{catalogError='O catálogo não pôde ser atualizado; foram mantidas as fontes já conhecidas.';}
  const tasks=plan||[...scope.accounts.map(source=>({kind:'ads',source,start:scope.start,end:scope.end})),...scope.networks.map(source=>({kind:'gam',source,start:scope.start,end:scope.end}))];
  const ads=tasks.filter(t=>t.kind==='ads'),gam=tasks.filter(t=>t.kind==='gam');let cursor=0,done=0;
  await Promise.all(Array.from({length:Math.min(3,ads.length)},async()=>{for(;;){const task=ads[cursor++];if(!task)break;const account=data.accounts.find(a=>a.id===task.source);try{if(!account)throw Error('Fonte indisponível');const facts=await loadCosts(google,account,task.start,task.end);warehouse.saveSource('ads',task.source,task.start,task.end,facts);}catch{warehouse.failSource('ads',task.source,task.start,task.end,'Não foi possível consultar a conta Google Ads.');}done++;progress(`Google Ads: ${done} de ${ads.length} coletas concluídas`);}}));
  const keysCache=new Map();for(const task of gam){const network=data.networks.find(n=>n.id===task.source);try{
   if(!network)throw new AdsError('Rede indisponível.');progress('Ad Manager: '+network.name);
   if(!keysCache.has(network.id))keysCache.set(network.id,await admanager.keys(network.id));const key=keysCache.get(network.id).find(k=>k.name==='utm_campaign');if(!key||key.reportableType==='OFF')throw new AdsError('utm_campaign não está habilitada nesta rede.');
   const report=await admanager.report(network.id,{start:task.start,end:task.end,key:key.id,mode:String(key.reportableType).includes('DIMENSION')?'CUSTOM_DIMENSION':'CUSTOM_CRITERIA',progress:m=>progress(network.name+': '+m)});warehouse.saveSource('gam',task.source,task.start,task.end,revenueFacts(report,network));
  }catch(e){warehouse.failSource('gam',task.source,task.start,task.end,e instanceof AdsError?e.message:'Não foi possível consultar a rede Ad Manager.');}}
  let fxError='';try{progress('Atualizando cotação diária…');warehouse.saveRates(await rates(scope.start,scope.end));}catch{fxError='Não foi possível atualizar o câmbio. As cotações válidas armazenadas foram preservadas.';}
  const result=warehouse.read(scope,rules,data);if(catalogError)result.warnings.push(catalogError);if(fxError)result.warnings.push(fxError);
  const manual=getRun(run).config.mode==='manual',stored=manual?result:{database:true,data_coverage:result.data_coverage,warnings:result.warnings,updated_at:result.updated_at,sources:result.sources};warehouse.putMeta('collection_warnings',[catalogError,fxError].filter(Boolean));
  db.prepare("UPDATE roi_runs SET status='done',result=?,progress='Concluído',finished=? WHERE id=?").run(JSON.stringify(stored),new Date().toISOString(),run);warehouse.putMeta('last_collection',{at:new Date().toISOString(),run,complete:result.data_coverage.complete,stale:result.data_coverage.stale_days>0});return {complete:result.data_coverage.complete&&!result.data_coverage.stale_days&&!fxError&&!catalogError};
 }
 const scheduler=createROIScheduler({enabled:autoSync,read:()=>warehouse.meta('auto_sync'),write:value=>warehouse.putMeta('auto_sync',value),isBusy:()=>active,day:today,run:async range=>{const data=await catalog(),selected=defaults(data);if(!selected.accounts.length||!selected.networks.length)throw Error('Configure as fontes');if(!config())db.prepare('INSERT OR REPLACE INTO roi_settings VALUES (1,?)').run(JSON.stringify(selected));const job=launch({start:range.start,end:range.end,...selected},{mode:range.deep?'automatic-deep':'automatic'});return await job.promise;}});
 const api=async request=>{
  const url=new URL(request.url),path=url.pathname.slice('/apps/roi/api'.length),method=request.method;
  if(!['GET','HEAD'].includes(method)&&!sameOrigin(request))return authJSON({error:'Origem não permitida.'},403);
  try{
   if(method==='GET'){
    if(path==='/google-ads-link'){const account=url.searchParams.get('account'),campaign=url.searchParams.get('campaign');if(!/^\d{10}$/.test(account||'')||!/^\d{1,20}$/.test(campaign||''))throw new AdsError('Conta ou campanha inválida.',{status:400});const data=await catalog(),selected=data.accounts.find(a=>a.id===account);if(!selected)throw new AdsError('Esta conta não está disponível para o painel.',{status:403});return new Response(null,{status:303,headers:{Location:await googleAdsLink(selected,campaign),'Cache-Control':'private, no-store','Vary':'Cookie'}});}
    if(path==='/campaign-changes'){const account=url.searchParams.get('account'),campaign=url.searchParams.get('campaign');campaignChanges.scope(account,campaign);if(!(await catalog()).accounts.some(a=>a.id===account))throw new AdsError('Conta indisponível para este painel.',{status:403});return authJSON({items:campaignChanges.list(account,campaign),types:changeTypes});}
    if(path==='/budget')return authJSON(await budgets.read(url.searchParams.get('account'),url.searchParams.get('campaign')));
    if(path==='/budget-operation')return authJSON(await budgets.status(url.searchParams.get('id')));
    if(path==='/catalog')return authJSON({...await catalog(),settings:config(),links:links(),database:true});
    if(path==='/status'){const latest=db.prepare("SELECT id FROM roi_runs WHERE status='done' ORDER BY created DESC LIMIT 1").get();return authJSON({running:runningJob(),latest:latest?.id||null,active_jobs:(active?1:0)+budgets.activeJobs(),automatic:scheduler.status(),revision:warehouse.revision(),last_collection:warehouse.meta('last_collection')});}
    if(path==='/report'){const data=await catalog(),selected=defaults(data),scope=scopeFrom({start:url.searchParams.get('start'),end:url.searchParams.get('end'),accounts:url.searchParams.has('accounts')?url.searchParams.get('accounts').split(','):selected.accounts,networks:url.searchParams.has('networks')?url.searchParams.get('networks').split(','):selected.networks},data);return authJSON(databaseReport(scope));}
    if(path==='/run')return authJSON(getRun(url.searchParams.get('id')));
    if(path==='/history')return authJSON({runs:db.prepare("SELECT id,status,start,end,progress,error,created FROM roi_runs WHERE json_extract(config,'$.mode') IS NULL OR json_extract(config,'$.mode')='manual' ORDER BY created DESC LIMIT 20").all()});
    return authJSON({error:'Não encontrado.'},404);
   }
   if(!['POST','DELETE'].includes(method))return authJSON({error:'Método não permitido.'},405);
   if(!request.headers.get('content-type')?.startsWith('application/json'))return authJSON({error:'Envie JSON.'},415);
   let body;try{body=await request.json();}catch{throw new AdsError('JSON inválido.',{status:400});}if(!body||typeof body!=='object'||Array.isArray(body))throw new AdsError('Dados inválidos.',{status:400});
   if(path==='/budget-preview'&&method==='POST')return authJSON(await budgets.preview(body));
   if(path==='/budget-apply'&&method==='POST')return authJSON(await budgets.apply(body));
   if(path==='/campaign-changes'){campaignChanges.scope(body.account,body.campaign);if(!(await catalog()).accounts.some(a=>a.id===body.account))throw new AdsError('Conta indisponível para este painel.',{status:403});return authJSON(method==='DELETE'?campaignChanges.remove(body):campaignChanges.save(body));}
   if(path==='/settings'&&method==='POST'){const selected=scopeFrom(body,await catalog(),{dates:false});db.prepare('INSERT OR REPLACE INTO roi_settings VALUES (1,?)').run(JSON.stringify(selected));return authJSON({settings:selected});}
   if(path==='/links'&&method==='DELETE'){if(typeof body.id!=='string'||!/^[a-f0-9]{32}$/.test(body.id))throw new AdsError('Vínculo inválido.',{status:400});db.prepare('DELETE FROM roi_links WHERE id=?').run(body.id);warehouse.touch();return authJSON({links:links()});}
   if(path==='/links'&&method==='POST'){
    const data=await catalog();if(!data.networks.some(n=>n.id===body.network)||!data.accounts.some(a=>a.id===body.account)||!/^\d{1,20}$/.test(body.campaign||'')||typeof body.utm!=='string'||body.utm.length<1||body.utm.length>1000||typeof body.site!=='string'||site(body.site)!==body.site)throw new AdsError('Confira rede, domínio, UTM, conta e ID da campanha.',{status:400});
    const old=db.prepare('SELECT id FROM roi_links WHERE network=? AND site=? AND utm=?').get(body.network,body.site,body.utm);db.prepare('INSERT OR REPLACE INTO roi_links VALUES (?,?,?,?,?,?)').run(old?.id||id(),body.network,body.site,body.utm,body.account,body.campaign);warehouse.touch();return authJSON({links:links()});
   }
   if((path==='/sync'||path==='/ensure')&&method==='POST'){
    const scope=scopeFrom(body,await catalog());if(active){if(path==='/ensure')return authJSON({id:runningJob()?.id||null},202);throw new AdsError('Há uma atualização em andamento.',{status:409});}
    const plan=path==='/ensure'?warehouse.missingRanges(scope):null;if(plan&&!plan.length)return authJSON({id:null});
    if(path==='/sync')db.prepare('INSERT OR REPLACE INTO roi_settings VALUES (1,?)').run(JSON.stringify({accounts:scope.accounts,networks:scope.networks}));const job=launch(scope,{mode:path==='/ensure'?'on-demand':'manual',plan});return authJSON({id:job.id},202);
   }
   return authJSON({error:'Não encontrado.'},404);
  }catch(e){return authJSON({error:e instanceof AdsError?e.message:'Não foi possível concluir a consulta.'},e instanceof AdsError?e.status:502);}
 };
 api.activeJobs=()=>(active?1:0)+budgets.activeJobs();api.startAuto=()=>scheduler.start();api.stopAuto=()=>scheduler.stop();api.automaticTick=()=>scheduler.tick();return api;
}
