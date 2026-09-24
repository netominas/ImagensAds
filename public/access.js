export async function requireAccess(){
  try{
    const response=await fetch('/api/session',{cache:'no-store',signal:AbortSignal.timeout(15000)});
    if(!response.ok){location.replace('/');return null;}
    return await response.json();
  }catch{location.replace('/');return null;}
}
export async function secureFetch(...args){
  const response=await fetch(...args);
  if(response.status===401||response.status===503){
    document.body.replaceChildren();location.replace('/');
    throw new Error('Entre novamente para continuar.');
  }
  return response;
}
