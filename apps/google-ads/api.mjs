import {randomBytes,createHash} from 'node:crypto';
import {authJSON,sameOrigin} from '../../lib/auth.mjs';
import {generateCopy} from '../../lib/copy-generation.mjs';
import {generateOne} from '../../lib/generation.mjs';
import {textModels} from '../criativos/public/copy-core.js';
import {providers} from '../criativos/public/core.js';
import {AdsError,createGoogleAdsClient} from './client.mjs';
import {briefingPrompt,mergeGeneratedBrief} from './briefing.mjs';
import {validate,discover,campaignReport,operations,text,publicURL} from './domain.mjs';
import {readPublicPage} from './page-reader.mjs';

const stamp=()=>new Date().toISOString(),id=()=>randomBytes(16).toString('hex');
export function createGoogleAdsAPI(storage,{env=process.env,google=createGoogleAdsClient({env}),generateText=generateCopy,generateImage=generateOne,pageReader=readPublicPage}={}){
 const db=storage.db;let active=0;const cache=new Map(),pending=new Map();
 db.exec(`CREATE TABLE IF NOT EXISTS google_ads_drafts (id TEXT PRIMARY KEY,revision INTEGER NOT NULL,status TEXT NOT NULL,payload TEXT NOT NULL,result TEXT,updated TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS google_ads_assets (id TEXT PRIMARY KEY,draft_id TEXT NOT NULL,role TEXT NOT NULL,mime TEXT NOT NULL,width INTEGER NOT NULL,height INTEGER NOT NULL,bytes BLOB NOT NULL,sha TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS google_ads_jobs (id TEXT PRIMARY KEY,status TEXT NOT NULL,data TEXT NOT NULL,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS google_ads_settings (id INTEGER PRIMARY KEY CHECK(id=1),data TEXT NOT NULL);`);
 db.prepare("UPDATE google_ads_jobs SET status='error',data=? WHERE status='running'").run(JSON.stringify({status:'error',error:'Servidor reiniciado durante a geração. Confira o consumo antes de repetir.'}));
 const settings=()=>{const r=db.prepare('SELECT data FROM google_ads_settings WHERE id=1').get();return r?JSON.parse(r.data):{};};
 async function configuration(){
  const keys=await storage.keys(),saved=settings(),global=await storage.settings(),copies=await storage.store('copy-config').get('settings',{type:'json'});
  const provider=saved.provider||(Object.keys(providers).find(p=>keys[p])||'openai');
  return {configured:Boolean(keys[provider]),configuredKeys:Object.fromEntries(Object.keys(providers).map(p=>[p,Boolean(keys[p])])),provider,
   text_model:saved.text_model||copies?.models?.[provider]||textModels[provider],image_model:saved.image_model||global.models?.[provider]||providers[provider].model,
   google_configured:google.configured(),csrf:'shared-session-origin'};
 }
 async function remember(key,ttl,loader,refresh=false){
  if(pending.has(key))return pending.get(key);
  const saved=cache.get(key);if(!refresh&&saved&&Date.now()-saved.at<ttl)return saved.value;
  const work=Promise.resolve().then(loader).then(value=>{cache.set(key,{at:Date.now(),value});return value;}).finally(()=>pending.delete(key));pending.set(key,work);return work;
 }
 const accountList=(refresh=false)=>remember('accounts',600000,()=>discover(google),refresh);
 async function account(cid){const data=await accountList();const item=data.accounts.find(a=>a.id===cid);if(!item)throw new AdsError('Conta fora dos acessos disponíveis.',{status:403});return item;}
 function draft(did){
  if(!/^[a-f0-9]{32}$/.test(did||''))throw new AdsError('Rascunho inválido.',{status:400});
  const row=db.prepare('SELECT * FROM google_ads_drafts WHERE id=?').get(did);if(!row)throw new AdsError('Rascunho não encontrado.',{status:404});
  return {id:row.id,revision:row.revision,status:row.status,payload:JSON.parse(row.payload),result:row.result?JSON.parse(row.result):null,updated_at:row.updated};
 }
 function save(d,p,status='DRAFT',result=null){
  const updated=db.prepare("UPDATE google_ads_drafts SET revision=revision+1,status=?,payload=?,result=?,updated=? WHERE id=? AND revision=? AND status NOT IN ('CREATED','PUBLISHING','UNKNOWN')").run(status,JSON.stringify(p),result?JSON.stringify(result):null,stamp(),d.id,d.revision);
  if(!updated.changes)throw new AdsError('Este rascunho mudou. Reabra a versão atual.',{status:409});return draft(d.id);
 }
 function imageRows(did){return db.prepare('SELECT * FROM google_ads_assets WHERE draft_id=?').all(did);}
 function imageMeta(rows){return rows.map(i=>({name:i.id+'.jpg',role:i.role,width:i.width,height:i.height,sha256:i.sha}));}
 async function prepareImages(d,raw){
  if(raw.length>15000000)throw new AdsError('Use uma imagem de até 15 MB.',{status:400});
  const {default:sharp}=await import('sharp');let rows=[];
  try{
   const meta=await sharp(raw,{limitInputPixels:30000000}).metadata();if(meta.width<600||meta.height<314)throw new Error('small');
   for(const [role,width,height]of [['landscape',1200,628],['square',1200,1200]]){
    const bytes=await sharp(raw,{limitInputPixels:30000000}).rotate().flatten({background:'#fff'}).resize(width,height,{fit:'cover'}).jpeg({quality:90}).toBuffer();
    rows.push({id:id()+'-'+role,draft_id:d.id,role,mime:'image/jpeg',width,height,bytes,sha:createHash('sha256').update(bytes).digest('hex')});
   }
  }catch{throw new AdsError('Imagem inválida. Use JPG, PNG ou WebP de pelo menos 600 × 314 pixels.',{status:400});}
  db.exec('BEGIN IMMEDIATE');try{
   const current=draft(d.id);if(current.revision!==d.revision)throw new AdsError('O rascunho mudou durante a geração.',{status:409});
   db.prepare('DELETE FROM google_ads_assets WHERE draft_id=?').run(d.id);
   for(const r of rows)db.prepare('INSERT INTO google_ads_assets VALUES (?,?,?,?,?,?,?,?)').run(r.id,r.draft_id,r.role,r.mime,r.width,r.height,r.bytes,r.sha);
   const result=save(d,{...d.payload,images:imageMeta(rows)});db.exec('COMMIT');return result;
  }catch(e){db.exec('ROLLBACK');throw e;}
 }
 function job(task){
  if(active>=2)throw new AdsError('Já há duas gerações em andamento. Aguarde.',{status:429});
  const jid=id();db.prepare('INSERT INTO google_ads_jobs VALUES (?,?,?,?)').run(jid,'running',JSON.stringify({status:'running'}),Date.now());active++;
  Promise.resolve().then(task).then(result=>db.prepare('UPDATE google_ads_jobs SET status=?,data=? WHERE id=?').run('done',JSON.stringify({status:'done',result}),jid)).catch(e=>db.prepare('UPDATE google_ads_jobs SET status=?,data=? WHERE id=?').run('error',JSON.stringify({status:'error',error:e instanceof AdsError?e.message:'A geração não foi concluída. Confira a conexão e as configurações antes de repetir.'}),jid)).finally(()=>active--);
  return authJSON({job_id:jid},202);
 }
 async function context(d,a){
  if(a.id!==d.payload.account_id||a.status!=='ENABLED')throw new AdsError('Escolha uma conta habilitada.',{status:400});
  const current=await google.search(a.id,'SELECT customer.id, customer.status FROM customer',a.mcc);if(current[0]?.customer.status!=='ENABLED')throw new AdsError('A conta não está habilitada.',{status:400});
  const p=validate(d.payload,true),geos=await google.search(a.id,`SELECT geo_target_constant.resource_name FROM geo_target_constant WHERE geo_target_constant.country_code = '${p.country}' AND geo_target_constant.target_type = 'Country' AND geo_target_constant.status = 'ENABLED'`,a.mcc),langs=await google.search(a.id,`SELECT language_constant.resource_name FROM language_constant WHERE language_constant.code = '${p.language}'`,a.mcc);
  if(geos.length!==1||langs.length!==1)throw new AdsError('País ou idioma não localizado.',{status:400});
  const images=imageRows(d.id);if(p.type==='DISPLAY'&&JSON.stringify(imageMeta(images))!==JSON.stringify(p.images))throw new AdsError('Confira os recursos de imagem do rascunho.',{status:400});
  return operations(d,geos[0].geoTargetConstant.resourceName,langs[0].languageConstant.resourceName,images);
 }
 const api=async request=>{
  const u=new URL(request.url),path=u.pathname.replace(/^\/apps\/google-ads/,''),method=request.method;
  if(!['GET','HEAD'].includes(method)&&!sameOrigin(request))return authJSON({error:'Origem não permitida.'},403);
  try{
   if(method==='GET'){
    if(path==='/api/creator/status')return authJSON(await configuration());
    if(path==='/api/accounts')return authJSON(await accountList(u.searchParams.get('refresh')==='1'));
    if(path==='/api/campaigns'){
     const a=await account(u.searchParams.get('account')),start=u.searchParams.get('start')||'',end=u.searchParams.get('end')||'';
     return authJSON(await remember(`campaigns:${a.id}:${start}:${end}`,300000,()=>campaignReport(google,a,start,end),u.searchParams.get('refresh')==='1'));
    }
    if(path==='/api/drafts')return authJSON({drafts:db.prepare('SELECT * FROM google_ads_drafts ORDER BY updated DESC LIMIT 40').all().map(r=>({id:r.id,revision:r.revision,status:r.status,name:JSON.parse(r.payload).name||'Rascunho sem nome',account_id:JSON.parse(r.payload).account_id,updated_at:r.updated}))});
    if(path==='/api/draft')return authJSON(draft(u.searchParams.get('id')));
    if(path==='/api/job'){const row=db.prepare('SELECT data FROM google_ads_jobs WHERE id=?').get(u.searchParams.get('id'));if(!row)throw new AdsError('Geração não encontrada.',{status:404});return authJSON(JSON.parse(row.data));}
    if(path==='/api/image'){
     const d=draft(u.searchParams.get('draft')),name=u.searchParams.get('name')||'';
     if(!/^[a-f0-9]{32}-(square|landscape)\.jpg$/.test(name)||!d.payload.images?.some(i=>i.name===name))throw new AdsError('Imagem não encontrada.',{status:404});
     const image=db.prepare('SELECT mime,bytes FROM google_ads_assets WHERE draft_id=? AND id=?').get(d.id,name.slice(0,-4));if(!image)throw new AdsError('Imagem não encontrada.',{status:404});
     return new Response(image.bytes,{headers:{'Content-Type':image.mime,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
    }
    if(path==='/api/health')return authJSON({active_jobs:active,google_configured:google.configured()});
    return authJSON({error:'Não encontrado.'},404);
   }
   if(method!=='POST')return authJSON({error:'Método não permitido.'},405);
   if(!request.headers.get('content-type')?.startsWith('application/json'))return authJSON({error:'Envie JSON.'},415);
   let body;try{body=await request.json();}catch{return authJSON({error:'JSON inválido.'},400);}
   if(!body||typeof body!=='object'||Array.isArray(body))throw new AdsError('Dados inválidos.',{status:400});
   if(path==='/api/creator/configure'){
    if(!Object.hasOwn(providers,body.provider)||['text_model','image_model'].some(k=>typeof body[k]!=='string'||!/^[a-zA-Z0-9._-]{1,100}$/.test(body[k])))throw new AdsError('Provedor ou modelo inválido.',{status:400});
    if(body.key){if(typeof body.key!=='string'||body.key.length<10||body.key.length>1024||/[\r\n]/.test(body.key))throw new AdsError('Chave inválida.',{status:400});const keys=await storage.keys();keys[body.provider]=body.key;await storage.saveKeys(keys);}
    db.prepare('INSERT OR REPLACE INTO google_ads_settings VALUES (1,?)').run(JSON.stringify({provider:body.provider,text_model:body.text_model,image_model:body.image_model}));return authJSON(await configuration());
   }
   if(path==='/api/drafts/new'){
    const p=validate(body.payload),a=p.account_id?await account(p.account_id):null;if(a&&a.status!=='ENABLED')throw new AdsError('Escolha uma conta habilitada.',{status:400});
    const did=id();for(const k of ['images','generation'])delete p[k];p.currency=a?.currency||'';if(p.name)p.name=p.name.slice(0,145)+' · '+did.slice(0,8);
    db.prepare('INSERT INTO google_ads_drafts VALUES (?,?,?,?,?,?)').run(did,1,'DRAFT',JSON.stringify(p),null,stamp());return authJSON(draft(did),201);
   }
   const d=draft(body.id);if(!Number.isInteger(body.revision)||body.revision!==d.revision)throw new AdsError('O rascunho mudou. Reabra a versão atual.',{status:409});
   if(d.status==='CREATED'&&path==='/api/drafts/publish')return authJSON(d);
   if(['CREATED','PUBLISHING','UNKNOWN'].includes(d.status))throw new AdsError('O envio deve ser conferido no Google Ads antes de qualquer nova tentativa.',{status:409});
   if(['/api/drafts/save','/api/drafts/generate'].includes(path)){
    const p=validate(body.payload);if(d.payload.account_id&&p.account_id!==d.payload.account_id)throw new AdsError('A conta do rascunho não pode ser trocada.',{status:400});
    const selected=p.account_id?await account(p.account_id):null;if(selected&&selected.status!=='ENABLED')throw new AdsError('Escolha uma conta habilitada.',{status:400});p.currency=selected?.currency||'';
    for(const k of ['images','generation']){delete p[k];if(d.payload[k]!==undefined)p[k]=d.payload[k];}
    if(path.endsWith('/save'))return authJSON(save(d,p));
    const config=await configuration(),keys=await storage.keys();if(!keys[config.provider])throw new AdsError('Cadastre uma chave de IA em Configurações do estúdio.',{status:400});
    return job(async()=>{
     if(!p.context&&!p.theme&&!p.url)throw new AdsError('Escreva as instruções no prompt ou informe um tema/URL para gerar.',{status:400});
     const source={...p};if(!source.url){const match=source.context.match(/https?:\/\/[^\s<>"']+/i);if(match)try{source.url=publicURL(match[0].replace(/[),.;]+$/,'')).href;}catch{}}
     let page={url:source.url,text:''},pageRead=false,pageWarning='';
     if(body.read_page&&source.url)try{page=await pageReader(source.url);pageRead=true;}catch{pageWarning='Não foi possível ler a página. Confira o conteúdo do destino antes de criar.';}
     const output=await generateText({provider:config.provider,model:config.text_model,apiKey:keys[config.provider],prompt:briefingPrompt(source,page)});
     if(output.warning)throw new AdsError('A IA devolveu saída incompleta. Reduza o briefing.',{status:400});
     let generated;try{generated=JSON.parse(output.text.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));}catch{throw new AdsError('A IA não retornou um JSON completo. Ajuste o briefing.',{status:400});}
     if(!generated||typeof generated!=='object'||Array.isArray(generated))throw new AdsError('Resposta de IA inválida.',{status:400});
     const result=mergeGeneratedBrief(source,generated);
     if(!result.account_id&&(generated.account_id||generated.account_name)){
      const available=(await accountList()).accounts.filter(a=>a.status==='ENABLED'),candidate=String(generated.account_id||'').replace(/-/g,'').trim(),normalize=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
      const matches=candidate?available.filter(a=>a.id===candidate):available.filter(a=>normalize(a.name)===normalize(generated.account_name));
      if(matches.length===1){result.account_id=matches[0].id;result.currency=matches[0].currency;}else result.policy_notes=[...(result.policy_notes||[]),'Conta não identificada de forma única. Informe o ID ou escolha a conta na revisão.'].slice(0,10);
     }
     if(pageWarning)result.policy_notes=[pageWarning,...result.policy_notes].slice(0,10);
     result.generation={provider:config.provider,model:config.text_model,at:stamp(),page_read:pageRead};return save(d,validate(result));
    });
   }
   if(path==='/api/drafts/image'){
    if(d.payload.type!=='DISPLAY')throw new AdsError('Use um rascunho Display.',{status:400});
    const prompt=text(d.payload.image_prompt,4000,'Descrição visual'),config=await configuration(),keys=await storage.keys();if(!keys[config.provider])throw new AdsError('Cadastre uma chave de IA no estúdio.',{status:400});
    return job(async()=>{const image=await generateImage({provider:config.provider,model:config.image_model,apiKey:keys[config.provider],prompt,width:1200,height:628});return prepareImages(d,Buffer.from(image.base64,'base64'));});
   }
   if(path==='/api/drafts/upload'){
    if(d.payload.type!=='DISPLAY'||typeof body.image!=='string'||body.image.length>21000000||!/^[A-Za-z0-9+/]*={0,2}$/.test(body.image))throw new AdsError('Imagem inválida.',{status:400});return authJSON(await prepareImages(d,Buffer.from(body.image,'base64')));
   }
   if(['/api/drafts/validate','/api/drafts/publish'].includes(path)){
    if(path.endsWith('/publish')&&d.status!=='VALIDATED')throw new AdsError('Valide a versão atual antes de criar.',{status:409});
    if(!d.payload.account_id)throw new AdsError('Defina a conta de destino no prompt ou na revisão antes de criar.',{status:400});
    const a=await account(d.payload.account_id),ops=await context(d,a);
    if(path.endsWith('/validate')){await google.mutate(a.id,ops,{mcc:a.mcc,validateOnly:true});return authJSON(save(d,d.payload,'VALIDATED'));}
    const claim=db.prepare("UPDATE google_ads_drafts SET status='PUBLISHING',updated=? WHERE id=? AND revision=? AND status='VALIDATED'").run(stamp(),d.id,d.revision);if(!claim.changes)throw new AdsError('Envio já iniciado ou versão alterada.',{status:409});
    let response;try{response=await google.mutate(a.id,ops,{mcc:a.mcc,validateOnly:false});}catch(e){db.prepare('UPDATE google_ads_drafts SET status=?,updated=? WHERE id=?').run(e instanceof AdsError&&e.definite?'DRAFT':'UNKNOWN',stamp(),d.id);throw e;}
    const resource=response.mutateOperationResponses?.find(r=>r.campaignResult)?.campaignResult?.resourceName;
    const result={campaign_resource:resource||'',campaign_status:'PAUSED',created_at:stamp()};db.prepare("UPDATE google_ads_drafts SET status='CREATED',result=?,updated=? WHERE id=?").run(JSON.stringify(result),stamp(),d.id);
    for(const key of cache.keys())if(key.startsWith('campaigns:'+a.id+':'))cache.delete(key);return authJSON(draft(d.id));
   }
   return authJSON({error:'Não encontrado.'},404);
  }catch(e){return authJSON({error:e instanceof AdsError?e.message:'Não foi possível concluir a operação. Confira o estado antes de repetir.',...(e instanceof AdsError?{details:e.details,request_id:e.requestId}:{})},e instanceof AdsError?e.status:502);}
 };
 api.activeJobs=()=>active;return api;
}
