import './style.css';
import {auth,remote,mcpUrl,recoveryLink,requireAccount} from './api.ts';
import {gettingStarted,allPages} from './getting-started.ts';
import {mountAuth} from './auth-view.ts';
import {escapeHtml as esc,iconButton,announce} from './dom.ts';
import {mountForm} from './form-view.ts';
import {mountProfiles} from './profile-view.ts';
import {mountExplore} from './explore-view.ts';
import {mountConsent} from './oauth-view.ts';
import {studyClient} from './study-api.ts';
import {clearAccount} from './offline.ts';
import {installIconHints} from './icon-hints.ts';
import type {Session} from '@supabase/supabase-js';
installIconHints();
const app=document.getElementById('app')!;let session:Session|null=null,profileId:string|null=null,dispose:(()=>void)|undefined,screen='home';
const clients=new Map<string,Awaited<ReturnType<typeof studyClient>>>();let activeClient:Awaited<ReturnType<typeof studyClient>>|null=null;
let accountEpoch=0,accountCleanup:Promise<void>=Promise.resolve(),recoveryPending=recoveryLink,creatingProfile=false;
async function client(profile='account',projectId?:string){const accountId=session?.user.id,epoch=accountEpoch;if(!accountId)throw Error('Entre na conta.');await accountCleanup;if(epoch!==accountEpoch)throw Error('A conta mudou. Reabra o estudo.');const key=[accountId,profile,projectId||''].join(':');let value=clients.get(key);if(!value){value=await studyClient(accountId,profile,projectId);if(epoch!==accountEpoch){value.close();throw Error('A conta mudou. Reabra o estudo.');}clients.set(key,value);}return value;}
async function api(task:string,args:Record<string,unknown>){return (await client()).api(task,args);}
let theme=localStorage.getItem('um-theme')||'system';function setTheme(){const dark=theme==='dark'||theme==='system'&&matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.dataset.colorMode=dark?'dark':'light';}setTheme();matchMedia('(prefers-color-scheme: dark)').addEventListener('change',setTheme);
function shell(){dispose?.();dispose=undefined;app.innerHTML=`<div class="shell"><header class="topbar"><div class="brand">Um</div><div class="top-actions">${iconButton(navigator.onLine?'cloud':'offline',navigator.onLine?'Conexão e sincronização':'Sem conexão','sync','aria-expanded="false" aria-controls="connection-status"')}${iconButton('account','Conta','account')}</div></header><nav class="nav" aria-label="Principal">${iconButton('study','Meus estudos','home',`aria-current="${screen==='home'?'page':'false'}"`)}${iconButton('graph','Explorar acervo','explore',`aria-current="${screen==='explore'?'page':'false'}"`)}</nav><div id="connection-status"></div><main id="main" tabindex="-1"></main></div>`;return app.querySelector<HTMLElement>('main')!;}
function error(root:HTMLElement,e:unknown){root.insertAdjacentHTML('beforeend',`<p class="error" role="alert">${esc((e as Error).message)}</p>`);}
async function show(name:string){screen=name;activeClient=null;const root=shell();try{if(name==='authorize')dispose=await mountConsent(root,new URLSearchParams(location.hash.slice(1)).get('authorize')||'');else if(name==='recover'||name==='password'){root.innerHTML='<h1>Conta</h1>';dispose=mountAuth(root,name,()=>{recoveryPending=false;const url=new URL(location.href);url.searchParams.delete('recovery');url.hash='';history.replaceState(null,'',url);void show('account');},session?.user.id);}else if(name==='account')await account(root);else if(name==='form'){if(!session){await account(root);root.querySelector('h1')!.insertAdjacentHTML('afterend','<p>Entre na conta que recebeu esta preparação. O formulário será aberto após o login.</p>');}else await openForm(root,new URLSearchParams(location.hash.slice(1)).get('form')||'');}else if(!session)welcome(root);else if(name==='explore')await explore(root);else await home(root);}catch(e){error(root,e);}}
function welcome(root:HTMLElement){root.innerHTML=`<section class="card"><h1>Leitura e estudo em Humanidades</h1><p>Prepare seu estudo com o Um no ChatGPT. Aqui você responde à preparação, lê, pratica e guarda notas.</p><p>Entre para estudar por conta própria ou aceitar o convite de quem prepara um estudo para você.</p><div class="submit-row">${iconButton('sign-in','Entrar para estudar','account')}</div></section>`;}
function returnHome(){history.replaceState(null,'',location.pathname+location.search);void show('home');}
async function openForm(root:HTMLElement,formId:string){
 const accountId=session!.user.id,loaded=await api('form_get',{formId}),definition=loaded.definition;
 const profile=await api('profile_get',{profileId:definition.profileId});
 if(profile.holderId!==accountId)throw Error('Esta preparação deve ser respondida pela conta titular do perfil. Entre na conta que recebeu o convite.');
 await requireAccount(accountId);if(!root.isConnected)return;
 const formClient=await client(profile.id,definition.projectId);await requireAccount(accountId);if(!root.isConnected)return;
 profileId=profile.id;activeClient=formClient;const close=await mountForm(root,formId,formClient.api,returnHome);if(!root.isConnected||session?.user.id!==accountId){close();return;}dispose=close;
}
async function home(root:HTMLElement){
 const accountId=session!.user.id,profiles=(await allPages(api,'profile_list')).filter((p:any)=>p.holderId===accountId);
 if(!profileId||!profiles.some((p:any)=>p.id===profileId))profileId=profiles[0]?.id||null;
 root.innerHTML=`<h1>Meus estudos</h1>${profiles.length>1?`<label class="field">Perfil<select id="profile">${profiles.map((p:any)=>`<option value="${p.id}" ${p.id===profileId?'selected':''}>${esc(p.fields.name||'Meu perfil')}</option>`).join('')}</select></label>`:''}<div id="studies"></div>`;
 root.querySelector('#profile')?.addEventListener('change',e=>{profileId=(e.target as HTMLSelectElement).value;void show('home');});
 if(!profileId){root.querySelector('#studies')!.innerHTML=gettingStarted(true);return;}
 const projects=await allPages(api,'project_list');let count=0;
 for(const p of projects){const detail=await api('project_get',{projectId:p.id}),part=detail.participations.find((x:any)=>x.profile_id===profileId);if(!part)continue;count++;const needsForm=part.nextAction==='await_submission';const state=needsForm?'Preparação disponível':part.state==='available'?'Apoios preparados':p.active_revision?'Estudo disponível · apoios em preparação':'Estudo em preparação';root.querySelector('#studies')!.insertAdjacentHTML('beforeend',`<article class="card study-card"><div><h2>${esc(p.title)}</h2><p class="muted">${esc(state)}</p></div><div class="top-actions">${needsForm?iconButton('edit','Responder preparação','form',`data-form="${part.form_id}" data-project="${p.id}"`):''}${p.active_revision?iconButton('book-open','Abrir estudo','reader',`data-project="${p.id}"`):''}</div></article>`);}
 if(!count)root.querySelector('#studies')!.innerHTML='<p class="empty">Seu perfil está pronto. O próximo passo é preparar um estudo com o Um no ChatGPT.</p>'+gettingStarted();
}
async function account(root:HTMLElement){
 const accountId=session?.user.id;
 root.innerHTML=`<div class="section-title"><h1>Conta</h1>${iconButton('theme-'+theme,'Tema: '+({system:'sistema',light:'claro',dark:'escuro'}[theme]||'sistema'),'theme')}</div>`;
 if(!session){dispose=mountAuth(root,'login',()=>void show('home'));return;}
 root.insertAdjacentHTML('beforeend',`<p>${esc(session.user.email||'Conta autenticada')}</p><section class="card"><h2>Aceitar convite</h2><label class="field">Código do convite<input id="invite" autocomplete="off" value="${esc(new URLSearchParams(location.hash.slice(1)).get('invite')||'')}"></label><div class="submit-row">${iconButton('ready-state','Aceitar convite nesta conta','accept-invite')}</div></section><section class="card"><h2>Autorizações</h2><div id="grants"></div></section><div class="submit-row">${iconButton('sign-out','Sair e limpar dados locais da conta','logout')}</div>`);
 root.insertAdjacentHTML('beforeend','<div id=first-access></div>');
 const help=root.querySelector<HTMLElement>('#first-access')!;
 void allPages((task,args)=>remote(task,args,accountId),'profile_list').then(profiles=>{if(root.isConnected&&session?.user.id===accountId)help.innerHTML=gettingStarted(!profiles.some(p=>p.holderId===accountId),false);}).catch(()=>{if(root.isConnected)help.innerHTML='<p class=muted>Conecte-se para conferir seus perfis e começar um estudo.</p>';});
 try{const grants=await remote('account_grants',{},accountId);root.querySelector('#grants')!.innerHTML=grants.items.length?grants.items.map((g:any)=>`<div class="study-card"><p>${esc(g.name||'Cliente autorizado')}<br><span class="muted">${g.permission==='write'?'Leitura e escrita':'Somente leitura'} · ${g.active?'Conexão ativa':'Sem conexão ativa'}</span></p>${iconButton('trash','Revogar cliente','revoke',`data-client="${g.client_id}"`)}</div>`).join(''):'<p class="muted">Nenhum cliente autorizado.</p>';}catch{root.querySelector('#grants')!.innerHTML='<p class="muted">Conecte-se para conferir autorizações.</p>';}
 root.insertAdjacentHTML('beforeend',`<section class="card"><h2>Remoção de arquivos</h2><p id="data-status" role="status">Conferindo remoções solicitadas…</p>${iconButton('reset','Retomar remoção de arquivos','data-cleanup')}</section>`);
 await refreshDeletionStatus(root);if(!root.isConnected||session?.user.id!==accountId)return;
 const close=await mountProfiles(root,{accountId:accountId!,api:(task,args)=>remote(task,args,accountId),onInvalidated:async id=>{
  let deleted=false;try{await remote('profile_get',{profileId:id},accountId);}catch(e){if((e as any)?.status===404)deleted=true;else throw e;}
  await (await client()).store.clear();
  if(deleted){for(const [key,c]of clients)if(key.split(':')[1]===id){await c.store.clear();c.close();clients.delete(key);}if(profileId===id)profileId=null;await cleanupData();await refreshDeletionStatus(root);}
 }});
 if(!root.isConnected||session?.user.id!==accountId){close();return;}dispose=close;
}
async function createSelfProfile(accountId:string){
 const c=await client(),key='intent:create-self';let intent=await c.store.record(key) as any;
 if(!intent){const own=(await allPages((task,args)=>remote(task,args,accountId),'profile_list')).find(p=>p.holderId===accountId);if(own){profileId=own.id;return;}intent={operationId:crypto.randomUUID(),fields:{name:'Meu perfil'},self:true};await c.store.putRecord(key,intent);}
 const receipt=await remote('operation_get',{operationId:intent.operationId},accountId)||await remote('profile_create',intent,accountId);
 if(receipt.status!=='confirmed'||!receipt.result?.profileId)throw Error('A criação ainda não foi confirmada. Tente novamente para recuperar o resultado.');
 await requireAccount(accountId);await c.store.putRecord(key,null);profileId=receipt.result.profileId;announce('Seu perfil foi criado. Prepare seu primeiro estudo com o Um no ChatGPT.');
}
let cleanupRunning:Promise<void>|null=null;
const cleanupCursor=new Map<string,string>();
async function cleanupData(){
 if(cleanupRunning)return cleanupRunning;const owner=session?.user.id;if(!owner)return;
 cleanupRunning=(async()=>{
  // Bounded discovery advances by path, so removed files cannot shift a cursor.
  for(let page=0;page<10&&session?.user.id===owner;page++){
   const response=await remote('data_orphan_scan',{operationId:crypto.randomUUID(),after:cleanupCursor.get(owner)||'',limit:100},owner) as any;
   if(response.status!=='confirmed')return;
   cleanupCursor.set(owner,response.result.next||'');if(!response.result.next)break;
  }
  while(session?.user.id===owner){const response=await remote('data_cleanup',{operationId:crypto.randomUUID(),limit:100},owner) as any;if(response.status!=='confirmed'||!response.result.pending||!response.result.removed)break;}
 })().finally(()=>{cleanupRunning=null;});return cleanupRunning;
}
async function refreshDeletionStatus(root:HTMLElement){const target=root.querySelector('#data-status');if(!target)return;try{const status=await remote('data_status',{},session?.user.id);target.textContent=status.pending?`${status.pending} arquivos aguardam remoção. O acesso a eles já foi retirado.`:'Nenhuma remoção de arquivo pendente nesta conta.';}catch{target.textContent='Conecte-se para conferir a remoção dos arquivos.';}}
async function explore(root:HTMLElement){root.innerHTML='<h1>Explorar</h1>';dispose=await mountExplore(root,api);}
app.addEventListener('click',async e=>{const button=(e.target as Element).closest<HTMLButtonElement>('[data-action]');if(!button||button.disabled)return;const accountId=session?.user.id,action=button.dataset.action,root=app.querySelector<HTMLElement>('main')!;try{
 if(['home','account','explore','recover'].includes(action!)){if(action==='home'||action==='explore')history.replaceState(null,'',location.pathname+location.search);await show(action!);}
 if(action==='copy-mcp'){await navigator.clipboard.writeText(mcpUrl);announce('Endereço do Um copiado.');}
 if(action==='create-self'){if(creatingProfile)return;creatingProfile=true;button.disabled=true;try{await createSelfProfile(accountId!);returnHome();}finally{creatingProfile=false;button.disabled=false;}}
 if(action==='theme'){theme=theme==='system'?'light':theme==='light'?'dark':'system';localStorage.setItem('um-theme',theme);setTheme();await show('account');}
 if(action==='accept-invite'){await remote('invite_accept',{operationId:crypto.randomUUID(),token:(root.querySelector('#invite') as HTMLInputElement).value.trim()},accountId);history.replaceState(null,'',location.pathname);announce('Convite aceito.');await show('home');}
 if(action==='data-cleanup'){button.disabled=true;try{await cleanupData();await refreshDeletionStatus(root);}finally{button.disabled=false;}}
 if(action==='revoke'){await remote('account_grant_set',{operationId:crypto.randomUUID(),clientId:button.dataset.client,permission:'revoke'},accountId);await show('account');}
 if(action==='logout'){const accountId=session!.user.id;dispose?.();dispose=undefined;profileId=null;for(const c of clients.values())c.close();clients.clear();activeClient=null;const signedOut=await auth.signOut({scope:'local'});session=null;await accountCleanup;await clearAccount(accountId);await show('account');if(signedOut.error)announce('Dados locais removidos. A revogação da sessão no serviço ainda não foi confirmada.');}
 if(action==='sync'){const region=app.querySelector<HTMLElement>('#connection-status')!;if(region.hasChildNodes()){region.replaceChildren();button.setAttribute('aria-expanded','false');return;}if(activeClient)try{await activeClient.sync();}catch(e){announce((e as Error).message);}const operations=activeClient?await activeClient.store.operations():[];button.setAttribute('aria-expanded','true');region.innerHTML=`<section class="card" id="sync-status"><h2>Conexão e dados locais</h2><p>${navigator.onLine?'Conectado':'Sem conexão'}</p><p class="muted">${operations.filter(o=>o.state!=='confirmed').length} operações aguardam confirmação ou revisão.</p>${activeClient?iconButton('offline','Preparar este estudo para uso offline','prepare-offline'):''}${operations.filter(o=>o.state!=='confirmed').map(o=>`<p>${esc(o.state)} · ${esc(o.error||'Aguardando conexão')}</p>`).join('')}</section>`;}
 if(action==='prepare-offline'&&activeClient){button.disabled=true;try{const result=await activeClient.download();announce(result.downloaded?'Estudo preparado neste dispositivo.':'Os direitos registrados permitem apenas a consulta online deste estudo.');}finally{button.disabled=false;}}
 if(action==='form'){location.hash=new URLSearchParams({form:button.dataset.form!}).toString();}
 if(action==='reader'){const {mountReader}=await import('./reader-view.ts');dispose?.();activeClient=await client(profileId!,button.dataset.project!);const readerClient=activeClient;if(navigator.onLine)try{await readerClient.sync();}catch(e){if((e as any)?.status&&((e as any).status<500))throw e;announce('Sem confirmação do serviço. Abrindo o conteúdo disponível neste dispositivo.');}const options={projectId:button.dataset.project!,profileId:profileId!,api:readerClient.api,onExit:()=>void show('home'),onUpdate:async()=>{const result=await readerClient.update();dispose?.();dispose=await mountReader(root,options);announce(result.needsReview?`Estudo atualizado. ${result.needsReview} passagem(ns) precisam de conferência; citações anteriores preservadas.`:'Estudo atualizado; suas respostas, notas e abas foram preservadas.');}};dispose=await mountReader(root,options);}
 }catch(errorValue){error(root,errorValue);}});
