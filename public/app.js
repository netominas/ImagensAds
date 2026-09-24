import {providers,formats,presets,composePrompt,cropRect} from './core.js';
import {requireAccess,secureFetch} from './access.js';
const account=await requireAccess();
if(!account)throw new Error('Sessão necessária.');
const $=id=>document.getElementById(id);
const storageResponse=await secureFetch('/api/data/settings');
const remote=storageResponse.ok;
if(!remote&&storageResponse.status!==404)throw new Error('Não foi possível carregar os dados do servidor.');
const serverSettings=remote?await storageResponse.json():null;
let configuredKeys=serverSettings?.configuredKeys||{};
async function api(path,method='GET',body){const response=await secureFetch('/api/data/'+path,{method,...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});if(!response.ok){let data;try{data=await response.json();}catch{}throw new Error(data?.error||'Não foi possível salvar no servidor.');}return response.json();}
if(remote){document.querySelector('#page-gallery .page-heading p').textContent='Imagens armazenadas na sua conta. Acesse, recorte e baixe em qualquer dispositivo.';document.querySelector('#page-settings .info-banner').textContent='As chaves são armazenadas criptografadas no servidor e usadas apenas para chamar a IA selecionada. Campos vazios preservam a chave salva.';}
$('account-label').textContent=account.email;
window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
window.addEventListener('storage',event=>{if(event.key==='adstudio-logout')location.replace('/');});
window.addEventListener('focus',()=>{void requireAccess();});
$('logout').onclick=async()=>{
  $('logout').disabled=true;
  try{
    const response=await fetch('/api/logout',{method:'POST'});
    if(!response.ok)throw new Error('Não foi possível encerrar a sessão. Tente novamente.');
    keys={};
    try{sessionStorage.removeItem('adstudio-active-job');localStorage.setItem('adstudio-logout',String(Date.now()));}catch{}
    document.body.replaceChildren();location.replace('/');
  }catch(error){toast(error.message);$('logout').disabled=false;}
};
const escapeHTML=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}};
let templates=serverSettings?.templates||read('adstudio-prompts',presets);
if(!Array.isArray(templates)||!templates.length||templates.some(p=>!p.id||typeof p.prompt!=='string'||typeof p.name!=='string'))templates=structuredClone(presets);
let models=serverSettings?.models||read('adstudio-models',{}),keys={},provider='gemini',count=1,images=[],currentResults=[],busy=false,editingId=null,cropImage=null,cropItem=null,exportBlob=null,exportVersion=0;
const toast=message=>{$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').hidden=true,4500);};
async function saveLocal(key,value){try{if(remote){await api('settings','PUT',{[key==='adstudio-prompts'?'templates':'models']:value});return true;}localStorage.setItem(key,JSON.stringify(value));return true;}catch{toast('Não foi possível salvar. Verifique a conexão e tente novamente.');return false;}}
function page(name){document.querySelectorAll('.page').forEach(el=>el.hidden=el.id!==`page-${name}`);document.querySelectorAll('.nav-item').forEach(el=>el.classList.toggle('active',el.dataset.page===name));$('breadcrumb').textContent={generator:'Gerar criativos',library:'Biblioteca de prompts',gallery:'Minhas imagens',settings:'Configurações'}[name];window.scrollTo({top:0,behavior:'smooth'});}
document.querySelectorAll('[data-page]').forEach(el=>el.addEventListener('click',()=>page(el.dataset.page)));
$('open-settings').onclick=()=>page('settings');$('manage-prompts').onclick=()=>page('library');
document.querySelectorAll('[data-close]').forEach(el=>el.onclick=()=>$(el.dataset.close).close());
function renderProviders(){
  $('provider-options').innerHTML=Object.entries(providers).map(([id,p])=>`<button type="button" class="provider-option ${provider===id?'selected':''}" data-provider="${id}" aria-pressed="${provider===id}"><span class="provider-icon">${p.icon}</span><strong>${p.name}</strong><small>${p.company}</small></button>`).join('');
  $('provider-options').querySelectorAll('button').forEach(el=>el.onclick=()=>{provider=el.dataset.provider;renderProviders();});
  $('provider-hint').textContent=(keys[provider]||configuredKeys[provider])?'✓ Chave configurada':'◈ Configure sua chave de API para começar.';
}
renderProviders();
const links={gemini:'https://aistudio.google.com/apikey',openai:'https://platform.openai.com/api-keys',grok:'https://console.x.ai/'};
$('settings-providers').innerHTML=Object.entries(providers).map(([id,p])=>`<section class="panel provider-settings"><h2><span>${p.icon}</span> ${p.name} <small class="muted">${p.company}</small></h2><p>Conecte sua conta com uma <a href="${links[id]}" target="_blank" rel="noopener noreferrer">chave de API ↗</a>.</p><label for="key-${id}">Chave de API</label><div class="key-field"><input type="password" id="key-${id}" autocomplete="off" spellcheck="false" placeholder="Cole sua chave aqui"><button type="button" class="button light" data-reveal="${id}" aria-label="Mostrar chave ${p.name}">Mostrar</button></div><label for="model-${id}">Modelo de geração de imagens</label><input id="model-${id}" value="${escapeHTML(models[id]||p.model)}" required pattern="[a-zA-Z0-9._-]{1,100}" maxlength="100" spellcheck="false"><p class="hint">O modelo precisa estar disponível na sua conta. A cobrança é feita pelo provedor.</p></section>`).join('');
document.querySelectorAll('[data-reveal]').forEach(button=>button.onclick=()=>{const field=$(`key-${button.dataset.reveal}`);field.type=field.type==='password'?'text':'password';button.textContent=field.type==='password'?'Mostrar':'Ocultar';});
$('settings-form').onsubmit=async e=>{e.preventDefault();const nextModels={},newKeys={};Object.keys(providers).forEach(id=>{const value=$('key-'+id).value.trim();if(value)newKeys[id]=value;nextModels[id]=$('model-'+id).value.trim();});try{if(remote){await api('settings','PUT',{models:nextModels,keys:newKeys});Object.keys(newKeys).forEach(id=>{configuredKeys[id]=true;$('key-'+id).value='';});}else{keys=newKeys;await saveLocal('adstudio-models',nextModels);}models=nextModels;renderProviders();$('settings-message').textContent=remote?'Configurações salvas no servidor.':'Configurações aplicadas a esta aba.';toast('Configurações salvas.');}catch(error){toast(error.message);}};
function renderTemplates(){
  const selected=$('preset').value;
  $('preset').innerHTML=templates.map(p=>`<option value="${escapeHTML(p.id)}">${escapeHTML(p.name)}</option>`).join('');
  if(templates.some(p=>p.id===selected))$('preset').value=selected;
  $('prompt-library').innerHTML=templates.map(p=>`<article class="panel prompt-card"><span class="preset-icon">${escapeHTML(p.icon||'✧')}</span><h3>${escapeHTML(p.name)}</h3><p>${escapeHTML(p.description||'Seu estilo personalizado.')}</p><div class="prompt-excerpt">${escapeHTML(p.prompt)}</div><div class="image-actions"><button class="button light" data-edit="${escapeHTML(p.id)}">Editar prompt</button><button class="button light" data-use="${escapeHTML(p.id)}">Usar estilo ↗</button><button class="icon-button" data-delete="${escapeHTML(p.id)}" aria-label="Excluir ${escapeHTML(p.name)}">×</button></div></article>`).join('');
  $('prompt-library').querySelectorAll('[data-edit]').forEach(el=>el.onclick=()=>editPrompt(el.dataset.edit));
  $('prompt-library').querySelectorAll('[data-use]').forEach(el=>el.onclick=()=>{$('preset').value=el.dataset.use;updatePrompt();page('generator');});
  $('prompt-library').querySelectorAll('[data-delete]').forEach(el=>el.onclick=async()=>{if(templates.length===1)return toast('Mantenha pelo menos um prompt na biblioteca.');const next=templates.filter(p=>p.id!==el.dataset.delete);if(!await saveLocal('adstudio-prompts',next))return;templates=next;renderTemplates();});
  updatePrompt();
}
function editPrompt(id){editingId=id;const p=templates.find(p=>p.id===id);$('prompt-dialog-title').textContent=p?'Editar prompt':'Novo prompt';$('prompt-name').value=p?.name||'';$('prompt-description').value=p?.description||'';$('prompt-content').value=p?.prompt||'Crie uma imagem publicitária sobre: {{tema}}. ';$('prompt-dialog').showModal();}
$('new-prompt').onclick=()=>editPrompt(null);
$('prompt-form').onsubmit=async e=>{e.preventDefault();if(!$('prompt-name').value.trim()||!$('prompt-content').value.trim())return toast('Preencha o nome e o prompt.');const p={id:editingId||crypto.randomUUID(),name:$('prompt-name').value.trim(),description:$('prompt-description').value.trim(),prompt:$('prompt-content').value.trim(),icon:templates.find(p=>p.id===editingId)?.icon||'✧'};const next=editingId?templates.map(t=>t.id===editingId?p:t):[...templates,p];if(!await saveLocal('adstudio-prompts',next))return;templates=next;renderTemplates();$('prompt-dialog').close();toast('Prompt salvo na biblioteca.');};
const formatOptions=formats.map((f,i)=>`<option value="${i}">${f.w} × ${f.h} · ${f.label} (${f.channel})</option>`).join('');
$('format').innerHTML=formatOptions+'<option value="custom">Tamanho personalizado</option>';
function dimensions(){return $('format').value==='custom'?{w:Number($('width').value),h:Number($('height').value)}:formats[Number($('format').value)];}
function validDimensions({w,h}){return [w,h].every(n=>Number.isInteger(n)&&n>=32&&n<=4096);}
function updatePrompt(){const d=dimensions();const custom=$('format').value==='custom';$('custom-dimensions').hidden=!custom;$('width').disabled=!custom;$('height').disabled=!custom;$('format-size').textContent=`${d.w} × ${d.h} px`;$('theme-counter').textContent=`${$('theme').value.length}/3000`;$('prompt-preview').textContent=composePrompt(templates.find(p=>p.id===$('preset').value)?.prompt||'', $('theme').value.trim()||'[seu tema]', $('extra').value.trim(),d.w,d.h,$('allow-text').checked);}
['preset','theme','extra','format','width','height','allow-text'].forEach(id=>$(id).addEventListener('input',updatePrompt));
renderTemplates();
function renderCount(){$('quantity-options').innerHTML=[1,2,3,4].map(n=>`<button type="button" class="${n===count?'selected':''}" aria-pressed="${n===count}" aria-label="Gerar ${n} ${n===1?'imagem':'imagens'}">${n}</button>`).join('');$('quantity-options').querySelectorAll('button').forEach(el=>el.onclick=()=>{count=Number(el.textContent);renderCount();});}renderCount();
const dbPromise=remote?null:new Promise((resolve,reject)=>{const req=indexedDB.open('adstudio-images',1);req.onupgradeneeded=()=>req.result.createObjectStore('images',{keyPath:'id'});req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
async function dbAction(mode,action){const db=await dbPromise;return new Promise((resolve,reject)=>{const tx=db.transaction('images',mode);const req=action(tx.objectStore('images'));tx.oncomplete=()=>resolve(req.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}
function hydrate(item){return {...item,url:URL.createObjectURL(item.blob)};}
async function addImage(item){if(remote){const base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=reject;reader.readAsDataURL(item.blob);});const meta=await api('images','POST',{id:item.id,theme:item.theme,mime:item.blob.type,base64});const saved={...meta,url:'/api/data/images/'+meta.id};images.unshift(saved);renderImages();return saved;}try{await dbAction('readwrite',s=>s.put(item));}catch{toast('Imagem disponível nesta sessão, mas sem espaço para salvar no navegador. Baixe agora.');}const hydrated=hydrate(item);images.unshift(hydrated);renderImages();return hydrated;}
async function loadImages(){try{if(remote){images=(await api('images')).map(item=>({...item,url:'/api/data/images/'+item.id}));renderImages();return;}images=(await dbAction('readonly',s=>s.getAll())).sort((a,b)=>b.created-a.created).map(hydrate);renderImages();}catch{toast('Não foi possível carregar a galeria. Recarregue para tentar novamente.');}}await loadImages();
function card(item){return `<article class="image-card"><img src="${item.url}" alt="${escapeHTML(item.theme)}" loading="lazy"><div class="image-card-body"><strong>${escapeHTML(item.theme)}</strong><p>${escapeHTML(providers[item.provider]?.name||'Importada')} · ${item.w} × ${item.h} px · ${new Date(item.created).toLocaleDateString('pt-BR')}</p>${item.prompt?`<details><summary>Ver prompt e modelo</summary><p>${escapeHTML(item.model||'')}</p><p style="white-space:pre-wrap;overflow-wrap:anywhere">${escapeHTML(item.prompt)}</p></details>`:''}<div class="image-actions">${remote?`<a class="button light" href="${item.url}?download=1">Baixar original</a>`:""}<button class="button light" data-crop="${item.id}">⌗ Recortar e baixar</button><button class="icon-button" data-remove="${item.id}" aria-label="Excluir imagem">×</button></div></div></article>`;}
function renderImages(){
  $('gallery-count').textContent=images.length;$('result-count').textContent=currentResults.length;$('gallery-empty').hidden=images.length>0;
  $('empty-results').hidden=currentResults.length>0||busy;
  $('gallery').innerHTML=images.map(card).join('');$('results').innerHTML=images.filter(i=>currentResults.includes(i.id)).map(card).join('');
  document.querySelectorAll('[data-crop]').forEach(el=>el.onclick=()=>openCrop(images.find(i=>i.id===el.dataset.crop)));
  document.querySelectorAll('[data-remove]').forEach(el=>el.onclick=async()=>{const item=images.find(i=>i.id===el.dataset.remove);try{if(remote){if(!confirm('Excluir esta imagem do servidor? Esta ação não pode ser desfeita.'))return;await api('images/'+item.id,'DELETE');}else await dbAction('readwrite',s=>s.delete(item.id));}catch{return toast('Não foi possível excluir esta imagem.');}URL.revokeObjectURL(item.url);images=images.filter(i=>i.id!==item.id);currentResults=currentResults.filter(id=>id!==item.id);renderImages();});
}
function status(message,error=false){$('generation-status').hidden=false;$('generation-status').textContent=message;$('generation-status').classList.toggle('error',error);}
function setBusy(value){busy=value;$('generate').disabled=value;$('generate').textContent=value?'✦ Criando suas imagens…':'✦ Gerar criativos →';document.querySelector('.live-label').textContent=value?'◌ Criando…':'• Pronto para criar';renderImages();}
function token(){return [...crypto.getRandomValues(new Uint8Array(32))].map(n=>n.toString(16).padStart(2,'0')).join('');}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function pollJob(job){
  const received=new Set(images.filter(i=>i.jobToken===job.token).map(i=>i.index));
  currentResults=images.filter(i=>i.jobToken===job.token).map(i=>i.id);
  let failedPolls=0;
  while(Date.now()-job.created<14*60*1000){
    try {
      const res=await secureFetch('/.netlify/functions/job',{headers:{'x-job-token':job.token},signal:AbortSignal.timeout(20000)});
      if(!res.ok)throw new Error(res.status===410?'Esta geração expirou.':'Não foi possível consultar a geração.');
      const state=await res.json();failedPolls=0;
      if(remote){await loadImages();for(const item of images.filter(i=>i.jobToken===job.token)){received.add(item.index);if(!currentResults.includes(item.id))currentResults.push(item.id);}renderImages();}
      for(const result of state.images||[])if(!remote&&!received.has(result.index)){
        const response=await secureFetch(`/.netlify/functions/job?image=${result.index}`,{headers:{'x-job-token':job.token},signal:AbortSignal.timeout(30000)});
        if(!response.ok)throw new Error('Não foi possível recuperar uma imagem.');
        const item=await addImage({id:`${job.token}-${result.index}`,jobToken:job.token,index:result.index,blob:await response.blob(),theme:job.theme,provider:job.provider,w:job.w,h:job.h,created:Date.now()});
        currentResults.push(item.id);received.add(result.index);renderImages();
      }
      const errors=state.errors||[];
      status(`${received.size} de ${job.count} imagens prontas.${state.status!=='done'?' A IA está trabalhando; você pode navegar pelo estúdio.':''}${errors.length?' '+errors.map(e=>`Imagem ${e.index+1}: ${e.message}`).join(' '):''}`,errors.length>0);
      if(state.status==='done'){sessionStorage.removeItem('adstudio-active-job');return;}
      if(state.status==='pending'&&Date.now()-job.created>60000)status('A geração ainda não iniciou. Aguarde ou confira o status do servidor.',true);
    }catch(e){failedPolls++;status(`${e.message} Tentando reconectar (${failedPolls})…`,true);if(failedPolls>=8)throw new Error('A conexão foi interrompida. Recarregue esta aba para consultar a geração; não inicie outra para evitar cobranças duplicadas.');}
    await delay(2500);
  }
  sessionStorage.removeItem('adstudio-active-job');throw new Error('O tempo de acompanhamento terminou. A geração pode ter sido interrompida. Confira o consumo no provedor antes de tentar novamente.');
}
$('generation-form').onsubmit=async e=>{
  e.preventDefault();if(busy)return;
  if(!await requireAccess())return;
  try{const active=JSON.parse(sessionStorage.getItem('adstudio-active-job'));if(active&&Date.now()-active.created<14*60*1000){setBusy(true);try{await pollJob(active);}catch(e){status(e.message,true);}finally{setBusy(false);}return;}}catch{}
  if(!keys[provider]&&!configuredKeys[provider]){page('settings');$(`key-${provider}`).focus();return toast('Insira a chave da IA selecionada.');}
  const {w,h}=dimensions();if(!validDimensions({w,h}))return toast('Use dimensões inteiras entre 32 e 4096 pixels.');
  if(!$('theme').value.trim())return toast('Descreva o que deseja criar.');
  if(!remote&&(keys[provider].length<10||keys[provider].length>1024||/[\r\n]/.test(keys[provider])))return toast('Verifique a chave de API em Configurações.');
  const job={token:token(),theme:$('theme').value.trim(),provider,w,h,count,created:Date.now()};
  setBusy(true);currentResults=[];renderImages();status('Enviando seu briefing para a IA…');
  try{
    sessionStorage.setItem('adstudio-active-job',JSON.stringify(job));
    const res=await fetch('/.netlify/functions/generate-background',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:job.token,theme:job.theme,provider,model:models[provider]||providers[provider].model,apiKey:keys[provider],prompt:$('prompt-preview').textContent,width:w,height:h,count}),signal:AbortSignal.timeout(20000)});
    if(res.status!==202){if(res.status>=400&&res.status<500)sessionStorage.removeItem('adstudio-active-job');let data;try{data=await res.json();}catch{}throw new Error(data?.error||`Não foi possível confirmar o início da geração (HTTP ${res.status}).`);}
    await pollJob(job);
  }catch(e){status(`${e.message} Se o envio já começou, clique em Gerar para retomar o acompanhamento do mesmo lote.`,true);}finally{setBusy(false);}
};
$('upload').onchange=async e=>{const file=e.target.files[0];if(!file)return;if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>20*1024*1024){e.target.value='';return toast('Selecione JPG, PNG ou WebP de até 20 MB.');}try{const bitmap=await createImageBitmap(file);if(bitmap.width*bitmap.height>40000000){bitmap.close();throw new Error('Use uma imagem de até 40 megapixels.');}await addImage({id:crypto.randomUUID(),blob:file,theme:file.name,provider:'upload',w:1080,h:1080,created:Date.now()});bitmap.close();toast('Imagem importada. Pronta para recortar.');}catch(e){toast(e.message||'Não foi possível abrir a imagem.');}e.target.value='';};
async function openCrop(item){cropItem=item;cropImage=new Image();cropImage.src=item.url;try{await cropImage.decode();}catch{return toast('Não foi possível abrir esta imagem.');}$('crop-format').innerHTML=`<option value="original">${item.w} × ${item.h} · Formato escolhido</option>`+formatOptions;resetCrop();$('crop-dialog').showModal();}
function resetCrop(){$('crop-zoom').value=1;$('crop-x').value=.5;$('crop-y').value=.5;drawCrop();}
function drawCrop(){if(!cropImage)return;const size=$('crop-format').value==='original'?cropItem:formats[Number($('crop-format').value)];const {w,h}=size;const canvas=$('crop-canvas');canvas.width=w;canvas.height=h;const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);const r=cropRect(cropImage.naturalWidth,cropImage.naturalHeight,w,h,Number($('crop-zoom').value),Number($('crop-x').value),Number($('crop-y').value));ctx.imageSmoothingQuality='high';ctx.drawImage(cropImage,r.sx,r.sy,r.sw,r.sh,0,0,w,h);$('quality-value').textContent=`${Math.round(Number($('export-quality').value)*100)}%`;$('export-quality').disabled=$('export-type').value==='image/png';exportBlob=null;$('download-crop').disabled=true;const version=++exportVersion;canvas.toBlob(blob=>{if(version!==exportVersion)return;exportBlob=blob;$('download-crop').disabled=!blob;$('export-info').textContent=blob?`${w} × ${h} px · ${(blob.size/1024).toFixed(0)} KB${blob.size>150*1024?' · Verifique o limite de peso do posicionamento.':''}`:'Não foi possível preparar o download.';},$('export-type').value,Number($('export-quality').value));}
['crop-format','crop-zoom','crop-x','crop-y','export-type','export-quality'].forEach(id=>$(id).addEventListener('input',drawCrop));$('reset-crop').onclick=resetCrop;
$('download-crop').onclick=()=>{if(!exportBlob)return;const canvas=$('crop-canvas');const url=URL.createObjectURL(exportBlob);const a=document.createElement('a');a.href=url;a.download=`adstudio-${canvas.width}x${canvas.height}-${cropItem.id.slice(0,8)}.${{'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[exportBlob.type]||'png'}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);toast('Download preparado no tamanho exato.');};
try{const active=JSON.parse(sessionStorage.getItem('adstudio-active-job'));if(active&&Date.now()-active.created<14*60*1000){setBusy(true);pollJob(active).catch(e=>status(e.message,true)).finally(()=>setBusy(false));}}catch{}
