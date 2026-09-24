import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {getAuthStore} from '../../lib/store.mjs';
import {requireSession} from '../../lib/auth.mjs';
export default async function(request){
  const denied=await requireSession(request,await getAuthStore());
  if(denied)return new Response(null,{status:303,headers:{Location:'/','Cache-Control':'no-store'}});
  const html=await readFile(join(process.cwd(),'private/studio.html'),'utf8');
  return new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'private, no-store','Vary':'Cookie'}});
}
export const config={path:'/studio'};
