import {secureFetch} from '/access.js';
import './session.js';
import {providers} from '/apps/criativos/core.js';
import {textModels} from '/apps/criativos/copy-core.js';
const byId=id=>document.getElementById(id);
const html=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const studio={csrf:'',configured:false,accounts:[],draft:null,dirty:false,busy:false};
const labels={DRAFT:'Rascunho',VALIDATED:'Validada · pronta para criar',PUBLISHING:'Criação em andamento',CREATED:'Criada · pausada',UNKNOWN:'Conferir criação no Google Ads'};
const fields={account_id:'create-account',type:'campaign-type',business_name:'business-name',name:'campaign-name',theme:'theme',url:'destination',budget:'daily-budget',cpc_bid:'max-cpc',bidding_strategy:'bidding-strategy',target_cpa:'target-cpa',country:'country',language:'language',context:'context',long_headline:'long-headline',image_prompt:'image-prompt'};
const lines=id=>byId(id).value.split('\n').map(t=>t.trim()).filter(Boolean);
const cid=id=>String(id).replace(/^(\d{3})(\d{3})(\d{4})$/,'$1-$2-$3');
const account=()=>studio.accounts.find(a=>a.id===byId('create-account').value);
const cash=value=>Number.isFinite(Number(value))&&value!==''?new Intl.NumberFormat('pt-BR',{style:'currency',currency:account()?.currency||studio.draft?.payload.currency||'BRL'}).format(Number(value)):'—';
function message(value=''){byId('creator-notice').textContent=value;byId('creator-notice').hidden=!value;}
async function call(path,body){
 const options=body?{method:'POST',headers:{'Content-Type':'application/json','X-Publisher-CSRF':studio.csrf},body:JSON.stringify(body)}:{};
 const response=await secureFetch(path,options);const data=await response.json();
 if(!response.ok)throw Error([data.error,...(data.details||[]).map(e=>`${e.message}${e.field?' ('+e.field+')':''}`)].join('\n'));
 return data;
}
function payload(){const p={};for(const [key,id]of Object.entries(fields))p[key]=byId(id).value;for(const key of ['budget','cpc_bid','target_cpa'])p[key]=p[key]===''?null:Number(p[key]);p.political=byId('political').checked;for(const key of ['headlines','descriptions','keywords','negatives'])p[key]=lines(key);p.policy_notes=studio.draft?.payload.policy_notes||[];return p;}
function editable(){return !['CREATED','PUBLISHING','UNKNOWN'].includes(studio.draft?.status);}
function updateControls(){
 const d=studio.draft;byId('draft-state').textContent=(d?labels[d.status]:'Novo briefing')+(studio.dirty?' · alterações locais':'');
 document.querySelectorAll('.journey>span').forEach((e,i)=>e.classList.toggle('current',i===(d?.status==='CREATED'?2:d?.payload.headlines?.length?1:0)));
 byId('generate-copy').disabled=studio.busy||!studio.configured||!editable();byId('generate-image').disabled=studio.busy||!studio.configured||!d||!editable();
 for(const id of ['save-brief','save-copy','validate-draft'])byId(id).disabled=studio.busy||!editable();
 byId('publish-draft').disabled=studio.busy||!d||d.status!=='VALIDATED'||studio.dirty;
 byId('image-upload').disabled=studio.busy||!editable();byId('new-draft').disabled=studio.busy;
 byId('create-account').disabled=studio.busy||!!d?.payload.account_id||!studio.accounts.length;
 byId('publish-description').textContent=d?.status==='CREATED'?'A campanha foi criada pausada. Confira os recursos e a revisão do anúncio no Google Ads.':d?.status==='UNKNOWN'||d?.status==='PUBLISHING'?'O envio precisa ser conferido no Google Ads antes de qualquer nova tentativa.':d?.status==='VALIDATED'&&!studio.dirty?'Configuração validada pelo Google Ads. O próximo botão cria a campanha com status pausado.':'Revise os materiais e valide a configuração para criar a campanha pausada.';
 byId('publish-result').textContent=d?.result?.campaign_resource?`ID da campanha: ${d.result.campaign_resource.split('/').pop()}`:'';
}
function preview(){
 const p=payload(),a=account();byId('summary-account').textContent=a?`${a.name} · ${cid(a.id)}`:'Selecione uma conta';
 byId('summary-budget').textContent=cash(byId('daily-budget').value);byId('summary-cpc').textContent=cash(byId('max-cpc').value);byId('summary-cpa').textContent=cash(byId('target-cpa').value);byId('summary-bidding').textContent=({MANUAL_CPC:'CPC manual',MAXIMIZE_CLICKS:'Maximizar cliques',MAXIMIZE_CONVERSIONS:'Maximizar conversões'})[p.bidding_strategy]||'A definir pelo prompt/revisão';
 byId('currency-label').textContent=a?.currency||'na moeda da conta';byId('bid-currency').textContent=a?.currency||'';
 const display=p.type==='DISPLAY';document.querySelectorAll('.display-field').forEach(e=>e.hidden=!display);document.querySelectorAll('.search-field').forEach(e=>e.hidden=display);
 if(byId('bidding-note'))byId('bidding-note').textContent=byId('summary-bidding').textContent;
 byId('targeting-note').textContent=display?'Display sem público adicional; segmentação otimizada desativada':'Palavras-chave de frase';
 byId('headline-count').textContent=`${p.headlines.length} títulos · ${display?'1 a 5':'3 a 15'} necessários`;
 byId('description-count').textContent=`${p.descriptions.length} descrições · ${display?'1 a 5':'2 a 4'} necessárias`;
 if(p.headlines.length){
  let hostname='seusite.com';try{hostname=new URL(p.url).hostname;}catch{}
  const landscape=studio.draft?.payload.images?.find(i=>i.role==='landscape');
  byId('ad-preview').innerHTML=`<div class="preview-ad"><span class="ad-mark">Patrocinado · prévia</span>${display&&landscape?`<img alt="Imagem paisagem do anúncio" src="${imageUrl(landscape)}">`:''}<div class="ad-brand">${html(p.business_name)}</div><div class="ad-url">${html(hostname)}</div><h3>${html(display?(p.long_headline||p.headlines[0]):p.headlines.slice(0,3).join(' | '))}</h3><p>${html(p.descriptions.slice(0,2).join(' '))}</p></div>`;
 }
 updateControls();
}
function imageUrl(image){return `/apps/google-ads/api/image?${new URLSearchParams({draft:studio.draft.id,name:image.name})}`;}
function showDraft(d){
 studio.draft=d;studio.dirty=false;for(const [key,id]of Object.entries(fields))byId(id).value=d.payload[key]??'';
 byId('political').checked=!!d.payload.political;for(const key of ['headlines','descriptions','keywords','negatives'])byId(key).value=(d.payload[key]||[]).join('\n');
 byId('review').hidden=false;byId('generation-source').textContent=d.payload.generation?`${d.payload.generation.provider} · ${d.payload.generation.model}`:'Rascunho manual';
 const notes=d.payload.policy_notes||[];byId('policy-notes').hidden=!notes.length;byId('policy-notes').innerHTML=`<strong>Observações editoriais da IA · não substituem a revisão das políticas</strong><ul>${notes.map(n=>`<li>${html(n)}</li>`).join('')}</ul>`;
 byId('image-previews').innerHTML=(d.payload.images||[]).map(i=>`<figure><img src="${imageUrl(i)}" alt="Recurso ${i.role==='square'?'quadrado':'paisagem'} para revisão"><figcaption>${i.role==='square'?'Quadrado':'Paisagem'} · ${i.width} × ${i.height}</figcaption></figure>`).join('');
 preview();loadHistory();
}
async function saved(){
 if(!byId('brief-form').reportValidity())throw Error('Confira o formato dos campos preenchidos.');
 if(!studio.draft){const d=await call('/apps/google-ads/api/drafts/new',{payload:payload()});showDraft(d);return d;}
 if(!studio.dirty)return studio.draft;
 const d=await call('/apps/google-ads/api/drafts/save',{id:studio.draft.id,revision:studio.draft.revision,payload:payload()});showDraft(d);return d;
}
async function job(path,body){
 const pending=await call(path,body);
 for(;;){await new Promise(resolve=>setTimeout(resolve,1500));const result=await call('/apps/google-ads/api/job?id='+pending.job_id);if(result.status==='done')return result.result;if(result.status==='error')throw Error(result.error);}
}
async function action(work){
 if(studio.busy)return;studio.busy=true;message();updateControls();
 // Bloqueia os campos durante uma geracao para nao sobrescrever edicoes concorrentes.
 const panel=document.querySelector('.studio-main');panel.inert=true;
 try{await work();}catch(e){message(e.message);}finally{panel.inert=false;studio.busy=false;updateControls();}
}
async function loadHistory(){
 try{const data=await call('/apps/google-ads/api/drafts');byId('draft-history').innerHTML=data.drafts.length?data.drafts.map(d=>`<button class="history-item" data-draft="${d.id}"><strong>${html(d.name)}</strong><small>${html(labels[d.status]||d.status)} · ${cid(d.account_id)}</small></button>`).join(''):'<p>Seus briefings salvos aparecem aqui.</p>';
 byId('draft-history').querySelectorAll('[data-draft]').forEach(b=>b.addEventListener('click',()=>action(async()=>{if(studio.dirty)await saved();showDraft(await call('/apps/google-ads/api/draft?id='+b.dataset.draft));})));}catch(e){byId('draft-history').textContent=e.message;}
}
async function initCreator(){
 try{const [config,available]=await Promise.all([call('/apps/google-ads/api/creator/status'),call('/apps/google-ads/api/accounts')]);studio.csrf=config.csrf;setConnection(config);studio.accounts=available.accounts.filter(a=>a.status==='ENABLED');
 byId('create-account').innerHTML='<option value="">Definir pelo prompt ou selecionar</option>'+studio.accounts.map(a=>`<option value="${a.id}">${html(a.name)} · ${cid(a.id)} · ${a.currency}</option>`).join('');
 byId('create-account').disabled=false;loadHistory();preview();if(!config.configured)byId('settings').open=true;
 }catch(e){message(e.message);byId('create-account').innerHTML='<option value="">Não foi possível carregar contas</option>';}
}
function setConnection(config){studio.configured=config.configured;byId('ai-provider').value=config.provider||'openai';byId('ai-state').textContent=config.configured?'IA configurada':'Chave não configurada';byId('open-settings').textContent=config.configured?'Configurar IA':'Conectar IA';byId('text-model').value=config.text_model;byId('image-model').value=config.image_model;byId('ai-help').textContent=config.configured?`A geração usa ${providers[config.provider].name}, com a chave protegida no cofre do estúdio.`:'Conecte a IA para gerar. Você também pode escrever e salvar os textos manualmente.';updateControls();}
byId('ai-provider').addEventListener('change',()=>{const provider=byId('ai-provider').value;byId('text-model').value=textModels[provider];byId('image-model').value=providers[provider].model;});
byId('open-settings').addEventListener('click',()=>{byId('settings').open=!byId('settings').open;byId('settings').scrollIntoView({behavior:'smooth',block:'start'});});
byId('connect-ai').addEventListener('click',()=>action(async()=>{const config=await call('/apps/google-ads/api/creator/configure',{key:byId('ai-key').value,provider:byId('ai-provider').value,text_model:byId('text-model').value,image_model:byId('image-model').value});byId('ai-key').value='';setConnection(config);byId('settings').open=false;message('Configuração salva. O acesso ao modelo será confirmado na primeira geração.');}));
byId('brief-form').addEventListener('submit',e=>{e.preventDefault();action(async()=>{await saved();message('Briefing salvo. Você já pode gerar ou escrever os materiais.');});});
byId('generate-copy').addEventListener('click',()=>action(async()=>{const d=await saved();message('Interpretando o prompt e preparando a configuração e os materiais…');showDraft(await job('/apps/google-ads/api/drafts/generate',{id:d.id,revision:d.revision,payload:payload(),read_page:byId('read-page').checked}));message('Rascunho gerado. Revise a conta, a configuração, os materiais e as pendências antes de validar.');}));
byId('save-copy').addEventListener('click',()=>action(async()=>{await saved();message('Alterações salvas.');}));
byId('generate-image').addEventListener('click',()=>action(async()=>{const d=await saved();message('Gerando uma imagem e preparando os dois formatos. Aguarde…');showDraft(await job('/apps/google-ads/api/drafts/image',{id:d.id,revision:d.revision}));message('Dois formatos prontos. Confira os recortes na prévia.');}));
byId('image-upload').addEventListener('change',()=>{const file=byId('image-upload').files[0];if(!file)return;action(async()=>{if(file.size>15_000_000)throw Error('Use uma imagem de até 15 MB.');const d=await saved();const encoded=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=()=>reject(Error('Não foi possível ler o arquivo.'));reader.readAsDataURL(file);});showDraft(await call('/apps/google-ads/api/drafts/upload',{id:d.id,revision:d.revision,image:encoded}));byId('image-upload').value='';message('Imagem preparada nos formatos paisagem e quadrado.');});});
byId('validate-draft').addEventListener('click',()=>action(async()=>{const d=await saved();message('Validando a configuração no Google Ads, sem criar recursos…');showDraft(await call('/apps/google-ads/api/drafts/validate',{id:d.id,revision:d.revision}));message('Configuração validada. Confira a conta e os valores no resumo antes de criar a campanha pausada.');}));
byId('publish-draft').addEventListener('click',()=>action(async()=>{if(studio.dirty||studio.draft?.status!=='VALIDATED')throw Error('Salve e valide a versão atual.');const d=studio.draft;message('Criando a campanha pausada no Google Ads…');try{showDraft(await call('/apps/google-ads/api/drafts/publish',{id:d.id,revision:d.revision}));message('Campanha criada pausada. A aprovação dos anúncios será processada pelo Google.');}catch(e){showDraft(await call('/apps/google-ads/api/draft?id='+d.id));throw e;}}));
byId('new-draft').addEventListener('click',()=>action(async()=>{if(studio.dirty&&studio.draft)await saved();studio.draft=null;studio.dirty=false;byId('brief-form').reset();for(const id of ['headlines','descriptions','keywords','negatives','long-headline','image-prompt'])byId(id).value='';byId('review').hidden=true;byId('image-previews').innerHTML='';byId('ad-preview').innerHTML='<div class="preview-placeholder"><span>✧</span><h3>Uma nova ideia começa aqui</h3><p>Preencha o briefing para criar seu próximo anúncio.</p></div>';preview();}));
for(const id of [...Object.values(fields),'political','headlines','descriptions','keywords','negatives'])byId(id).addEventListener('input',()=>{studio.dirty=!!studio.draft;preview();});
initCreator();
