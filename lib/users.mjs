import {randomBytes} from 'node:crypto';
import {authJSON,hashPassword,sameOrigin} from './auth.mjs';

export const canCampaign=(user,account,campaign)=>user?.role==='admin'||Boolean(/^\d{10}$/.test(account||'')&&/^\d{1,20}$/.test(campaign||'')&&user?.grants?.some(g=>g.account===account&&(g.campaigns===null||g.campaigns.includes(campaign))));
export const canAccount=(user,account)=>user?.role==='admin'||Boolean(user?.grants?.some(g=>g.account===account));
export function createUsers(db,env){
 db.exec(`CREATE TABLE IF NOT EXISTS workspace_users(id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,name TEXT NOT NULL,password_hash TEXT NOT NULL,active INTEGER NOT NULL,grants TEXT NOT NULL,revision INTEGER NOT NULL,created TEXT NOT NULL,updated TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS workspace_user_audit(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,created TEXT NOT NULL);`);
 const decode=r=>r?{...r,role:'reader',active:Boolean(r.active),grants:JSON.parse(r.grants)}:null;
 const findByEmail=email=>decode(db.prepare('SELECT * FROM workspace_users WHERE email=?').get(email));
 const getById=id=>decode(db.prepare('SELECT * FROM workspace_users WHERE id=?').get(id));
 const safe=u=>{const {password_hash,...rest}=u;return rest;};
 const list=()=>db.prepare('SELECT * FROM workspace_users ORDER BY name,email').all().map(r=>safe(decode(r)));
 const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
 async function save(body,actor,catalog){
  if(!body||typeof body!=='object'||Array.isArray(body))fail('Dados inválidos.');
  const email=typeof body.email==='string'?body.email.trim().toLowerCase():'';
  if(email.length>254||!/^\S+@\S+\.\S+$/.test(email)||email===env.ADMIN_EMAIL?.trim().toLowerCase())fail('Informe um e-mail válido diferente do administrador.');
  const name=typeof body.name==='string'?body.name.trim():'';if(!name||name.length>120)fail('Informe um nome de até 120 caracteres.');
  if(typeof body.active!=='boolean'||!Array.isArray(body.grants)||body.grants.length>120)fail('Confira o estado e as permissões.');
  const accounts=body.active?(await catalog()).accounts:[],seen=new Set();
  const grants=body.grants.map(g=>{if(!g||typeof g.account!=='string'||!/^\d{10}$/.test(g.account)||seen.has(g.account)||(body.active&&!accounts.some(a=>a.id===g.account)))fail('Selecione contas disponíveis, sem repetição.');seen.add(g.account);
   if(g.campaigns!==null&&(!Array.isArray(g.campaigns)||!g.campaigns.length||g.campaigns.length>500||new Set(g.campaigns).size!==g.campaigns.length||g.campaigns.some(c=>typeof c!=='string'||!/^\d{1,20}$/.test(c))))fail('Selecione a conta inteira ou IDs de campanhas válidos.');return {account:g.account,campaigns:g.campaigns===null?null:[...g.campaigns].sort()};});
  const existing=body.id?getById(body.id):null;if(body.id&&(!/^[a-f0-9]{32}$/.test(body.id)||!existing))fail('Usuário não encontrado.',404);
  if(existing&&body.revision!==existing.revision)fail('Este usuário foi alterado. Reabra antes de salvar.',409);
  if(!existing&&db.prepare('SELECT count(*) n FROM workspace_users').get().n>=100)fail('Limite de 100 usuários atingido.');
  let passwordHash=existing?.password_hash;if(body.password!==undefined&&body.password!=='')passwordHash=await hashPassword(body.password);if(!passwordHash)fail('Defina uma senha com pelo menos 14 caracteres.');
  const duplicate=findByEmail(email);if(duplicate&&duplicate.id!==existing?.id)fail('Este e-mail já está cadastrado.',409);
  const id=existing?.id||randomBytes(16).toString('hex'),stamp=new Date().toISOString();
  db.exec('BEGIN IMMEDIATE');try{
   if(existing){const updated=db.prepare('UPDATE workspace_users SET email=?,name=?,password_hash=?,active=?,grants=?,revision=revision+1,updated=? WHERE id=? AND revision=?').run(email,name,passwordHash,Number(body.active),JSON.stringify(grants),stamp,id,body.revision);if(!updated.changes)fail('Este usuário foi alterado. Reabra antes de salvar.',409);}
   else db.prepare('INSERT INTO workspace_users VALUES (?,?,?,?,?,?,1,?,?)').run(id,email,name,passwordHash,Number(body.active),JSON.stringify(grants),stamp,stamp);
   db.prepare('INSERT INTO workspace_user_audit VALUES (?,?,?,?,?)').run(randomBytes(16).toString('hex'),id,actor,existing?'updated':'created',stamp);db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
  return safe(getById(id));
 }
 async function api(request,user,{catalog,campaigns}){
  if(user?.role!=='admin')return authJSON({error:'Acesso exclusivo do administrador.'},403);
  const url=new URL(request.url),path=url.pathname;
  try{
   if(request.method==='GET'){
    if(path==='/api/users')return authJSON({users:list()});
    if(path==='/api/users/catalog')return authJSON({accounts:(await catalog()).accounts.map(a=>({id:a.id,name:a.name,status:a.status}))});
    if(path==='/api/users/campaigns')return authJSON({campaigns:await campaigns(url.searchParams.get('account'))});
   }
   if(request.method==='POST'&&path==='/api/users'){
    if(!sameOrigin(request))return authJSON({error:'Origem não permitida.'},403);
    if(!request.headers.get('content-type')?.startsWith('application/json'))return authJSON({error:'Envie JSON.'},415);
    let body;try{body=await request.json();}catch{fail('JSON inválido.');}
    return authJSON({user:await save(body,user.email,catalog),users:list()});
   }
   return authJSON({error:'Não encontrado.'},404);
  }catch(e){return authJSON({error:e.status||/senha/.test(e.message)?e.message:'Não foi possível salvar o usuário.'},e.status||400);}
 }
 return {findByEmail,getById,list,save,api};
}
