import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';

export function openStorage(directory,secret){
  if(!/^[a-f0-9]{64}$/.test(secret||''))throw new Error('STORAGE_SECRET deve ter 64 caracteres hexadecimais.');
  mkdirSync(directory,{recursive:true,mode:0o700});
  const db=new DatabaseSync(join(directory,'adstudio.sqlite'));
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS entries (scope TEXT, key TEXT, value BLOB, PRIMARY KEY(scope,key)); CREATE TABLE IF NOT EXISTS images (id TEXT PRIMARY KEY, metadata TEXT NOT NULL, mime TEXT NOT NULL, bytes BLOB NOT NULL);');
  const key=Buffer.from(secret,'hex');
  const seal=value=>{const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv),body=Buffer.concat([c.update(JSON.stringify(value)),c.final()]);return Buffer.concat([iv,c.getAuthTag(),body]).toString('base64');};
  const unseal=value=>{const b=Buffer.from(value,'base64'),c=createDecipheriv('aes-256-gcm',key,b.subarray(0,12));c.setAuthTag(b.subarray(12,28));return JSON.parse(Buffer.concat([c.update(b.subarray(28)),c.final()]).toString());};
  function store(scope){return {
    async get(name,{type}={}){const image=scope==='jobs'&&name.match(/^([a-f0-9]{64})\/image-(\d+)$/);const row=image?db.prepare('SELECT bytes AS value FROM images WHERE id=?').get(`${image[1]}-${image[2]}`):db.prepare('SELECT value FROM entries WHERE scope=? AND key=?').get(scope,name);if(!row)return null;const b=Buffer.from(row.value);return type==='json'?JSON.parse(b.toString()):type==='arrayBuffer'?Uint8Array.from(b).buffer:b.toString();},
    async set(name,value,{onlyIfNew}={}){const result=db.prepare(onlyIfNew?'INSERT OR IGNORE INTO entries VALUES (?,?,?)':'INSERT OR REPLACE INTO entries VALUES (?,?,?)').run(scope,name,Buffer.from(value));return {modified:result.changes>0};},
    async setJSON(name,value,options){return this.set(name,JSON.stringify(value),options);},
    async delete(name){db.prepare('DELETE FROM entries WHERE scope=? AND key=?').run(scope,name);}
  };}
  const config=store('config');
  return {db,store,
    async settings(){return await config.get('settings',{type:'json'})||{templates:null,models:{}};},
    async saveSettings(value){await config.setJSON('settings',value);},
    async keys(){const value=await config.get('keys');return value?unseal(value):{};},
    async saveKeys(value){await config.set('keys',seal(value));},
    images(){return db.prepare('SELECT metadata FROM images ORDER BY rowid DESC').all().map(r=>JSON.parse(r.metadata));},
    image(id){return db.prepare('SELECT mime,bytes FROM images WHERE id=?').get(id);},
    addImage(meta,mime,bytes){db.prepare('INSERT OR IGNORE INTO images VALUES (?,?,?,?)').run(meta.id,JSON.stringify(meta),mime,bytes);},
    deleteImage(id){db.prepare('DELETE FROM images WHERE id=?').run(id);},
    close(){db.close();}
  };
}
