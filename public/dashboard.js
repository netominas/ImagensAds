import {requireAccess} from './access.js';
const account=await requireAccess();
if(account){
 document.getElementById('account').textContent=account.email;
 document.getElementById('logout').onclick=async()=>{
  const button=document.getElementById('logout');button.disabled=true;
  try{const response=await fetch('/api/logout',{method:'POST'});if(!response.ok)throw new Error('Não foi possível sair. Tente novamente.');localStorage.setItem('adstudio-logout',String(Date.now()));location.replace('/login');}
  catch(error){const message=document.getElementById('message');message.hidden=false;message.textContent=error.message;button.disabled=false;}
 };
 window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
 window.addEventListener('storage',event=>{if(event.key==='adstudio-logout')location.replace('/login');});
 window.addEventListener('focus',()=>{void requireAccess();});
}
