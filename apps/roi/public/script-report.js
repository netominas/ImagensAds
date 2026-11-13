const $=id=>document.getElementById(id);
const form=$('script-period'),upload=$('script-import'),status=$('script-status');
const currency=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const percent=new Intl.NumberFormat('pt-BR',{style:'percent',maximumFractionDigits:1});
const money=value=>value==null?'—':currency.format(value);
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const start=new Date(today+'T12:00:00Z');
start.setUTCDate(start.getUTCDate()-6);
form.elements.start.value=start.toISOString().slice(0,10);
form.elements.end.value=today;
form.elements.start.max=form.elements.end.max=today;

async function request(params,body){
 const response=await fetch('/apps/roi/api/script-report'+params,body?{
  method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)
 }:{});
 if(response.status===413)throw Error('O lote excede 8 MB. Exporte um período menor.');
 const result=await response.json();
 if(!response.ok)throw Error(result.error||'Falha na consulta.');
 return result;
}
async function report(prefix=''){
 $('script-rows').replaceChildren();
 $('script-warnings').replaceChildren();
 status.textContent='Consultando dados salvos…';
 const {rows,warnings,accounts}=await request('?'+new URLSearchParams(new FormData(form)));
 for(const warning of warnings){
  const item=document.createElement('li');item.textContent=warning;$('script-warnings').append(item);
 }
 for(const row of rows){
  const tr=$('script-rows').insertRow();
  for(const value of [row.name,row.account_name||row.account,row.site||'Sem site identificado',
    money(row.cost),money(row.revenue),money(row.profit),row.roi==null?'—':percent.format(row.roi)]){
   tr.insertCell().textContent=value;
  }
 }
 status.textContent=prefix+(rows.length?rows.length+' resultados em '+accounts+' conta(s).':'Nenhum dado do script para o período.');
}
async function run(action){
 const buttons=[...document.querySelectorAll('button[type="submit"]')];
 buttons.forEach(button=>{button.disabled=true;});
 try{await action();}catch(error){status.textContent=error.message;}
 finally{buttons.forEach(button=>{button.disabled=false;});}
}
form.onsubmit=event=>{event.preventDefault();void run(()=>report());};
upload.onsubmit=event=>{
 event.preventDefault();
 void run(async()=>{
  const files=[...new FormData(upload)];
  if(files.reduce((size,[,file])=>size+file.size,0)>8*1024*1024)throw Error('O lote excede 8 MB.');
  status.textContent='Validando arquivos…';
  const body=Object.fromEntries(await Promise.all(files.map(async([key,file])=>[key,await file.text()])));
  const batch=await request('',body);
  form.elements.start.value=batch.start;
  form.elements.end.value=batch.end;
  upload.reset();
  await report('Lote importado. ');
 });
};
$('script-token').onsubmit=event=>{
 event.preventDefault();
 const {account}=Object.fromEntries(new FormData(event.currentTarget));
 void run(async()=>{
  const {token}=await request('/token',{account});
  $('script-token-value').value=token;
  $('script-token-result').hidden=false;
  status.textContent='Chave gerada para a conta '+account+'.';
 });
};
void run(()=>report());
