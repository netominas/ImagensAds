import {randomUUID} from 'node:crypto';
import {authJSON,sameOrigin} from '../../lib/auth.mjs';

export function createFixedAPI(db,categories){
 db.exec(`CREATE TABLE IF NOT EXISTS finance_fixed_expenses (
 id TEXT PRIMARY KEY,description TEXT NOT NULL,amount_cents INTEGER NOT NULL CHECK(amount_cents>0),category TEXT NOT NULL,
 area TEXT NOT NULL CHECK(area IN ('home','work')),revision INTEGER NOT NULL DEFAULT 1,created TEXT NOT NULL,updated TEXT NOT NULL);`);
 const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
 function validate(d){
  if(!d||typeof d!=='object'||Array.isArray(d))fail('Dados inválidos.');
  if(typeof d.description!=='string'||!d.description.trim()||d.description.trim().length>160)fail('Informe uma descrição de até 160 caracteres.');
  if(!Number.isSafeInteger(d.amount_cents)||d.amount_cents<1||d.amount_cents>100000000)fail('Informe um valor entre R$ 0,01 e R$ 1.000.000,00.');
  if(!categories.includes(d.category)||!['home','work'].includes(d.area))fail('Confira a categoria e o grupo.');
  return [d.description.trim(),d.amount_cents,d.category,d.area];
 }
 return async request=>{
  if(!['GET','HEAD'].includes(request.method)&&!sameOrigin(request))return authJSON({error:'Origem não permitida.'},403);
  const {pathname}=new URL(request.url),method=request.method,collection='/apps/financas/api/fixed';
  try{
   if(pathname===collection&&method==='GET'){
    const items=db.prepare('SELECT * FROM finance_fixed_expenses ORDER BY area,category,description').all();
    const summary={total:0,home:0,work:0,categories:Object.fromEntries(categories.map(c=>[c,0]))};
    for(const i of items){summary.total+=i.amount_cents;summary[i.area]+=i.amount_cents;summary.categories[i.category]+=i.amount_cents;}
    return authJSON({items,summary,categories});
   }
   const match=pathname.match(/^\/apps\/financas\/api\/fixed\/([a-f0-9-]{36})$/);
   if(pathname!==collection&&!match)return authJSON({error:'Não encontrado.'},404);
   if(!(pathname===collection?method==='POST':['PUT','DELETE'].includes(method)))return authJSON({error:'Método não permitido.'},405);
   let body;try{body=await request.json();}catch{fail('JSON inválido.');}
   if(method==='POST'){
    const values=validate(body),id=randomUUID(),stamp=new Date().toISOString();
    db.prepare('INSERT INTO finance_fixed_expenses VALUES (?,?,?,?,?,1,?,?)').run(id,...values,stamp,stamp);
    return authJSON(db.prepare('SELECT * FROM finance_fixed_expenses WHERE id=?').get(id),201);
   }
   if(!body||!Number.isSafeInteger(body.revision)||body.revision<1)fail('Recarregue antes de alterar.');
   if(!db.prepare('SELECT id FROM finance_fixed_expenses WHERE id=?').get(match[1]))fail('Despesa fixa não encontrada.',404);
   const result=method==='PUT'
    ?db.prepare('UPDATE finance_fixed_expenses SET description=?,amount_cents=?,category=?,area=?,revision=revision+1,updated=? WHERE id=? AND revision=?').run(...validate(body),new Date().toISOString(),match[1],body.revision)
    :db.prepare('DELETE FROM finance_fixed_expenses WHERE id=? AND revision=?').run(match[1],body.revision);
   if(!result.changes)fail('Esta despesa mudou. Recarregue antes de alterar.',409);
   return authJSON(method==='PUT'?db.prepare('SELECT * FROM finance_fixed_expenses WHERE id=?').get(match[1]):{ok:true});
  }catch(e){return authJSON({error:e.status?e.message:'Não foi possível salvar a despesa fixa.'},e.status||500);}
 };
}
