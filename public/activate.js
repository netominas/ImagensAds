const token=location.hash.slice(1);history.replaceState(null,'',location.pathname);
document.getElementById('activate').onsubmit=async event=>{
  event.preventDefault();const message=document.getElementById('message'),button=event.target.querySelector('button');
  if(document.getElementById('password').value!==document.getElementById('confirm').value){message.textContent='As senhas precisam ser iguais.';return;}
  button.disabled=true;
  try{const response=await fetch('/api/activate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,email:document.getElementById('email').value,password:document.getElementById('password').value})});const data=await response.json();if(!response.ok)throw Error(data.error);location.replace('/');}catch(error){message.textContent=error.message;button.disabled=false;}
};
