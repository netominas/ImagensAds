import {randomUUID} from 'node:crypto';
import {authJSON,sameOrigin} from '../../lib/auth.mjs';

export function createFinanceCatalog(db,defaults){
 db.exec(`CREATE TABLE IF NOT EXISTS finance_categories(id TEXT PRIMARY KEY,name TEXT NOT NULL,normalized TEXT NOT NULL UNIQUE);
 CREATE TABLE IF NOT EXISTS finance_groups(id TEXT PRIMARY KEY,name TEXT NOT NULL,normalized TEXT NOT NULL UNIQUE);`);
 const normalize=name=>name.normalize('NFKC').trim().replace(/\s+/gu,' ');
 const key=name=>normalize(name).toLocaleLowerCase('pt-BR');
 for(const name of defaults)db.prepare('INSERT OR IGNORE INTO finance_categories VALUES (?,?,?)').run(randomUUID(),name,key(name));
 for(const [id,name] of [['home','Pessoal e casa'],['work','Trabalho']])db.prepare('INSERT OR IGNORE INTO finance_groups VALUES (?,?,?)').run(id,name,key(name));
 const categories=()=>db.prepare('SELECT name FROM finance_categories ORDER BY rowid').all().map(r=>r.name);
 const groups=()=>db.prepare('SELECT id,name FROM finance_groups ORDER BY rowid').all();
 const snapshot=()=>({categories:categories(),groups:groups()});
 async function api(request){
  const path=new URL(request.url).pathname;
  if(request.method==='GET'&&path==='/apps/financas/api/catalog')return authJSON(snapshot());
  const type=path==='/apps/financas/api/categories'?'categories':path==='/apps/financas/api/groups'?'groups':null;
  if(!type)return authJSON({error:'Não encontrado.'},404);
  if(request.method!=='POST')return authJSON({error:'Método não permitido.'},405);
  if(!sameOrigin(request))return authJSON({error:'Origem não permitida.'},403);
  let body;try{body=await request.json();}catch{return authJSON({error:'JSON inválido.'},400);}
  if(!body||typeof body.name!=='string')return authJSON({error:'Informe um nome.'},400);
  const name=normalize(body.name);
  if(!name||name.length>60||/[\p{Cc}\p{Cf}]/u.test(name))return authJSON({error:'Use um nome de 1 a 60 caracteres.'},400);
  const table=type==='categories'?'finance_categories':'finance_groups';
  if(db.prepare('SELECT id FROM '+table+' WHERE normalized=?').get(key(name)))return authJSON({error:'Este nome já está cadastrado.'},409);
  if(db.prepare('SELECT count(*) n FROM '+table).get().n>=100)return authJSON({error:'Limite de 100 cadastros atingido.'},400);
  const item={id:randomUUID(),name};
  // No await between duplicate check and insertion; the UNIQUE constraint also protects concurrent processes.
  try{db.prepare('INSERT INTO '+table+' VALUES (?,?,?)').run(item.id,name,key(name));}
  catch(e){if(e.code?.startsWith('ERR_SQLITE')&&String(e.message).includes('UNIQUE'))return authJSON({error:'Este nome já está cadastrado.'},409);throw e;}
  return authJSON({item,...snapshot()},201);
 }
 return {categories,groups,snapshot,api};
}
