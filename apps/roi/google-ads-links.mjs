import {AdsError} from '../google-ads/client.mjs';

export function ocidFromGoogleURL(value){
 try{const u=new URL(value),ocid=u.searchParams.get('ocid');
  return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&['ads.google.com','adwords.google.com'].includes(u.hostname)&&/^\d{1,20}$/.test(ocid||'')?ocid:null;
 }catch{return null;}
}
export function createGoogleAdsLinks(db,google){
 db.exec('CREATE TABLE IF NOT EXISTS roi_google_ads_accounts (account TEXT PRIMARY KEY,ocid TEXT NOT NULL,updated TEXT NOT NULL)');
 const pending=new Map();
 async function identify(account){
  const cached=db.prepare('SELECT ocid,updated FROM roi_google_ads_accounts WHERE account=?').get(account.id);
  if(cached&&/^\d{1,20}$/.test(cached.ocid)&&Date.now()-Date.parse(cached.updated)<30*86400000)return cached.ocid;
  if(pending.has(account.id))return pending.get(account.id);
  const task=(async()=>{
   const rows=await google.search(account.id,'SELECT customer.id, metrics.optimization_score_url FROM customer',account.mcc);
   const record=rows.find(r=>String(r.customer?.id)===account.id),ocid=ocidFromGoogleURL(record?.metrics?.optimizationScoreUrl);
   if(!ocid)throw new AdsError('O Google Ads não retornou o OCID desta conta. Abra a conta no Google Ads e envie o link para configurar o acesso direto.',{status:422});
   db.prepare('INSERT OR REPLACE INTO roi_google_ads_accounts VALUES (?,?,?)').run(account.id,ocid,new Date().toISOString());return ocid;
  })();pending.set(account.id,task);try{return await task;}finally{pending.delete(account.id);}
 }
 return async(account,campaign)=>{
  if(!/^\d{10}$/.test(account?.id||'')||!/^\d{1,20}$/.test(campaign||''))throw new AdsError('Conta ou campanha inválida.',{status:400});
  const ocid=await identify(account),url=new URL('https://ads.google.com/aw/campaigns');url.searchParams.set('campaignId',campaign);url.searchParams.set('ocid',ocid);return url.href;
 };
}
