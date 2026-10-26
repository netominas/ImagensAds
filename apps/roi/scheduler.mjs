import {shiftDay} from './warehouse.mjs';
export function createROIScheduler({enabled=false,read,write,run,isBusy,day,clock=()=>Date.now(),timers={setInterval,clearInterval,setTimeout,clearTimeout}}){
 let timer,initial,running=false,stopped=false;
 const previous=read()||{};if(previous.running)write({...previous,running:false,last_ok:false,error:'Coleta interrompida pelo reinício. Nova tentativa automática.'});
 function status(){const state=read()||{},delay=state.last_ok===false?5*60000:30*60000;return {...state,enabled,interval_minutes:30,next_at:enabled?new Date(state.last_attempt?Date.parse(state.last_attempt)+delay:clock()+5000).toISOString():null};}
 async function tick(){
  if(!enabled||stopped||running||isBusy())return;
  const state=read()||{},now=clock(),delay=state.last_ok===false?5*60000:30*60000;if(state.last_attempt&&now-Date.parse(state.last_attempt)<delay)return;
  running=true;const today=day(),hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'America/Sao_Paulo',hour:'2-digit',hourCycle:'h23'}).format(new Date(now))),deep=!state.last_deep_day||(state.last_deep_day!==today&&hour>=3),attempt=new Date(now).toISOString();write({...state,running:true,last_attempt:attempt,error:null});
  try{const result=await run({start:shiftDay(today,deep?-29:-6),end:today,deep});if(stopped)return;write({...state,running:false,last_attempt:attempt,last_ok:result.complete,last_success:result.complete?new Date(clock()).toISOString():state.last_success||null,last_deep_day:deep&&result.complete?today:state.last_deep_day||null,error:result.complete?null:'Uma ou mais fontes aguardam nova coleta. Os dados válidos foram mantidos.'});}
  catch{if(!stopped)write({...state,running:false,last_attempt:attempt,last_ok:false,error:'A atualização automática falhou. Os dados válidos foram mantidos.'});}
  finally{running=false;}
 }
 return {tick,status,start(){if(!enabled||timer||stopped)return;initial=timers.setTimeout(()=>void tick(),5000);initial?.unref?.();timer=timers.setInterval(()=>void tick(),60000);timer?.unref?.();},stop(){stopped=true;timers.clearInterval(timer);timers.clearTimeout(initial);timer=null;}};
}
