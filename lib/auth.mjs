import {createHash,randomBytes,scrypt,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
const derive=promisify(scrypt);
const SESSION_SECONDS=8*60*60;
const HASH_PATTERN=/^scrypt-v1\$[a-f0-9]{32}\$[a-f0-9]{128}$/;
export const digest=value=>createHash('sha256').update(value).digest('hex');
export const authJSON=(body,status=200,headers={})=>Response.json(body,{status,headers:{'Cache-Control':'no-store',...headers}});

export function authSettings(env=process.env){
  const email=env.ADMIN_EMAIL?.trim().toLowerCase();
  const passwordHash=env.ADMIN_PASSWORD_HASH;
  if(!email||!email.includes('@')||!HASH_PATTERN.test(passwordHash||''))return null;
  return {email,passwordHash,version:digest(`${email}:${passwordHash}`)};
}
export async function hashPassword(password,salt=randomBytes(16).toString('hex')){
  if(typeof password!=='string'||password.length<14||password.length>256)throw new Error('Use uma senha entre 14 e 256 caracteres.');
  const key=await derive(password,salt,64,{N:32768,r:8,p:3,maxmem:64*1024*1024});
  return `scrypt-v1$${salt}$${key.toString('hex')}`;
}
export async function verifyPassword(password,encoded){
  if(typeof password!=='string'||password.length>256||!HASH_PATTERN.test(encoded||''))return false;
  const [,salt,expected]=encoded.split('$');
  const actual=await derive(password,salt,64,{N:32768,r:8,p:3,maxmem:64*1024*1024});
  return timingSafeEqual(actual,Buffer.from(expected,'hex'));
}
function cookieName(request){return new URL(request.url).protocol==='https:'?'__Host-adstudio_session':'adstudio_session';}
function sessionToken(request){
  const entry=(request.headers.get('cookie')||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(`${cookieName(request)}=`));
  const value=entry?.slice(entry.indexOf('=')+1);
  return /^[a-f0-9]{64}$/.test(value||'')?value:null;
}
function cookie(request,value,maxAge){
  return `${cookieName(request)}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${new URL(request.url).protocol==='https:'?'; Secure':''}`;
}
export function sameOrigin(request){return request.headers.get('origin')===new URL(request.url).origin;}
export async function getSession(request,store,env=process.env){
  const settings=authSettings(env),token=sessionToken(request);
  if(!settings||!token)return null;
  const session=await store.get(`sessions/${digest(token)}`,{type:'json'});
  if(!session||session.expires<=Date.now()||session.version!==settings.version)return null;
  return {email:settings.email,expires:session.expires};
}
export async function requireSession(request,store,env=process.env){
  if(!authSettings(env))return authJSON({error:'O administrador ainda precisa configurar o acesso.'},503);
  if(!await getSession(request,store,env))return authJSON({error:'Sua sessão expirou. Entre novamente.'},401);
  return null;
}
// Atomic fixed-window slots work across serverless instances and concurrent attempts.
async function allowLogin(store,ip,now=Date.now()){
  const window=15*60*1000,expires=(Math.floor(now/window)+1)*window;
  const prefix=`attempts/${expires}-${digest(ip||'unknown')}`;
  for(let slot=0;slot<8;slot++){
    const result=await store.setJSON(`${prefix}-${slot}`,{expires},{onlyIfNew:true});
    if(result.modified)return {allowed:true};
  }
  return {allowed:false,retryAfter:Math.ceil((expires-now)/1000)};
}
export async function login(request,store,{env=process.env,ip='unknown'}={}){
  if(request.method!=='POST')return authJSON({error:'Método não permitido.'},405);
  if(!sameOrigin(request))return authJSON({error:'Origem não permitida.'},403);
  const settings=authSettings(env);
  if(!settings)return authJSON({error:'Login ainda não configurado. O administrador deve definir ADMIN_EMAIL e ADMIN_PASSWORD_HASH na Netlify.'},503);
  if(!request.headers.get('content-type')?.startsWith('application/json'))return authJSON({error:'Formato inválido.'},415);
  const raw=await request.text();
  if(raw.length>4096)return authJSON({error:'Solicitação muito grande.'},413);
  let data;try{data=JSON.parse(raw);}catch{return authJSON({error:'Solicitação inválida.'},400);}
  const limit=await allowLogin(store,ip);
  if(!limit.allowed)return authJSON({error:'Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.'},429,{'Retry-After':String(limit.retryAfter)});
  const passwordOK=await verifyPassword(data?.password,settings.passwordHash);
  const emailOK=typeof data?.email==='string'&&data.email.trim().toLowerCase()===settings.email;
  if(!passwordOK||!emailOK)return authJSON({error:'E-mail ou senha incorretos.'},401);
  const token=randomBytes(32).toString('hex'),expires=Date.now()+SESSION_SECONDS*1000;
  await store.setJSON(`sessions/${digest(token)}`,{expires,version:settings.version});
  return authJSON({ok:true,email:settings.email},200,{'Set-Cookie':cookie(request,token,SESSION_SECONDS)});
}
export async function logout(request,store){
  if(request.method!=='POST')return authJSON({error:'Método não permitido.'},405);
  if(!sameOrigin(request))return authJSON({error:'Origem não permitida.'},403);
  const token=sessionToken(request);
  if(token)await store.delete(`sessions/${digest(token)}`);
  return authJSON({ok:true},200,{'Set-Cookie':cookie(request,'',0)});
}
export async function sessionStatus(request,store,env=process.env){
  if(request.method!=='GET')return authJSON({error:'Método não permitido.'},405);
  if(!authSettings(env))return authJSON({configured:false,authenticated:false},503);
  const session=await getSession(request,store,env);
  return authJSON({configured:true,authenticated:Boolean(session),...(session||{})},session?200:401);
}
