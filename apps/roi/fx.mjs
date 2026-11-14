import {AdsError} from '../google-ads/client.mjs';
import {dateRange} from './admanager.mjs';
export const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export async function dollarRates(start,end,fetcher=fetch){
 dateRange(start,end);const first=new Date(start+'T12:00:00Z');first.setUTCDate(first.getUTCDate()-15);
 const us=d=>d.slice(5,7)+'-'+d.slice(8,10)+'-'+d.slice(0,4);
 const url=new URL('https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)');
 url.searchParams.set('@dataInicial',"'"+us(first.toISOString().slice(0,10))+"'");url.searchParams.set('@dataFinalCotacao',"'"+us(end)+"'");url.searchParams.set('$format','json');url.searchParams.set('$select','cotacaoVenda,dataHoraCotacao');url.searchParams.set('$top','10000');
 const read=async endpoint=>{
  const response=await fetcher(endpoint,{signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw new AdsError('Cotação do Banco Central indisponível. Atualize mais tarde.');
  return response.json();
 };
 const usable=q=>Number(q.cotacaoVenda)>0&&Number.isFinite(Number(q.cotacaoVenda))&&/^\d{4}-\d{2}-\d{2}/.test(q.dataHoraCotacao);
 let quotes;
 try{
  const data=await read(url);
  quotes=data.value.filter(usable);
  if(!quotes.length)throw Error('Sem cotações PTAX');
 }catch{
  const br=day=>day.split('-').reverse().join('/');
  const fallback=new URL('https://api.bcb.gov.br/dados/serie/bcdata.sgs.1/dados');
  fallback.search=new URLSearchParams({formato:'json',dataInicial:br(first.toISOString().slice(0,10)),dataFinal:br(end)});
  const data=await read(fallback);
  quotes=data.filter(q=>/^\d{2}\/\d{2}\/\d{4}$/.test(q.data)).map(q=>({
   cotacaoVenda:q.valor,dataHoraCotacao:q.data.split('/').reverse().join('-')
  })).filter(usable);
 }
 quotes.sort((a,b)=>a.dataHoraCotacao.localeCompare(b.dataHoraCotacao));
 const result={};for(let d=new Date(start+'T12:00:00Z');d.toISOString().slice(0,10)<=end;d.setUTCDate(d.getUTCDate()+1)){
  const day=d.toISOString().slice(0,10),quote=quotes.findLast(q=>q.dataHoraCotacao.slice(0,10)<=day);
  if(quote)result[day]={rate:Number(quote.cotacaoVenda),quote_date:quote.dataHoraCotacao.slice(0,10),timestamp:quote.dataHoraCotacao,source:'BCB/PTAX venda',previous_day:quote.dataHoraCotacao.slice(0,10)!==day};
 }
 if(!result[start])throw new AdsError('Sem cotação oficial para o período selecionado.');
 return result;
}
export function toBRL(amount,currency,date,rates){return currency==='BRL'?amount:currency==='USD'&&rates[date]?amount*rates[date].rate:null;}
