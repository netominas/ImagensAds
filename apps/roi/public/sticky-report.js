// Keep page scrolling and horizontal table scrolling independent.
export function stickyReportHeader(panel){
 const viewport=panel.querySelector('.table-scroll'),table=viewport.querySelector('table'),head=table.tHead;
 const floating=document.createElement('div'),copy=document.createElement('table');
 floating.className='report-sticky-header';floating.hidden=true;floating.setAttribute('aria-hidden','true');floating.append(copy);document.body.append(floating);
 let frame=0,dirty=true;
 function update(){
  frame=0;
  const bounds=table.getBoundingClientRect(),header=head.getBoundingClientRect(),clip=viewport.getBoundingClientRect();
  const left=Math.max(0,clip.left),right=Math.min(document.documentElement.clientWidth,clip.right);
  const visible=panel.getClientRects().length&&header.height>0&&header.top<0&&bounds.bottom>0&&right>left;
  floating.hidden=!visible;if(!visible)return;
  if(dirty){
   copy.replaceChildren(head.cloneNode(true));copy.tHead.removeAttribute('id');copy.querySelectorAll('[id]').forEach(el=>el.removeAttribute('id'));
   copy.querySelectorAll('button').forEach((button,index)=>{button.tabIndex=-1;button.onclick=()=>head.querySelectorAll('button')[index]?.click();});dirty=false;
  }
  floating.style.left=left+'px';floating.style.width=(right-left)+'px';floating.style.top=Math.min(0,bounds.bottom-header.height)+'px';floating.style.height=header.height+'px';
  copy.style.width=bounds.width+'px';copy.style.transform='translateX('+(bounds.left-left)+'px)';
  const originals=head.querySelectorAll('th'),clones=copy.querySelectorAll('th');
  originals.forEach((cell,index)=>{const clone=clones[index];if(!clone)return;const width=cell.getBoundingClientRect().width+'px';clone.style.width=width;clone.style.minWidth=width;clone.style.maxWidth=width;clone.style.height=header.height+'px';clone.style.textAlign=getComputedStyle(cell).textAlign;});
 }
 function schedule(){if(!frame)frame=requestAnimationFrame(update);}
 new MutationObserver(()=>{dirty=true;schedule();}).observe(head,{childList:true,subtree:true,attributes:true,characterData:true});
 new MutationObserver(schedule).observe(panel,{attributes:true,attributeFilter:['hidden','class']});
 const resize=new ResizeObserver(schedule);resize.observe(table);resize.observe(viewport);
 window.addEventListener('scroll',schedule,{capture:true,passive:true});window.addEventListener('resize',schedule,{passive:true});schedule();
}
