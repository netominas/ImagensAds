// Preserve Google's native rates and fractional conversions; weight each rate by its denominator.
export function adsMetrics(facts,rates={}){
 const empty={conversion_rate:null,cost_per_conversion:null};
 if(!Array.isArray(facts)||!facts.length||facts.some(f=>!f.ads_metrics))return empty;
 let interactions=0,convertedInteractions=0,conversions=0,conversionCost=0,rateKnown=true,costKnown=true;
 for(const f of facts){const m=f.ads_metrics,fx=f.currency==='BRL'?1:f.currency==='USD'?rates[f.date]?.rate:null;
  if(!Number.isFinite(m.interactions)||m.interactions<0||!Number.isFinite(m.conversions)||m.conversions<0)return empty;
  interactions+=m.interactions;conversions+=m.conversions;
  if(m.interactions>0){if(!Number.isFinite(m.conversion_rate))rateKnown=false;else convertedInteractions+=m.conversion_rate*m.interactions;}
  if(m.conversions>0){if(!Number.isFinite(m.cost_per_conversion)||!Number.isFinite(fx))costKnown=false;else conversionCost+=m.cost_per_conversion*m.conversions*fx;}
 }
 return {conversion_rate:rateKnown&&interactions>0?convertedInteractions/interactions:null,cost_per_conversion:costKnown&&conversions>0?conversionCost/conversions:null};
}
