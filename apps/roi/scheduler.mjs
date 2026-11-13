import {shiftDay} from './warehouse.mjs';
const intervalMinutes=60;
const retryMinutes=5;
export function createROIScheduler({enabled=false,read,write,run,isBusy,day,clock=()=>Date.now(),timers={setInterval,clearInterval,setTimeout,clearTimeout}}){
 let timer,initial,running=false,stopped=false;
 const previous=read()||{};if(previous.running)write({...previous,running:false,last_ok:false,error:'Coleta interrompida pelo reinício. Nova tentativa automática.'});
 const regularAt=(state,now)=>state.last_attempt?Date.parse(state.last_regular_at||state.last_attempt)+intervalMinutes*60000:now;
 const retryAt=state=>state.last_ok===false&&state.last_attempt?Date.parse(state.last_attempt)+retryMinutes*60000:Infinity;
 function status(){const state=read()||{},now=clock();return {...state,enabled,interval_minutes:intervalMinutes,next_at:enabled?new Date(state.last_attempt?Math.min(regularAt(state,now),retryAt(state)):now+5000).toISOString():null};}
 async function tick(){
  if(!enabled||stopped||running||isBusy())return;
  const state=read()||{},now=clock(),regular=now>=regularAt(state,now);
  if(!regular&&now<retryAt(state))return;
  running=true;
  const today=day(),hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'America/Sao_Paulo',hour:'2-digit',hourCycle:'h23'}).format(new Date(now)));
  const deep=state.last_deep_day!==today&&hour>=3;
  const range=!regular&&state.last_range?.end===today?state.last_range:{start:deep?shiftDay(today,-6):today,end:today,deep};
  const attempt=new Date(now).toISOString(),started={...state,running:true,last_attempt:attempt,last_regular_at:regular?attempt:state.last_regular_at||state.last_attempt,last_range:range,error:null};
  write(started);
  try{const result=await run(range,{retry:!regular});if(stopped)return;write({...started,running:false,last_ok:result.complete,last_success:result.complete?new Date(clock()).toISOString():state.last_success||null,last_deep_day:regular&&deep?today:state.last_deep_day||null,error:result.complete?null:'Uma ou mais fontes aguardam nova coleta. Os dados válidos foram mantidos.'});}
  catch{if(!stopped)write({...started,running:false,last_ok:false,error:'A atualização automática falhou. Os dados válidos foram mantidos.'});}
  finally{running=false;}
 }
 return {tick,status,start(){if(!enabled||timer||stopped)return;initial=timers.setTimeout(()=>void tick(),5000);initial?.unref?.();timer=timers.setInterval(()=>void tick(),60000);timer?.unref?.();},stop(){stopped=true;timers.clearInterval(timer);timers.clearTimeout(initial);timer=null;}};
}
