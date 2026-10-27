import {AdsError} from '../google-ads/client.mjs';

export const billingQuery='SELECT billing_setup.id, billing_setup.status, billing_setup.payments_account_info.payments_profile_id, billing_setup.payments_account_info.payments_profile_name, billing_setup.payments_account_info.payments_account_id, billing_setup.start_date_time, billing_setup.end_date_time, billing_setup.end_time_type FROM billing_setup';
export function createPayments(db,{google,admanager,catalog}){
 db.exec(`CREATE TABLE IF NOT EXISTS roi_payment_profiles(kind TEXT NOT NULL,source TEXT NOT NULL,profiles TEXT NOT NULL,updated TEXT,checked TEXT,error TEXT,PRIMARY KEY(kind,source));
 CREATE TABLE IF NOT EXISTS roi_payment_reports(source TEXT PRIMARY KEY,resource TEXT NOT NULL);`);
 let pending=null,progress=null;
 const stamp=()=>new Date().toISOString();
 async function list(){const c=await catalog();return {progress,items:[...c.accounts.map(a=>({...a,kind:'ads'})),...c.networks.map(n=>({...n,kind:'gam'}))].map(a=>{const stored=db.prepare('SELECT * FROM roi_payment_profiles WHERE kind=? AND source=?').get(a.kind,a.id);return {...a,profiles:stored?JSON.parse(stored.profiles):[],updated:stored?.updated||null,checked:stored?.checked||null,error:stored?.error||null};})};}
 async function refresh(){
  if(pending)return list();
  const c=await catalog(),sources=[...c.accounts.map(a=>({...a,kind:'ads'})),...c.networks.map(n=>({...n,kind:'gam'}))];
  if(pending)return list();
  progress={running:true,done:0,total:sources.length,started:stamp()};
  pending=(async()=>{let cursor=0;await Promise.all(Array.from({length:Math.min(3,sources.length)},async()=>{for(;;){const a=sources[cursor++];if(!a)break;try{
   let profiles;
   if(a.kind==='ads')profiles=(await google.search(a.id,billingQuery,a.mcc)).map(row=>{const b=row.billingSetup||{},p=b.paymentsAccountInfo||{};return {id:String(p.paymentsProfileId||''),name:p.paymentsProfileName||'',payments_account:p.paymentsAccountId||'',status:b.status||'',start:b.startDateTime||'',end:b.endDateTime||'',end_type:b.endTimeType||'',billing_id:String(b.id||'')};}).filter(p=>p.id);
   else{const saved=db.prepare('SELECT resource FROM roi_payment_reports WHERE source=?').get(a.id);profiles=await admanager.paymentProfiles(a.id,{resource:saved?.resource,saveResource:resource=>db.prepare('INSERT OR REPLACE INTO roi_payment_reports VALUES (?,?)').run(a.id,resource)});}
   const at=stamp();db.prepare('INSERT OR REPLACE INTO roi_payment_profiles VALUES (?,?,?,?,?,NULL)').run(a.kind,a.id,JSON.stringify(profiles),at,at);
  }catch(e){const old=db.prepare('SELECT * FROM roi_payment_profiles WHERE kind=? AND source=?').get(a.kind,a.id);const error=a.kind==='ads'?'O Google Ads não disponibilizou o faturamento com este acesso.':e instanceof AdsError?e.message:'Não foi possível consultar os perfis no Ad Manager.';db.prepare('INSERT OR REPLACE INTO roi_payment_profiles VALUES (?,?,?,?,?,?)').run(a.kind,a.id,old?.profiles||'[]',old?.updated||null,stamp(),error);}finally{progress.done++;}}}));})().finally(()=>{progress={...progress,running:false,finished:stamp()};pending=null;});
  return list();
 }
 return {list,refresh,settled:()=>pending};
}
