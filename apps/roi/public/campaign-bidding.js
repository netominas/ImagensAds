export function campaignBidding(row,currency,checkedAt){
 const c=row.campaign||{},portfolio=Boolean(c.biddingStrategy),scheme=portfolio?row.accessibleBiddingStrategy:c;
 const type=c.biddingStrategyType,raw=type==='MAXIMIZE_CONVERSIONS'?scheme?.maximizeConversions?.targetCpaMicros:type==='TARGET_CPA'?scheme?.targetCpa?.targetCpaMicros:null;
 const micros=Number(raw),target=Number.isSafeInteger(micros)&&micros>0?micros/1e6:null;
 return {type:type||null,target_cpa:target,currency,portfolio,checked_at:checkedAt};
}

export function cpaIndicator(bidding){
 if(!['MAXIMIZE_CONVERSIONS','TARGET_CPA'].includes(bidding?.type)||!Number.isFinite(bidding.target_cpa)||bidding.target_cpa<=0||! /^[A-Z]{3}$/.test(bidding.currency||'')||!Number.isFinite(Date.parse(bidding.checked_at)))return '';
 const amount=new Intl.NumberFormat('pt-BR',{style:'currency',currency:bidding.currency,minimumFractionDigits:2,maximumFractionDigits:6}).format(bidding.target_cpa);
 const checked=new Date(bidding.checked_at).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'});
 const title=`CPA alvo: ${amount} · Meta da campanha${bidding.portfolio?' (portfólio)':''} · Consultado em ${checked}. Configuração observada na coleta; não representa o CPA realizado nem o histórico diário de lances.`;
 const esc=value=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 return `<button type="button" class="campaign-cpa-indicator" title="${esc(title)}" aria-label="${esc(title)}">CPA</button>`;
}
