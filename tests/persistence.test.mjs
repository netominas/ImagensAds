import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStorage} from '../lib/persistent.mjs';
import {createAppServer} from '../server.mjs';

test('persistent storage encrypts keys, survives reopen and deletes image bytes',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'adstudio-'));let s;
 try{s=openStorage(dir,'a'.repeat(64));await s.saveKeys({gemini:'test-key-not-plaintext'});await s.saveSettings({templates:[{id:'a',name:'A',prompt:'B'}],models:{}});s.addImage({id:'abc',theme:'Teste'},'image/png',Buffer.from([1,2,3]));s.close();s=openStorage(dir,'a'.repeat(64));assert.equal((await s.keys()).gemini,'test-key-not-plaintext');assert.equal(s.images().length,1);assert.equal((await s.settings()).templates[0].name,'A');assert.equal((await readFile(join(dir,'adstudio.sqlite'))).includes(Buffer.from('test-key-not-plaintext')),false);s.deleteImage('abc');assert.equal(s.image('abc'),undefined);assert.equal(s.images().length,0);}finally{s?.close();await rm(dir,{recursive:true,force:true});}
});
test('VPS activation is single-use; data is authenticated and HTTPS cookies survive restart',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'adstudio-')),storage=openStorage(dir,'b'.repeat(64));
 const env={APP_ORIGIN:'https://studio.example',SETUP_TOKEN:'c'.repeat(64)};
 const server=createAppServer({env,storage,authStore:storage.store('auth'),jobStore:storage.store('jobs')});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const send=(path,body,cookie,method='POST')=>fetch(base+path,{method,headers:{Origin:env.APP_ORIGIN,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});
 try{
  assert.equal((await fetch(base+'/api/data/images')).status,503);
  assert.equal((await send('/api/activate',{token:'wrong',email:'test@example.com',password:'a'.repeat(16)})).status,403);
  assert.equal((await send('/api/activate',{token:env.SETUP_TOKEN,email:'test@example.com',password:'a'.repeat(16)})).status,200);
  assert.equal((await send('/api/activate',{})).status,403);
  assert.equal((await fetch(base+'/api/data/images')).status,401);
  const login=await send('/api/login',{email:'test@example.com',password:'a'.repeat(16)});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie');assert.match(cookie,/Secure/);
  assert.equal((await send('/api/data/settings',{keys:{gemini:'fake-key-123456'}},cookie,'PUT')).status,200);
  const settings=await send('/api/data/settings',null,cookie,'GET');const data=await settings.json();assert.equal(data.configuredKeys.gemini,true);assert.equal(JSON.stringify(data).includes('fake-key'),false);
  const uploaded=await send('/api/data/images',{id:'test-image',mime:'image/png',base64:'AQID',theme:'test'},cookie);assert.equal(uploaded.status,201);
  assert.equal((await send('/api/data/images/test-image',null,cookie,'GET')).status,200);
  assert.equal((await send('/api/data/images/test-image',null,cookie,'DELETE')).status,200);
  assert.equal((await send('/api/data/images/test-image',null,cookie,'GET')).status,404);
 }finally{await new Promise(r=>server.close(r));storage.close();await rm(dir,{recursive:true,force:true});}
});
