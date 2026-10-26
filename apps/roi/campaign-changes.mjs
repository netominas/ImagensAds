import {randomBytes} from 'node:crypto';
import {AdsError} from '../google-ads/client.mjs';

export const changeTypes=[
 ['budget_increase','Aumento de orçamento'],['budget_decrease','Redução de orçamento'],
 ['cpa_increase','Aumento de CPA'],['cpa_decrease','Redução de CPA'],
 ['roas','Alteração de ROAS'],['pricing','Regra de preço'],['landing_page','Alteração de landing page'],
 ['creative','Alteração de criativos'],['targeting','Alteração de segmentação'],['status','Status da campanha'],['other','Outra alteração']
].map(([value,label])=>({value,label}));

export function createCampaignChanges(db){
 db.exec(`CREATE TABLE IF NOT EXISTS roi_campaign_changes (
  id TEXT PRIMARY KEY,account TEXT NOT NULL,campaign TEXT NOT NULL,date TEXT NOT NULL,type TEXT NOT NULL,
  description TEXT NOT NULL,created TEXT NOT NULL,updated TEXT NOT NULL,deleted_at TEXT);
 CREATE INDEX IF NOT EXISTS roi_campaign_changes_scope ON roi_campaign_changes(account,campaign,date);`);
 const columns=new Set(db.prepare('PRAGMA table_info(roi_campaign_changes)').all().map(c=>c.name));if(!columns.has('source'))db.exec("ALTER TABLE roi_campaign_changes ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'");if(!columns.has('budget_operation'))db.exec('ALTER TABLE roi_campaign_changes ADD COLUMN budget_operation TEXT');
 db.exec('CREATE UNIQUE INDEX IF NOT EXISTS roi_campaign_changes_operation ON roi_campaign_changes(budget_operation,account,campaign) WHERE budget_operation IS NOT NULL');
 const invalid=message=>{throw new AdsError(message,{status:400});};
 function scope(account,campaign){if(typeof account!=='string'||typeof campaign!=='string'||!/^\d{10}$/.test(account)||!/^\d{1,20}$/.test(campaign))invalid('Conta ou campanha inválida.');return {account,campaign};}
 function list(account,campaign){scope(account,campaign);return db.prepare('SELECT id,account,campaign,date,type,description,created,updated,source,budget_operation FROM roi_campaign_changes WHERE account=? AND campaign=? AND deleted_at IS NULL ORDER BY date DESC,created DESC,id').all(account,campaign);}
 function save(body){
  const {account,campaign}=scope(body.account,body.campaign),description=typeof body.description==='string'?body.description.trim():'';
  if(!changeTypes.some(t=>t.value===body.type))invalid('Selecione um tipo de alteração.');
  if(typeof body.date!=='string'||!/^20\d{2}-\d{2}-\d{2}$/.test(body.date)||!Number.isFinite(Date.parse(body.date+'T12:00:00Z'))||new Date(body.date+'T12:00:00Z').toISOString().slice(0,10)!==body.date)invalid('Informe uma data válida entre 2000 e 2099.');
  if(!description||description.length>4000)invalid('Preencha a descrição com até 4.000 caracteres.');
  const id=body.id??randomBytes(16).toString('hex');if(typeof id!=='string'||! /^[a-f0-9]{32}$/.test(id))invalid('Registro inválido.');
  const existing=db.prepare('SELECT account,campaign,deleted_at,source FROM roi_campaign_changes WHERE id=?').get(id),stamp=new Date().toISOString();
  if(existing){if(existing.source==='google_ads')throw new AdsError('O registro automático do Google Ads é preservado para auditoria.',{status:403});if(existing.account!==account||existing.campaign!==campaign||existing.deleted_at)throw new AdsError('Registro não encontrado nesta campanha.',{status:404});db.prepare('UPDATE roi_campaign_changes SET date=?,type=?,description=?,updated=? WHERE id=?').run(body.date,body.type,description,stamp,id);}
  else db.prepare('INSERT INTO roi_campaign_changes(id,account,campaign,date,type,description,created,updated,deleted_at) VALUES (?,?,?,?,?,?,?,?,NULL)').run(id,account,campaign,body.date,body.type,description,stamp,stamp);
  return {id,items:list(account,campaign)};
 }
 function remove(body){const {account,campaign}=scope(body.account,body.campaign);if(typeof body.id!=='string'||!/^[a-f0-9]{32}$/.test(body.id))invalid('Registro inválido.');const row=db.prepare('SELECT source FROM roi_campaign_changes WHERE id=? AND account=? AND campaign=?').get(body.id,account,campaign);if(row?.source==='google_ads')throw new AdsError('O registro automático do Google Ads é preservado para auditoria.',{status:403});const stamp=new Date().toISOString();const result=db.prepare('UPDATE roi_campaign_changes SET deleted_at=?,updated=? WHERE id=? AND account=? AND campaign=? AND deleted_at IS NULL').run(stamp,stamp,body.id,account,campaign);if(!result.changes)throw new AdsError('Registro não encontrado nesta campanha.',{status:404});return {items:list(account,campaign)};}
 return {scope,list,save,remove};
}
