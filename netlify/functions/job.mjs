import {getJobStore,getAuthStore,json,validToken} from '../../lib/store.mjs';
import {requireSession} from '../../lib/auth.mjs';
export async function serveJob(request,store) {
  if(request.method!=='GET') return json({error:'Método não permitido.'},405);
  const token=request.headers.get('x-job-token');
  if(!validToken(token)) return json({error:'Identificador inválido.'},400);
  const state=await store.get(`${token}/job`,{type:'json'});
  if(!state) return json({status:'pending'});
  if(Date.now()-state.created>86400000) return json({error:'Esta geração expirou.'},410);
  const index=new URL(request.url).searchParams.get('image');
  if(index!==null) {
    const item=state.images.find(v=>String(v.index)===index);
    if(!item) return json({error:'Imagem não encontrada.'},404);
    const bytes=await store.get(`${token}/image-${item.index}`,{type:'arrayBuffer'});
    if(!bytes) return json({error:'Imagem não encontrada.'},404);
    const stream = new ReadableStream({start(controller){controller.enqueue(new Uint8Array(bytes));controller.close();}});
    return new Response(stream,{headers:{'Content-Type':item.mime,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  }
  return json(state);
}
export default async function(request) {
  const denied=await requireSession(request,await getAuthStore());
  if(denied)return denied;
  return serveJob(request,await getJobStore());
}
