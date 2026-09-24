const form=document.getElementById('login-form');
const message=document.getElementById('login-message');
const button=document.getElementById('login-button');
const password=document.getElementById('password');
function showMessage(text){message.textContent=text;message.hidden=false;}
document.getElementById('show-password').onclick=()=>{
  password.type=password.type==='password'?'text':'password';
  const label=password.type==='password'?'Mostrar':'Ocultar';
  document.getElementById('show-password').textContent=label;
  document.getElementById('show-password').setAttribute('aria-label',`${label} senha`);
};
form.onsubmit=async event=>{
  event.preventDefault();button.disabled=true;button.textContent='Entrando…';message.hidden=true;
  try{
    const response=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:document.getElementById('email').value.trim(),password:password.value}),signal:AbortSignal.timeout(20000)});
    let data;try{data=await response.json();}catch{}
    if(!response.ok)throw new Error(response.status===429?'Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.':data?.error||'Não foi possível entrar. Tente novamente.');
    password.value='';location.replace('/studio');
  }catch(error){showMessage(error.name==='TimeoutError'?'O servidor demorou para responder. Tente novamente.':error.message);}
  finally{button.disabled=false;button.textContent='Entrar no estúdio →';}
};
try{
  const response=await fetch('/api/session',{cache:'no-store',signal:AbortSignal.timeout(15000)});
  const data=await response.json();
  if(data.authenticated)location.replace('/studio');
  else if(data.configured===false)showMessage('O acesso está protegido. O administrador ainda precisa configurar o e-mail e a senha na Netlify.');
}catch{showMessage('Não foi possível verificar o acesso agora. Você pode tentar entrar abaixo.');}
