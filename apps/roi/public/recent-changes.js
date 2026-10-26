export function recentChanges({api}){
 const popup=document.getElementById('recent-changes-card'),list=document.getElementById('recent-changes-list'),message=document.getElementById('recent-changes-message'),cache=new Map();
 let trigger=null,version=0,closing,pinned=false,quietFocus=false;
 function position(){if(!trigger||!popup.matches(':popover-open'))return;const r=trigger.getBoundingClientRect(),p=popup.getBoundingClientRect(),gap=8;if(r.bottom<0||r.top>innerHeight||r.right<0||r.left>innerWidth){close();return;}popup.style.left=Math.max(12,Math.min(r.left,innerWidth-p.width-12))+'px';popup.style.top=Math.max(12,Math.min(r.bottom+gap+p.height<=innerHeight-12?r.bottom+gap:r.top-p.height-gap,innerHeight-p.height-12))+'px';}
 function close(restore=false){clearTimeout(closing);version++;if(!trigger)return;const old=trigger;trigger=null;pinned=false;old.setAttribute('aria-expanded','false');if(popup.matches(':popover-open'))popup.hidePopover();if(restore&&old.isConnected){quietFocus=true;old.focus();quietFocus=false;}}
 function later(){clearTimeout(closing);closing=setTimeout(()=>{if(!pinned&&!popup.contains(document.activeElement))close();},250);}
 async function show(button,{pin=false,force=false}={}){
  clearTimeout(closing);if(trigger===button&&popup.matches(':popover-open')&&!force){pinned=pinned||pin;return;}
  close();trigger=button;pinned=pin;const token=++version,key=button.dataset.recentAccount+':'+button.dataset.recentCampaign;
  button.setAttribute('aria-expanded','true');document.getElementById('recent-changes-name').textContent=button.dataset.recentName;list.replaceChildren();message.textContent='Carregando alterações…';document.getElementById('recent-changes-retry').hidden=true;popup.showPopover();position();
  try{
   let data=cache.get(key);if(force||!data||Date.now()-data.cached>30000){data={...await api('/campaign-changes?'+new URLSearchParams({account:button.dataset.recentAccount,campaign:button.dataset.recentCampaign,recent:'7'})),cached:Date.now()};cache.set(key,data);}if(token!==version)return;
   message.textContent=data.items.length?'Registros dos últimos 7 dias.':'Sem alterações registradas nos últimos 7 dias.';
   for(const item of data.items){const entry=document.createElement('article'),heading=document.createElement('div'),date=document.createElement('time'),type=document.createElement('strong'),description=document.createElement('p');entry.className='recent-change-entry';date.dateTime=item.date;date.textContent=item.date.split('-').reverse().join('/');type.textContent=data.types.find(t=>t.value===item.type)?.label||item.type;heading.append(date,type);description.textContent=item.description;entry.append(heading,description);if(item.source==='google_ads'){const source=document.createElement('small');source.textContent='Google Ads · pelo painel';entry.append(source);}list.append(entry);}
   position();
  }catch(error){if(token!==version)return;message.textContent=error.message;document.getElementById('recent-changes-retry').hidden=false;position();}
 }
 popup.onpointerenter=()=>clearTimeout(closing);popup.onpointerleave=later;
 popup.onfocusout=event=>{if(!popup.contains(event.relatedTarget)&&event.relatedTarget!==trigger&&!pinned)later();};
 document.getElementById('recent-changes-close').onclick=()=>close(true);
 document.getElementById('recent-changes-retry').onclick=()=>{if(trigger)void show(trigger,{pin:pinned,force:true});};
 document.addEventListener('pointerdown',event=>{if(trigger&&!popup.contains(event.target)&&!trigger.contains(event.target))close();});
 document.addEventListener('keydown',event=>{if(event.key==='Escape'&&trigger){event.preventDefault();close(true);}});
 addEventListener('resize',position);document.addEventListener('scroll',()=>{if(trigger){if(!trigger.isConnected)close();else position();}},true);
 return {close,invalidate(){cache.clear();},bind(){if(trigger&&!trigger.isConnected)close();document.querySelectorAll('[data-recent-account]').forEach(button=>{
  button.onpointerenter=event=>{if(event.pointerType==='mouse'||event.pointerType==='pen')void show(button);};button.onpointerleave=later;
  button.onfocus=()=>{if(!quietFocus)void show(button);};button.onblur=event=>{if(!popup.contains(event.relatedTarget)&&!pinned)later();};
  button.onclick=()=>{if(trigger===button&&pinned){close();return;}void show(button,{pin:true});};
 });}};
}
