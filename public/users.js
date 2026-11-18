import {requireAccess,secureFetch} from './access.js';
const session=await requireAccess();if(session?.role!=='admin'){location.replace('/apps/roi/');throw Error('Administrador necessário.');}
const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let users=[],accounts=[],whatsappSites=[],editing=null,grants=[],busy=false,campaignToken=0;
async function api(path,body){const r=await secureFetch('/api/users'+path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{}),data=await r.json();if(!r.ok)throw Error(data.error||'Consulta indisponível.');return data;}
function message(text,error=false){$('message').textContent=text;$('message').classList.toggle('error',error);}
function lock(value){busy=value;document.querySelectorAll('button,input,select').forEach(e=>e.disabled=value);}
const accountName=id=>accounts.find(a=>a.id===id)?.name||id;
function permissionSummary(user){
 const permissions=user.role==='finance-reader'?['Finanças · visualização']:user.grants.map(grant=>esc(accountName(grant.account))+' · '+(grant.campaigns===null?'conta inteira':grant.campaigns.length+' campanha(s)'));
 if(user.whatsapp_sites?.length)permissions.push('WhatsApp · '+user.whatsapp_sites.map(esc).join(', '));
 return permissions.join('<br>')||'Sem permissões';
}
function renderUsers(){
 $('users-list').innerHTML=users.length?users.map(u=>`<tr><td><strong>${esc(u.name)}</strong><small>${esc(u.email)}</small></td><td>${permissionSummary(u)}</td><td>${u.active?'Ativo':'Bloqueado'}</td><td><button class="secondary" data-edit-user="${u.id}">Editar acesso</button></td></tr>`).join(''):'<tr><td colspan="4">Nenhum usuário adicional cadastrado.</td></tr>';
 $('users-list').querySelectorAll('[data-edit-user]').forEach(b=>b.onclick=()=>edit(users.find(u=>u.id===b.dataset.editUser)));
}
function renderGrants(){
 $('grants-list').innerHTML=grants.length?grants.map(g=>`<div><span><strong>${esc(accountName(g.account))}</strong><small> · ${esc(g.account)}</small><p>${g.campaigns===null?'Todas as campanhas desta conta':g.campaigns.length+' campanha(s): '+g.campaigns.map(esc).join(', ')}</p></span><span><button type="button" class="secondary" data-edit-grant="${g.account}">Editar</button><button type="button" class="secondary" data-remove-grant="${g.account}">Remover</button></span></div>`).join(''):'<p>Nenhuma conta autorizada.</p>';
 $('grants-list').querySelectorAll('[data-remove-grant]').forEach(b=>b.onclick=()=>{grants=grants.filter(g=>g.account!==b.dataset.removeGrant);renderGrants();});
 $('grants-list').querySelectorAll('[data-edit-grant]').forEach(b=>b.onclick=async()=>{const g=grants.find(g=>g.account===b.dataset.editGrant);$('grant-account').value=g.account;$('grant-scope').value=g.campaigns===null?'all':'campaigns';await loadCampaigns(g.campaigns||[]);});
}
async function loadCampaigns(selected=[]){
 const token=++campaignToken,account=$('grant-account').value;$('campaign-picker').hidden=$('grant-scope').value==='all';$('grant-extra').value='';$('grant-campaigns').replaceChildren();$('campaign-message').textContent='';
 if(!account||$('grant-scope').value==='all')return;
 $('campaign-message').textContent='Carregando campanhas da conta…';
 try{const data=await api('/campaigns?'+new URLSearchParams({account}));if(token!==campaignToken)return;
  const known=new Set();for(const c of data.campaigns){const option=new Option(c.name+' · '+c.id,c.id);option.selected=selected.includes(c.id);$('grant-campaigns').add(option);known.add(c.id);}
  for(const id of selected.filter(id=>!known.has(id))){const option=new Option(id+' · não listada',id);option.selected=true;$('grant-campaigns').add(option);}
  $('campaign-message').textContent=data.campaigns.length+' campanhas disponíveis.';
 }catch(e){if(token===campaignToken){$('campaign-message').textContent=e.message+' Você pode informar os IDs abaixo.';$('grant-extra').value=selected.join(', ');}}
}
function renderWhatsAppAccess(user){
 const permitted=user?.whatsapp_sites||[];
 const sites=[...new Set([...whatsappSites,...permitted])].sort();
 $('whatsapp-access').checked=permitted.length>0;
 $('whatsapp-permissions').hidden=!permitted.length;
 $('whatsapp-extra').value='';
 $('whatsapp-sites').replaceChildren(...sites.map(site=>new Option(site,site,false,permitted.includes(site))));
}
$('whatsapp-access').onchange=()=>{$('whatsapp-permissions').hidden=!$('whatsapp-access').checked;};
function edit(user=null){
 ++campaignToken;editing=user;grants=structuredClone(user?.grants||[]);$('user-form').reset();renderWhatsAppAccess(user);$('user-role').value=user?.role||'reader';$('roi-permissions').hidden=$('user-role').value!=='reader';$('user-name').value=user?.name||'';$('user-email').value=user?.email||'';$('user-password').value='';$('user-password').required=!user;$('password-help').textContent=user?'deixe em branco para manter a senha atual':'inicial · mínimo de 14 caracteres';$('user-active').checked=user?user.active:true;$('editor-title').textContent=user?'Editar usuário':'Novo usuário';$('editor').hidden=false;$('campaign-picker').hidden=true;$('campaign-message').textContent='';renderGrants();message('');$('user-name').focus();
}
$('user-role').onchange=()=>{$('roi-permissions').hidden=$('user-role').value!=='reader';};
$('new-user').onclick=()=>edit();$('cancel-user').onclick=()=>{++campaignToken;$('editor').hidden=true;$('user-password').value='';editing=null;};
$('grant-account').onchange=()=>void loadCampaigns();$('grant-scope').onchange=()=>void loadCampaigns();
$('add-grant').onclick=()=>{const account=$('grant-account').value;if(!account){message('Selecione uma conta.',true);return;}
 const campaigns=$('grant-scope').value==='all'?null:[...new Set([...$('grant-campaigns').selectedOptions].map(o=>o.value).concat($('grant-extra').value.split(/[,\s;]+/).filter(Boolean)))];
 if(campaigns&&(!campaigns.length||campaigns.some(c=>!/^\d{1,20}$/.test(c)))){message('Selecione campanhas ou informe IDs válidos.',true);return;}
 grants=grants.filter(g=>g.account!==account);grants.push({account,campaigns});renderGrants();message('Permissão preparada. Clique em Salvar usuário para aplicar.');
};
$('user-form').onsubmit=async event=>{event.preventDefault();if(busy)return;lock(true);message('Salvando acesso…');
 try{
 const selectedWhatsAppSites=$('whatsapp-access').checked?[...new Set([...$('whatsapp-sites').selectedOptions].map(option=>option.value).concat($('whatsapp-extra').value.split(/[,\s;]+/).filter(Boolean).map(site=>site.toLowerCase())))]:[];
 if($('whatsapp-access').checked&&!selectedWhatsAppSites.length)throw Error('Selecione pelo menos um site para liberar o WhatsApp.');
 const data=await api('',{whatsapp_sites:selectedWhatsAppSites,...(editing?{id:editing.id,revision:editing.revision}:{}),name:$('user-name').value,email:$('user-email').value,password:$('user-password').value,active:$('user-active').checked,role:$('user-role').value,grants:$('user-role').value==='reader'?grants:[]});users=data.users;renderUsers();$('editor').hidden=true;$('user-password').value='';message('Usuário salvo. O acesso anterior foi encerrado; ele poderá entrar com as permissões atualizadas.');}
 catch(e){message(e.message,true);}finally{lock(false);}
};
try{const u=await api('');users=u.users;renderUsers();const c=await api('/catalog');accounts=c.accounts;whatsappSites=c.whatsapp_sites||[];for(const a of accounts)$('grant-account').add(new Option(a.name+' · '+a.id,a.id));renderUsers();}catch(e){message(e.message,true);}
