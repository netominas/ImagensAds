import {randomUUID} from 'node:crypto';
import {authJSON,sameOrigin} from '../../lib/auth.mjs';

export function createFinanceCatalog(db,defaults){
 db.exec(`CREATE TABLE IF NOT EXISTS finance_categories(id TEXT PRIMARY KEY,name TEXT NOT NULL,normalized TEXT NOT NULL UNIQUE);
 CREATE TABLE IF NOT EXISTS finance_groups(id TEXT PRIMARY KEY,name TEXT NOT NULL,normalized TEXT NOT NULL UNIQUE);`);
 const normalize=name=>name.normalize('NFKC').trim().replace(/\s+/gu,' ');
 const key=name=>normalize(name).toLocaleLowerCase('pt-BR');
 // Seed only the initial catalog; renamed default categories must not return on restart.
 if(!db.prepare('SELECT count(*) n FROM finance_categories').get().n)for(const name of defaults)db.prepare('INSERT INTO finance_categories (id,name,normalized) VALUES (?,?,?)').run(randomUUID(),name,key(name));
 for(const [id,name] of [['home','Pessoal e casa'],['work','Trabalho']])db.prepare('INSERT OR IGNORE INTO finance_groups (id,name,normalized) VALUES (?,?,?)').run(id,name,key(name));
 for(const table of ['finance_categories','finance_groups'])if(!db.prepare('PRAGMA table_info('+table+')').all().some(c=>c.name==='revision'))db.exec('ALTER TABLE '+table+' ADD COLUMN revision INTEGER NOT NULL DEFAULT 1');
 const categories=()=>db.prepare('SELECT name FROM finance_categories ORDER BY rowid').all().map(r=>r.name);
 const groups=()=>db.prepare('SELECT id,name,revision FROM finance_groups ORDER BY rowid').all();
 const snapshot=()=>({categories:categories(),categoryItems:db.prepare('SELECT id,name,revision FROM finance_categories ORDER BY rowid').all(),groups:groups()});
 async function api(request){
  const path=new URL(request.url).pathname;
  if(request.method==='GET'&&path==='/apps/financas/api/catalog')return authJSON(snapshot());
  const match=path.match(/^\/apps\/financas\/api\/(categories|groups)(?:\/([a-f0-9-]{36}|home|work))?$/);
  if(!match)return authJSON({error:'Não encontrado.'},404);
  const [,type,id]=match;
  if(request.method!==(id?'PUT':'POST'))return authJSON({error:'Método não permitido.'},405);
  if(!sameOrigin(request))return authJSON({error:'Origem não permitida.'},403);
  let body;try{body=await request.json();}catch{return authJSON({error:'JSON inválido.'},400);}
  if(!body||typeof body.name!=='string')return authJSON({error:'Informe um nome.'},400);
  const name=normalize(body.name);
  if(!name||name.length>60||/[\p{Cc}\p{Cf}]/u.test(name))return authJSON({error:'Use um nome de 1 a 60 caracteres.'},400);
  const table=type==='categories'?'finance_categories':'finance_groups';
  const current=id?db.prepare('SELECT id,name,revision FROM '+table+' WHERE id=?').get(id):null;
  if(id&&!current)return authJSON({error:'Cadastro não encontrado.'},404);
  if(id&&(!Number.isSafeInteger(body.revision)||body.revision!==current.revision))return authJSON({error:'Este nome foi alterado em outra aba. Recarregue antes de renomear.'},409);
  const duplicate=db.prepare('SELECT id FROM '+table+' WHERE normalized=?').get(key(name));
  if(duplicate&&duplicate.id!==id)return authJSON({error:'Este nome já está cadastrado.'},409);
  if(id){
   if(name===current.name)return authJSON({item:current,...snapshot()});
   db.exec('BEGIN IMMEDIATE');
   try{
    const result=db.prepare('UPDATE '+table+' SET name=?,normalized=?,revision=revision+1 WHERE id=? AND revision=?').run(name,key(name),id,body.revision);
    if(!result.changes){db.exec('ROLLBACK');return authJSON({error:'Este nome foi alterado em outra aba. Recarregue antes de renomear.'},409);}
    if(type==='categories')for(const expenses of ['finance_expenses','finance_fixed_expenses'])db.prepare('UPDATE '+expenses+' SET category=?,revision=revision+1,updated=? WHERE category=?').run(name,new Date().toISOString(),current.name);
    db.exec('COMMIT');
   }catch(e){if(db.isTransaction)db.exec('ROLLBACK');if(String(e.message).includes('UNIQUE'))return authJSON({error:'Este nome já está cadastrado.'},409);throw e;}
   return authJSON({item:{id,name,revision:current.revision+1},rename:{type,from:current.name,to:name},...snapshot()});
  }
  if(db.prepare('SELECT count(*) n FROM '+table).get().n>=100)return authJSON({error:'Limite de 100 cadastros atingido.'},400);
  const item={id:randomUUID(),name,revision:1};
  // No await between duplicate check and insertion; the UNIQUE constraint also protects concurrent processes.
  try{db.prepare('INSERT INTO '+table+' (id,name,normalized) VALUES (?,?,?)').run(item.id,name,key(name));}
  catch(e){if(e.code?.startsWith('ERR_SQLITE')&&String(e.message).includes('UNIQUE'))return authJSON({error:'Este nome já está cadastrado.'},409);throw e;}
  return authJSON({item,...snapshot()},201);
 }
 return {categories,groups,snapshot,api};
}
