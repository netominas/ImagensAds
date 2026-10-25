// Ratios are weighted by their own denominator, never averaged across UTMs/days/networks.
export function gamMetrics(facts,rates={}){
 if(!Array.isArray(facts)||!facts.length)return {ecpm:null,cpc:null,pmr:null};
 const ratio=(value,weight,monetary=false)=>{
  let numerator=0,denominator=0;
  for(const f of facts){const n=f[weight],v=f[value],rate=!monetary||f.currency==='BRL'?1:f.currency==='USD'?rates[f.date]?.rate:null;
   if(!Number.isFinite(n)||n<0)return null;if(n===0)continue;
   if(!Number.isFinite(v)||rate==null||!Number.isFinite(rate))return null;
   numerator+=v*n*rate;denominator+=n;
  }return denominator>0?numerator/denominator:null;
 };
 let responses=0,eligible=0,complete=true;for(const f of facts){if(!Number.isFinite(f.programmatic_responses)||!Number.isFinite(f.eligible_requests)){complete=false;break;}responses+=f.programmatic_responses;eligible+=f.eligible_requests;}
 return {ecpm:ratio('ecpm','impressions',true),cpc:ratio('cpc','clicks',true),pmr:complete&&eligible>0?responses/eligible:null};
}
