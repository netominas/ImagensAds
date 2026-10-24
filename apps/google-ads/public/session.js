import {requireAccess} from '/access.js';
if(!await requireAccess())throw new Error('Sessão necessária.');
window.addEventListener('storage',event=>{if(event.key==='adstudio-logout')location.replace('/login');});
window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
window.addEventListener('focus',()=>{void requireAccess();});
