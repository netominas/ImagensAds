export function campaignQuickROI({api,money,pct,onOpen}){
 const card=document.createElement('div');
 card.id='campaign-quick-roi';
 card.className='recent-changes-card campaign-quick-roi';
 card.setAttribute('popover','manual');
 card.setAttribute('role','dialog');
 card.setAttribute('aria-labelledby','campaign-quick-roi-title');
 card.innerHTML='<div class="recent-changes-heading"><h2 id="campaign-quick-roi-title">ROI dos últimos 7 dias</h2><button type="button" aria-label="Fechar prévia de ROI">×</button></div><p class="recent-changes-name"></p><p class="quick-roi-message" role="status"></p><div class="quick-roi-table" hidden><table aria-label="ROI diário da campanha"><thead><tr><th scope="col" aria-sort="ascending">Data ↑</th><th scope="col">Custo</th><th scope="col">Receita</th><th scope="col">Lucro</th><th scope="col">ROI %</th></tr></thead><tbody></tbody></table></div>';
 document.body.append(card);
 const name=card.querySelector('.recent-changes-name'),message=card.querySelector('.quick-roi-message'),table=card.querySelector('.quick-roi-table'),body=card.querySelector('tbody');
 let trigger=null,pinned=false,closeTimer,restoreFocus=false,version=0;
 function close(focus=false){
  clearTimeout(closeTimer);
  if(!trigger)return;
  const old=trigger;
  trigger=null;pinned=false;version++;
  old.setAttribute('aria-expanded','false');
  card.hidePopover();
  if(focus&&old.isConnected){restoreFocus=true;old.focus();restoreFocus=false;}
 }
 function position(){
  if(!trigger)return;
  const anchor=trigger.getBoundingClientRect(),width=card.offsetWidth,height=card.offsetHeight;
  if(!trigger.isConnected||anchor.bottom<0||anchor.top>innerHeight||anchor.right<0||anchor.left>innerWidth){close();return;}
  card.style.left=Math.max(8,Math.min(anchor.left,innerWidth-width-8))+'px';
  const below=anchor.bottom+6;
  card.style.top=Math.max(8,Math.min(below+height<=innerHeight-8?below:anchor.top-height-6,innerHeight-height-8))+'px';
 }
 function leave(){
  clearTimeout(closeTimer);
  closeTimer=setTimeout(()=>{if(!pinned&&!card.contains(document.activeElement))close();},250);
 }
 async function open(button,pin=false){
  clearTimeout(closeTimer);
  if(trigger===button){pinned=pinned||pin;return;}
  close();
  onOpen();
  trigger=button;pinned=pin;
  const request=++version,{quickRoiAccount:account,quickRoiCampaign:campaign,quickRoiName,quickRoiSite:site}=button.dataset;
  button.setAttribute('aria-expanded','true');
  name.textContent=quickRoiName;
  message.textContent='Carregando ROI…';
  table.hidden=true;body.replaceChildren();
  card.showPopover();position();
  try{
   const {days}=await api('/campaign-quick-roi?'+new URLSearchParams({account,campaign,site}));
   if(request!==version)return;
   days.sort((a,b)=>a.date.localeCompare(b.date));
   for(const day of days){
    const row=body.insertRow();
    for(const [key,value] of Object.entries({date:day.date.split('-').reverse().slice(0,2).join('/'),cost:money(day.cost),revenue:money(day.revenue),profit:money(day.profit),roi:pct(day.roi)})){
     const cell=row.insertCell();
     cell.textContent=value;
     if((key==='profit'||key==='roi')&&day[key]!=null)cell.className=day[key]<0?'negative':'positive';
    }
   }
   table.hidden=!days.length;
   message.textContent=days.length?'':'Sem dados da campanha nos últimos 7 dias.';
  }catch(error){
   if(request!==version)return;
   message.textContent=error.message;
  }
  position();
 }
 card.onpointerenter=()=>clearTimeout(closeTimer);
 card.onpointerleave=leave;
 card.onfocusout=event=>{if(!card.contains(event.relatedTarget)&&event.relatedTarget!==trigger)leave();};
 card.querySelector('button').onclick=()=>close(true);
 document.addEventListener('pointerdown',event=>{if(trigger&&!card.contains(event.target)&&!trigger.contains(event.target))close();});
 document.addEventListener('keydown',event=>{if(trigger&&event.key==='Escape'){event.preventDefault();close(true);}});
 document.addEventListener('scroll',position,true);
 addEventListener('resize',position);
 return {close,bind(root){
  root.querySelectorAll('[data-quick-roi-account]').forEach(button=>{
   button.onpointerenter=event=>{if(event.pointerType!=='touch')void open(button);};
   button.onpointerleave=leave;
   button.onfocus=()=>{if(!restoreFocus)void open(button);};
   button.onblur=leave;
   button.onclick=()=>{if(trigger===button&&pinned)close();else void open(button,true);};
  });
 }};
}
