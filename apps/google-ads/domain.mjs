import {AdsError,customerId} from './client.mjs';

export const countries={BR:'Brasil',US:'Estados Unidos',PT:'Portugal',ES:'Espanha',AR:'Argentina',MX:'México'};
export const languages={pt:'Português',en:'Inglês',es:'Espanhol'};
export function text(value,max,label,min=1){
 if(typeof value!=='string'||value.trim().length<min||[...value.trim()].reduce((s,c)=>s+(/[\u3000-\u9fff\uff01-\uff60]/u.test(c)?2:1),0)>max||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value))throw new AdsError(`${label}: use entre ${min} e ${max} caracteres.`,{status:400});return value.trim();
}
export function publicURL(value){
 let u;try{u=new URL(text(value,2048,'URL'));}catch{throw new AdsError('Informe uma URL pública válida.',{status:400});}
 if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.hash||u.port||u.hostname==='localhost'||u.hostname.endsWith('.local')||u.hostname.endsWith('.internal'))throw new AdsError('Use uma URL pública HTTP/HTTPS sem credenciais ou portas alternativas.',{status:400});return u;
}
export function validate(input,complete=false){
 const p={...input};customerId(p.account_id);
 if(!['SEARCH','DISPLAY'].includes(p.type))throw new AdsError('Este criador aceita Pesquisa e Display. Os demais formatos ainda não estão implementados.',{status:400});
 for(const [k,max,label]of [['theme',2000,'Tema'],['name',160,'Nome'],['business_name',25,'Nome comercial']])p[k]=text(p[k],max,label);
 p.url=publicURL(p.url).href;
 if(!Object.hasOwn(countries,p.country)||!Object.hasOwn(languages,p.language))throw new AdsError('País ou idioma inválido.',{status:400});
 for(const k of ['budget','cpc_bid']){p[k]=Number(p[k]);if(!Number.isFinite(p[k])||p[k]<=0||p[k]>1000000||Math.round(p[k]*1e6)<1)throw new AdsError('Orçamento e CPC devem ser positivos e até 1.000.000 na moeda da conta.',{status:400});}
 p.context=text(p.context||'',14000,'Contexto',0);p.political=p.political===true;
 for(const [k,min,max,limit]of [['headlines',p.type==='SEARCH'?3:1,p.type==='SEARCH'?15:5,30],['descriptions',p.type==='SEARCH'?2:1,p.type==='SEARCH'?4:5,90]]){
  if(!Array.isArray(p[k])||p[k].length>max||(complete&&p[k].length<min))throw new AdsError(`${k}: use de ${min} a ${max} textos.`,{status:400});
  p[k]=p[k].map(v=>text(v,limit,k));if(new Set(p[k]).size!==p[k].length)throw new AdsError('Remova textos duplicados.',{status:400});
 }
 for(const k of ['keywords','negatives']){if(!Array.isArray(p[k])||p[k].length>50)throw new AdsError('Lista de palavras-chave inválida.',{status:400});p[k]=[...new Set(p[k].map(v=>text(v,80,'Palavra-chave')))];}
 if(complete&&p.type==='SEARCH'&&!p.keywords.length)throw new AdsError('Adicione pelo menos uma palavra-chave de frase.',{status:400});
 p.long_headline=text(p.long_headline||'',90,'Título longo',complete&&p.type==='DISPLAY'?1:0);p.image_prompt=text(p.image_prompt||'',4000,'Descrição visual',0);
 if(!Array.isArray(p.policy_notes||[])||(p.policy_notes||[]).length>10)throw new AdsError('Observações inválidas.',{status:400});p.policy_notes=(p.policy_notes||[]).map(v=>text(v,2000,'Observação'));
 return p;
}
export function rates(cost,conversions,interactions,clicks){return {cost,conversions,interactions,clicks,conversion_rate:interactions?conversions/interactions:null,cost_per_conversion:conversions?cost/conversions:null,cpc:clicks?cost/clicks:null};}
export async function discover(google){
 const direct=await google.accessible(),found=new Map(),managers=[],warnings=[];
 for(const resource of direct.resourceNames||[]){const id=resource.split('/').pop();try{
  for(const row of await google.search(id,'SELECT customer.id, customer.descriptive_name, customer.manager, customer.status, customer.currency_code, customer.time_zone FROM customer')){
   const c=row.customer,item={id:String(c.id),name:c.descriptiveName||String(c.id),manager:Boolean(c.manager),status:c.status,currency:c.currencyCode,timezone:c.timeZone,mcc:'',mcc_name:'Acesso direto'};
   if(c.manager)managers.push(item);else found.set(item.id,item);
  }
 }catch{warnings.push(`Não foi possível consultar o acesso direto ${id}.`);}}
 for(const m of managers){try{for(const row of await google.search(m.id,'SELECT customer_client.id, customer_client.descriptive_name, customer_client.manager, customer_client.status, customer_client.currency_code, customer_client.time_zone FROM customer_client',m.id)){
  const c=row.customerClient;if(c.manager||found.has(String(c.id)))continue;
  found.set(String(c.id),{id:String(c.id),name:c.descriptiveName||'Sem nome',manager:false,status:c.status,currency:c.currencyCode,timezone:c.timeZone,mcc:m.id,mcc_name:m.name});
 }}catch{warnings.push(`Não foi possível listar ${m.name}.`);}}
 return {accounts:[...found.values()].sort((a,b)=>(a.status!=='ENABLED')-(b.status!=='ENABLED')||a.name.localeCompare(b.name,'pt-BR')),managers,warnings,updated_at:new Date().toISOString()};
}
export async function campaignReport(google,account,start,end){
 for(const d of [start,end])if(!/^\d{4}-\d{2}-\d{2}$/.test(d)||Number.isNaN(Date.parse(d))||new Date(d).toISOString().slice(0,10)!==d)throw new AdsError('Datas inválidas.',{status:400});
 if(start>end||(Date.parse(end)-Date.parse(start))/86400000>366)throw new AdsError('Selecione um período de até 367 dias.',{status:400});
 const rows=new Map();
 for(const row of await google.search(account.id,"SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign_budget.id, campaign_budget.amount_micros, campaign_budget.total_amount_micros, campaign_budget.period, campaign_budget.explicitly_shared FROM campaign WHERE campaign.status != 'REMOVED'",account.mcc)){
  const c=row.campaign,b=row.campaignBudget;rows.set(String(c.id),{id:String(c.id),name:c.name,status:c.status,channel:c.advertisingChannelType,budget_id:String(b.id),budget:Number(b.period==='CUSTOM_PERIOD'?b.totalAmountMicros||0:b.amountMicros||0)/1e6,budget_period:b.period,shared_budget:Boolean(b.explicitlyShared),...rates(0,0,0,0)});
 }
 for(const row of await google.search(account.id,`SELECT campaign.id, metrics.cost_micros, metrics.conversions, metrics.interactions, metrics.clicks, metrics.conversions_from_interactions_rate, metrics.cost_per_conversion, metrics.average_cpc FROM campaign WHERE campaign.status != 'REMOVED' AND segments.date BETWEEN '${start}' AND '${end}'`,account.mcc)){
  const item=rows.get(String(row.campaign.id));if(!item)continue;const m=row.metrics,cost=Number(m.costMicros||0)/1e6,conversions=Number(m.conversions||0),interactions=Number(m.interactions||0),clicks=Number(m.clicks||0);
  Object.assign(item,rates(cost,conversions,interactions,clicks),{conversion_rate:interactions?Number(m.conversionsFromInteractionsRate||0):null,cost_per_conversion:conversions?Number(m.costPerConversion||0)/1e6:null,cpc:clicks?Number(m.averageCpc||0)/1e6:null});
 }
 return {account,start,end,rows:[...rows.values()].sort((a,b)=>b.cost-a.cost||a.name.localeCompare(b.name)),updated_at:new Date().toISOString()};
}
export function operations(draft,geo,language,images=[]){
 const p=validate(draft.payload,true),cid=p.account_id,result=[],add=(kind,value)=>result.push({[kind+'Operation']:{create:value}});
 const budget=`customers/${cid}/campaignBudgets/-1`,campaign=`customers/${cid}/campaigns/-2`,group=`customers/${cid}/adGroups/-3`;
 add('campaignBudget',{resourceName:budget,name:p.name+' | Orçamento',amountMicros:String(Math.round(p.budget*1e6)),deliveryMethod:'STANDARD',explicitlyShared:false});
 add('campaign',{resourceName:campaign,name:p.name,status:'PAUSED',advertisingChannelType:p.type,campaignBudget:budget,manualCpc:{},containsEuPoliticalAdvertising:p.political?'CONTAINS_EU_POLITICAL_ADVERTISING':'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING',geoTargetTypeSetting:{positiveGeoTargetType:'PRESENCE'},networkSettings:{targetGoogleSearch:p.type==='SEARCH',targetSearchNetwork:false,targetPartnerSearchNetwork:false,targetContentNetwork:p.type==='DISPLAY'}});
 add('campaignCriterion',{campaign,location:{geoTargetConstant:geo}});add('campaignCriterion',{campaign,language:{languageConstant:language}});
 add('adGroup',{resourceName:group,name:'Grupo principal',campaign,status:'ENABLED',cpcBidMicros:String(Math.round(p.cpc_bid*1e6)),type:p.type==='SEARCH'?'SEARCH_STANDARD':'DISPLAY_STANDARD',...(p.type==='DISPLAY'?{optimizedTargetingEnabled:false}:{})});
 if(p.type==='SEARCH')for(const [negative,words]of [[false,p.keywords],[true,p.negatives]])for(const word of words)add(negative?'campaignCriterion':'adGroupCriterion',{...(negative?{campaign,negative:true}:{adGroup:group,status:'ENABLED'}),keyword:{text:word,matchType:'PHRASE'}});
 const ad={finalUrls:[p.url]},texts={headlines:p.headlines.map(text=>({text})),descriptions:p.descriptions.map(text=>({text}))};
 if(p.type==='SEARCH')ad.responsiveSearchAd=texts;
 else{
  if(images.length!==2||!images.some(i=>i.role==='landscape')||!images.some(i=>i.role==='square'))throw new AdsError('Prepare os formatos quadrado e paisagem antes de validar.',{status:400});
  const assets={};images.forEach((image,i)=>{const resourceName=`customers/${cid}/assets/${-10-i}`;add('asset',{resourceName,name:p.name+' '+image.role,type:'IMAGE',imageAsset:{data:Buffer.from(image.bytes).toString('base64')}});assets[image.role]=resourceName;});
  ad.responsiveDisplayAd={...texts,businessName:p.business_name,longHeadline:{text:p.long_headline},marketingImages:[{asset:assets.landscape}],squareMarketingImages:[{asset:assets.square}]};
 }
 add('adGroupAd',{adGroup:group,status:'ENABLED',ad});return result;
}
