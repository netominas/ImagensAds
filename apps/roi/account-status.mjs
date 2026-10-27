const known=new Set(['ENABLED','SUSPENDED','CANCELED','CLOSED']);
export function createAccountStatus(db,google){
 db.exec('CREATE TABLE IF NOT EXISTS roi_account_status(account TEXT PRIMARY KEY,status TEXT,updated TEXT,checked TEXT,error TEXT)');
 const stamp=()=>new Date().toISOString();
 function read(account){const row=db.prepare('SELECT * FROM roi_account_status WHERE account=?').get(account);return {account_status:row?.status||null,status_updated:row?.updated||null,status_checked:row?.checked||null,status_error:row?.error||null};}
 async function refresh(accounts){
  const groups=new Map();for(const a of accounts){if(!/^\d{10}$/.test(a.id)||a.mcc&&!/^\d{10}$/.test(a.mcc))continue;const key=a.mcc||'direct:'+a.id;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(a);}
  const batches=[...groups.values()];let cursor=0;
  await Promise.all(Array.from({length:Math.min(3,batches.length)},async()=>{for(;;){const group=batches[cursor++];if(!group)break;const mcc=group[0].mcc;let found=new Map();
   try{const rows=await google.search(mcc||group[0].id,mcc?'SELECT customer_client.id, customer_client.status FROM customer_client WHERE customer_client.id IN ('+group.map(a=>a.id).join(',')+") AND customer_client.status IN ('ENABLED', 'SUSPENDED', 'CANCELED', 'CLOSED')":'SELECT customer.id, customer.status FROM customer',mcc||'');for(const row of rows){const c=mcc?row.customerClient:row.customer;if(c&&known.has(c.status))found.set(String(c.id),c.status);}}catch{/* Access failures do not prove suspension. */}
   for(const a of group){const at=stamp(),status=found.get(a.id),old=read(a.id);db.prepare('INSERT OR REPLACE INTO roi_account_status VALUES (?,?,?,?,?)').run(a.id,status||old.account_status,status?at:old.status_updated,at,status?null:'Não foi possível confirmar o estado atual da conta.');}
  }}));
 }
 return {read,refresh};
}
