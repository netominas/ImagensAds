import {AdsError} from '../google-ads/client.mjs';
import {toBRL} from './fx.mjs';

export const deductionDefaults=()=>({enabled:false,revenue_share_enabled:true,tax_enabled:true,tax_percent:0,tax_base:'profit',networks:{},revision:0});
export function validateDeductions(input,networks){
 const invalid=()=>{throw new AdsError('Confira os descontos: percentuais entre 0 e 100 e redes disponíveis.',{status:400});};
 if(!input||['enabled','revenue_share_enabled','tax_enabled'].some(k=>typeof input[k]!=='boolean')||!['profit','revenue'].includes(input.tax_base)||!Number.isFinite(input.tax_percent)||input.tax_percent<0||input.tax_percent>100||!input.networks||typeof input.networks!=='object'||Array.isArray(input.networks))invalid();
 for(const [id,n]of Object.entries(input.networks))if(!networks.some(r=>r.id===id)||!Number.isFinite(n)||n<0||n>100)invalid();
 return {enabled:input.enabled,revenue_share_enabled:input.revenue_share_enabled,tax_enabled:input.tax_enabled,tax_percent:input.tax_percent,tax_base:input.tax_base,networks:{...input.networks}};
}
export function createDeductionSettings(db){
 db.exec('CREATE TABLE IF NOT EXISTS roi_deduction_settings(id INTEGER PRIMARY KEY CHECK(id=1),data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS roi_deduction_audit(id INTEGER PRIMARY KEY,actor TEXT NOT NULL,created TEXT NOT NULL,data TEXT NOT NULL);');
 const read=()=>{const row=db.prepare('SELECT data FROM roi_deduction_settings WHERE id=1').get();return row?JSON.parse(row.data):deductionDefaults();};
 return {read,save(input,networks,actor='administrator'){
  const next=validateDeductions(input,networks);db.exec('BEGIN IMMEDIATE');try{const prior=read();if(input.revision!==prior.revision)throw new AdsError('A configuração mudou em outra sessão. Recarregue antes de salvar.',{status:409});Object.assign(next,{revision:prior.revision+1,updated_at:new Date().toISOString()});db.prepare('INSERT OR REPLACE INTO roi_deduction_settings VALUES(1,?)').run(JSON.stringify(next));db.prepare('INSERT INTO roi_deduction_audit(actor,created,data) VALUES(?,?,?)').run(actor,next.updated_at,JSON.stringify(next));db.exec('COMMIT');return next;}catch(e){db.exec('ROLLBACK');throw e;}
 }};
}
export const deductionSummary=config=>({enabled:config.enabled,revenue_share_enabled:config.revenue_share_enabled,tax_enabled:config.tax_enabled,tax_percent:config.tax_percent,tax_base:config.tax_base,revision:config.revision});
export function shareRate(config,network){return config.enabled&&config.revenue_share_enabled?(config.networks[network]||0)/100:0;}
// Tax is assessed per campaign/site/day; summing periods never changes its base.
// Native GAM metrics and stored source facts remain gross and untouched.
export function applyDeductions(source,config=deductionDefaults()){
 if(!source?.rows)return source;
 const result=structuredClone(source),rates=result.rates||{};
 result.deductions=deductionSummary(config);
 for(const row of result.rows){
  const facts=row.gam_original||[],original=row.gross_revenue_original||row.revenue_original||[];
  row.gross_revenue=row.gross_revenue??row.revenue;row.gross_revenue_original=original;
  row.deduction_days=[];row.revenue_share=0;row.company_tax=0;
  if(!config.enabled){row.revenue=row.gross_revenue;row.revenue_original=original;row.profit=row.comparable?row.revenue-row.cost:null;row.roi=row.comparable&&row.cost>0?row.profit/row.cost:null;continue;}
  // Legacy snapshots without per-network source facts cannot safely be discounted.
  if(row.gross_revenue!=null&&(!facts.length&&row.gross_revenue!==0||facts.some(f=>!f.network))){row.comparable=false;row.revenue=null;row.profit=null;row.roi=null;row.deductions_pending=true;continue;}
  const byDay=new Map();for(const f of facts){if(!byDay.has(f.date))byDay.set(f.date,[]);byDay.get(f.date).push(f);}
  let net=0;const entries=[];
  for(const [date,dayFacts]of byDay){
   const converted=dayFacts.map(f=>toBRL(f.revenue,f.currency,date,rates)),gross=converted.every(Number.isFinite)?converted.reduce((s,v)=>s+v,0):null;
   const share=gross==null?null:dayFacts.reduce((s,f,i)=>s+converted[i]*shareRate(config,f.network),0),after=gross==null?null:gross-share;
   const costs=(row.cost_original||[]).filter(f=>f.date===date).map(f=>toBRL(f.amount,f.currency,date,rates));
   const knownCost=costs.every(Number.isFinite)&&!row.missing_cost_days?.includes(date)&&!row.cost_fx_missing;
   const cost=knownCost?costs.reduce((s,v)=>s+v,0):null;
   const taxable=config.tax_enabled&&config.tax_percent>0;
   const pending=after==null||(taxable&&config.tax_base==='profit'&&(!knownCost||row.ambiguous||row.timezone_mismatch||row.missing_revenue_days?.includes(date)));
   const tax=pending?null:taxable?Math.max(0,config.tax_base==='revenue'?after:after-cost)*config.tax_percent/100:0;
   const taxRate=tax!=null&&after>0?tax/after:0;
   row.deduction_days.push({date,site:row.site,gross_revenue:gross,revenue_share:share,company_tax:tax,tax_rate:pending?null:taxRate});
   if(pending){row.deductions_pending=true;row.comparable=false;}
   for(const f of dayFacts)entries.push({date,currency:f.currency,amount:f.revenue*(1-shareRate(config,f.network))*(1-taxRate)});
   net+=after==null?0:after-(tax||0);row.revenue_share+=share||0;row.company_tax+=tax||0;
  }
  row.revenue_original=entries;row.revenue=row.gross_revenue==null||row.deductions_pending?null:net;
  row.profit_before_tax=row.comparable?net+row.company_tax-row.cost:null;
  row.profit=row.comparable?row.revenue-row.cost:null;row.roi=row.comparable&&row.cost>0?row.profit/row.cost:null;
 }
 const eligible=result.rows.filter(r=>r.comparable);
 const sum=(rows,key)=>rows.reduce((s,r)=>s+(r[key]||0),0);
 const totals=rows=>{const cost=sum(rows,'cost'),revenue=sum(rows,'revenue');return {cost,revenue,profit:revenue-cost,roi:cost>0?(revenue-cost)/cost:null,gross_revenue:sum(rows,'gross_revenue'),revenue_share:sum(rows,'revenue_share'),company_tax:sum(rows,'company_tax')};};
 result.totals=totals(eligible);
 for(const group of result.sites||[]){const rows=result.rows.filter(r=>(r.site||'Sem site identificado')===group.site),valid=rows.filter(r=>r.comparable);Object.assign(group,totals(valid),{compared:valid.length,pending:group.pending+rows.filter(r=>r.deductions_pending).length});if(!valid.length)Object.assign(group,{cost:null,revenue:null,profit:null,roi:null});}
 result.coverage={...result.coverage,matched:eligible.length,matched_revenue:result.totals.revenue,cost_pending:sum(result.rows.filter(r=>!r.comparable),'cost')};
 if(result.rows.some(r=>r.deductions_pending))result.warnings=[...(result.warnings||[]),'Descontos pendentes em registros sem detalhamento suficiente. Lucro e ROI desses registros ficam indisponíveis.'];
 return result;
}