function initialScreen(){const hash=new URLSearchParams(location.hash.slice(1));return recoveryPending?'password':hash.has('authorize')?'authorize':hash.has('invite')?'account':hash.has('form')?'form':'home';}
auth.onAuthStateChange((event,next)=>{
 const previous=session?.user.id,changed=previous!==next?.user.id;session=next;
 if(event==='PASSWORD_RECOVERY')recoveryPending=true;if(event==='SIGNED_OUT')recoveryPending=false;
 if(changed||event==='SIGNED_OUT'||event==='PASSWORD_RECOVERY'){
  accountEpoch++;const epoch=accountEpoch;dispose?.();dispose=undefined;profileId=null;activeClient=null;for(const c of clients.values())c.close();clients.clear();
  app.innerHTML='<main><p role="status">Conferindo a conta e os dados deste dispositivo…</p></main>';
  if(previous&&(changed||event==='SIGNED_OUT')){cleanupCursor.delete(previous);accountCleanup=accountCleanup.catch(()=>{}).then(()=>clearAccount(previous));}
  if(event!=='INITIAL_SESSION')setTimeout(()=>{void accountCleanup.then(()=>{if(epoch===accountEpoch)return show(initialScreen());}).catch(()=>{if(epoch===accountEpoch)app.innerHTML='<main><p role="alert">Não foi possível concluir a limpeza local. Reabra o aplicativo.</p></main>';});},0);
 }
});
window.addEventListener('hashchange',()=>{const hash=new URLSearchParams(location.hash.slice(1));if(['authorize','invite','form'].some(key=>hash.has(key)))void show(initialScreen());});
session=(await auth.getSession()).data.session;await show(initialScreen());
if(import.meta.env.PROD&&location.hostname!=='appassets.androidplatform.net'&&'serviceWorker'in navigator)void navigator.serviceWorker.register(new URL('sw.js',document.baseURI)).catch(()=>announce('A aplicação ainda não está preparada para reabrir sem conexão.'));
window.addEventListener('online',()=>{if(session)void cleanupData().catch(()=>{});for(const c of clients.values())void c.sync().catch(()=>{});});
(window as any).UmAndroid={flush:()=>{window.dispatchEvent(new Event('um-flush'));},back:()=>{if(screen!=='home'||activeClient){returnHome();activeClient=null;return true;}return false;}};
