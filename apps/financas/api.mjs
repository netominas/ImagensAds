import {randomUUID} from 'node:crypto';
import {authJSON,sameOrigin} from '../../lib/auth.mjs';
import {createFixedAPI} from './fixed.mjs';
import {createFinanceCatalog} from './catalog.mjs';

export const categories=['Moradia','Alimentação','Contas da casa','Transporte','Saúde','Educação','Lazer','Outros'];
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
export function createFinanceAPI(storage){
 const db=storage.db;
 const catalog=createFinanceCatalog(db,categories);
 const fixedAPI=createFixedAPI(db,catalog);
 db.exec(`CREATE TABLE IF NOT EXISTS finance_expenses (
 id TEXT PRIMARY KEY, description TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
 category TEXT NOT NULL, date TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('paid','pending')),
 revision INTEGER NOT NULL DEFAULT 1, created TEXT NOT NULL, updated TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS finance_expenses_date ON finance_expenses(date);`);
 if(!db.prepare('PRAGMA table_info(finance_expenses)').all().some(c=>c.name==='area'))db.exec("ALTER TABLE finance_expenses ADD COLUMN area TEXT NOT NULL DEFAULT 'home'");
 function validate(data){
  if(!data||typeof data!=='object'||Array.isArray(data))fail('Dados inválidos.');
  const description=typeof data.description==='string'?data.description.trim():'';
  if(!description||description.length>160)fail('Informe uma descrição de até 160 caracteres.');
  if(!Number.isSafeInteger(data.amount_cents)||data.amount_cents<1||data.amount_cents>100000000)fail('Informe um valor entre R$ 0,01 e R$ 1.000.000,00.');
  if(!catalog.categories().includes(data.category))fail('Selecione uma categoria.');
  if(!catalog.groups().some(g=>g.id===(data.area??'home')))fail('Selecione um grupo.');
  if(typeof data.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(data.date)||data.date<'1900-01-01'||data.date>'2100-12-31'||!Number.isFinite(Date.parse(data.date))||new Date(data.date).toISOString().slice(0,10)!==data.date)fail('Informe uma data válida.');
  if(!['paid','pending'].includes(data.status))fail('Selecione pago ou pendente.');
  return [description,data.amount_cents,data.category,data.date,data.status,data.area??'home'];
 }
 return async request=>{
  const url=new URL(request.url),path=url.pathname,method=request.method;
  if(['/apps/financas/api/catalog','/apps/financas/api/categories','/apps/financas/api/groups'].includes(path)||path.startsWith('/apps/financas/api/categories/')||path.startsWith('/apps/financas/api/groups/'))return catalog.api(request);
  if(path==='/apps/financas/api/fixed'||path.startsWith('/apps/financas/api/fixed/'))return fixedAPI(request);
  if(!['GET','HEAD'].includes(method)&&!sameOrigin(request))return authJSON({error:'Origem não permitida.'},403);
  try{
   if(path==='/apps/financas/api/expenses'){
    if(method==='GET'){
     const month=url.searchParams.get('month');
     if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month||'')||month<'1900-01'||month>'2100-12')fail('Informe um mês válido.');
     const expenses=db.prepare('SELECT * FROM finance_expenses WHERE date>=? AND date<=? ORDER BY date DESC,created DESC').all(month+'-01',month+'-31');
     const summary={total:0,paid:0,pending:0,categories:Object.fromEntries(catalog.categories().map(c=>[c,0])),groups:Object.fromEntries(catalog.groups().map(g=>[g.id,0]))};
     for(const e of expenses){summary.total+=e.amount_cents;summary[e.status]+=e.amount_cents;summary.categories[e.category]=(summary.categories[e.category]||0)+e.amount_cents;summary.groups[e.area]=(summary.groups[e.area]||0)+e.amount_cents;}
     return authJSON({expenses,summary,...catalog.snapshot()});
    }
    if(method==='POST'){
     let body;try{body=await request.json();}catch{fail('JSON inválido.');}
     const values=validate(body),id=randomUUID(),stamp=new Date().toISOString();
     db.prepare('INSERT INTO finance_expenses (id,description,amount_cents,category,date,status,area,revision,created,updated) VALUES (?,?,?,?,?,?,?,1,?,?)').run(id,...values,stamp,stamp);
     return authJSON(db.prepare('SELECT * FROM finance_expenses WHERE id=?').get(id),201);
    }
    return authJSON({error:'Método não permitido.'},405);
   }
   const match=path.match(/^\/apps\/financas\/api\/expenses\/([a-f0-9-]{36})$/);
   if(!match)return authJSON({error:'Não encontrado.'},404);
   if(!['PUT','DELETE'].includes(method))return authJSON({error:'Método não permitido.'},405);
   let body;try{body=await request.json();}catch{fail('JSON inválido.');}
   if(!body||!Number.isSafeInteger(body.revision)||body.revision<1)fail('Recarregue a despesa antes de alterar.');
   const current=db.prepare('SELECT revision FROM finance_expenses WHERE id=?').get(match[1]);
   if(!current)fail('Despesa não encontrada.',404);
   if(current.revision!==body.revision)fail('Esta despesa mudou em outra aba. Recarregue antes de alterar.',409);
   const result=method==='PUT'
    ?db.prepare('UPDATE finance_expenses SET description=?,amount_cents=?,category=?,date=?,status=?,area=?,revision=revision+1,updated=? WHERE id=? AND revision=?').run(...validate(body),new Date().toISOString(),match[1],body.revision)
    :db.prepare('DELETE FROM finance_expenses WHERE id=? AND revision=?').run(match[1],body.revision);
   if(!result.changes)fail('Esta despesa mudou em outra aba. Recarregue antes de alterar.',409);
   return authJSON(method==='PUT'?db.prepare('SELECT * FROM finance_expenses WHERE id=?').get(match[1]):{ok:true});
  }catch(error){return authJSON({error:error.status?error.message:'Não foi possível salvar a despesa.'},error.status||500);}
 };
}
