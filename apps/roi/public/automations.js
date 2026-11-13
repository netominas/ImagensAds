const form=document.getElementById('automation-form');
const status=document.getElementById('automation-status');
const fields=form.querySelector('fieldset');
const switches=[...form.querySelectorAll('input[type="checkbox"]')];

async function load(settings){
 fields.disabled=true;
 try{
  const response=await fetch('/apps/roi/api/automacoes',settings?{
   method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(settings)
  }:{});
  const saved=await response.json();
  if(!response.ok)throw Error(saved.error||'Falha ao consultar as automações.');
  for(const input of switches)input.checked=saved[input.name];
  status.textContent=settings?'Configuração salva.':'';
  fields.disabled=false;
 }catch(error){
  status.textContent=error.message;
  fields.disabled=!settings;
 }
}

form.onsubmit=event=>{
 event.preventDefault();
 void load(Object.fromEntries(switches.map(input=>[input.name,input.checked])));
};
document.getElementById('pause-all').onclick=()=>void load(Object.fromEntries(switches.map(input=>[input.name,false])));
void load();
