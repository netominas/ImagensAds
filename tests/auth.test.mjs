import test from 'node:test';
import assert from 'node:assert/strict';
import {hashPassword,verifyPassword,login,logout,getSession,requireSession,sessionStatus,digest} from '../lib/auth.mjs';
import {memoryStore} from '../lib/memory-store.mjs';
import {createAppServer} from '../server.mjs';
const password='test-only-password-not-for-production';
const env={ADMIN_EMAIL:'admin@example.test',ADMIN_PASSWORD_HASH:await hashPassword(password)};
const makeRequest=(path='/api/login',body={email:env.ADMIN_EMAIL,password},headers={})=>new Request(`https://studio.example${path}`,{method:'POST',headers:{Origin:'https://studio.example','Content-Type':'application/json',...headers},body:JSON.stringify(body)});
const cookieFrom=response=>response.headers.get('set-cookie').split(';')[0];

test('passwords use a salted slow hash, reject wrong passwords and invalid setup',async()=>{
  assert.equal(await verifyPassword(password,env.ADMIN_PASSWORD_HASH),true);
  assert.equal(await verifyPassword('wrong',env.ADMIN_PASSWORD_HASH),false);
  assert.equal(await verifyPassword(password,'invalid'),false);
  assert.notEqual(await hashPassword(password),env.ADMIN_PASSWORD_HASH);
  await assert.rejects(hashPassword('short'));
});
test('login fails closed without configuration and hides which credential was wrong',async()=>{
  const store=memoryStore();
  assert.equal((await login(makeRequest(),store,{env:{}})).status,503);
  assert.equal((await requireSession(new Request('https://studio.example/job'),store,{})).status,503);
  const wrongPassword=await login(makeRequest('/api/login',{email:env.ADMIN_EMAIL,password:'wrong'}),store,{env});
  const wrongEmail=await login(makeRequest('/api/login',{email:'other@example.test',password}),store,{env});
  assert.equal(wrongPassword.status,401);assert.deepEqual(await wrongPassword.json(),await wrongEmail.json());
});
test('sessions use secure HttpOnly cookies and only token hashes are stored',async()=>{
  const store=memoryStore(),response=await login(makeRequest(),store,{env});
  assert.equal(response.status,200);
  assert.match(response.headers.get('set-cookie'),/^__Host-adstudio_session=[a-f0-9]{64}; Path=\/; HttpOnly; SameSite=Strict; Max-Age=28800; Secure$/);
  const cookie=cookieFrom(response),token=cookie.split('=')[1];
  const request=new Request('https://studio.example/api/session',{headers:{Cookie:cookie}});
  assert.equal((await getSession(request,store,env)).email,env.ADMIN_EMAIL);
  assert.equal((await sessionStatus(request,store,env)).status,200);
  assert.equal(await store.get(`sessions/${token}`),null);
  const saved=await store.get(`sessions/${digest(token)}`,{type:'json'});
  assert.equal(JSON.stringify(saved).includes(token),false);
  assert.equal(JSON.stringify(saved).includes(password),false);
  const badCookie=new Request(request.url,{headers:{Cookie:'__Host-adstudio_session='+'a'.repeat(64)}});
  assert.equal((await requireSession(badCookie,store,env)).status,401);
  assert.equal(await getSession(request,store,{...env,ADMIN_EMAIL:'new@example.test'}),null);
  await store.setJSON(`sessions/${digest(token)}`,{...saved,expires:Date.now()-1});
  assert.equal(await getSession(request,store,env),null);
});
test('logout revokes session on server, and cross-origin login/logout are denied',async()=>{
  const store=memoryStore(),response=await login(makeRequest(),store,{env}),cookie=cookieFrom(response);
  const request=new Request('https://studio.example/api/session',{headers:{Cookie:cookie}});
  assert.equal((await login(makeRequest('/api/login',{}, {Origin:'https://evil.example'}),store,{env})).status,403);
  assert.equal((await logout(makeRequest('/api/logout',{}, {Origin:'https://evil.example',Cookie:cookie}),store)).status,403);
  assert.ok(await getSession(request,store,env));
  const result=await logout(makeRequest('/api/logout',{}, {Cookie:cookie}),store);
  assert.equal(result.status,200);assert.match(result.headers.get('set-cookie'),/Max-Age=0/);
  assert.equal(await getSession(request,store,env),null);
});
test('atomic login slots bound concurrent attempts across instances',async()=>{
  const store=memoryStore();
  const results=await Promise.all(Array.from({length:12},()=>login(makeRequest('/api/login',{email:env.ADMIN_EMAIL,password:'wrong'}),store,{env,ip:'test-client'})));
  assert.equal(results.filter(r=>r.status===401).length,8);
  assert.equal(results.filter(r=>r.status===429).length,4);
  assert.ok(results.find(r=>r.status===429).headers.has('Retry-After'));
});
test('HTTP server protects studio, direct function URLs and generation before provider calls',async()=>{
  let calls=0;
  const server=createAppServer({env,generate:async()=>{calls++;return {base64:Buffer.from('image').toString('base64'),mime:'image/png'};}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  try{
    for(const path of ['/studio','/.netlify/functions/studio']){
      const response=await fetch(base+path,{redirect:'manual'});assert.equal(response.status,303);assert.equal(response.headers.get('location'),'/');
    }
    for(const path of ['/.netlify/functions/job','/api/session','/.netlify/functions/session'])assert.equal((await fetch(base+path)).status,401);
    assert.equal((await fetch(base+'/private/studio.html')).status,404);
    assert.equal((await fetch(base+'/studio.html')).status,404);
    const payload={provider:'gemini',apiKey:'test-not-real-key',model:'test-model',prompt:'test',width:300,height:250,count:1,token:'c'.repeat(64)};
    const options={method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify(payload)};
    assert.equal((await fetch(base+'/.netlify/functions/generate-background',options)).status,401);assert.equal(calls,0);
    const logged=await fetch(base+'/api/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({email:env.ADMIN_EMAIL,password})});
    const cookie=cookieFrom(logged);
    const studio=await fetch(base+'/studio',{headers:{Cookie:cookie}});assert.equal(studio.status,200);assert.match(await studio.text(),/id="logout"/);assert.equal(studio.headers.get('cache-control'),'private, no-store');
    assert.equal((await fetch(base+'/.netlify/functions/generate-background',{...options,headers:{...options.headers,Cookie:cookie}})).status,202);
    const query=await fetch(base+'/.netlify/functions/job',{headers:{Cookie:cookie,'x-job-token':payload.token}});assert.equal(query.status,200);assert.equal(calls,1);
    await fetch(base+'/api/logout',{method:'POST',headers:{Origin:base,Cookie:cookie}});
    assert.equal((await fetch(base+'/.netlify/functions/job',{headers:{Cookie:cookie,'x-job-token':payload.token}})).status,401);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
