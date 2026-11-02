import './style.css';
import {auth,remote} from './api.ts';
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
let accountEpoch=0,accountCleanup:Promise<void>=Promise.resolve();
async function client(profile='account',projectId?:string){const accountId=session?.user.id,epoch=accountEpoch;if(!accountId)throw Error('Entre na conta.');await accountCleanup;if(epoch!==accountEpoch)throw Error('A conta mudou. Reabra o estudo.');const key=[accountId,profile,projectId||''].join(':');let value=clients.get(key);if(!value){value=await studyClient(accountId,profile,projectId);if(epoch!==accountEpoch){value.close();throw Error('A conta mudou. Reabra o estudo.');}clients.set(key,value);}return value;}
async function api(task:string,args:Record<string,unknown>){return (await client()).api(task,args);}
let theme=localStorage.getItem('um-theme')||'system';function setTheme(){const dark=theme==='dark'||theme==='system'&&matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.dataset.colorMode=dark?'dark':'light';}setTheme();matchMedia('(prefers-color-scheme: dark)').addEventListener('change',setTheme);
function shell(){dispose?.();dispose=undefined;app.innerHTML=`<div class="shell"><header class="topbar"><div class="brand">Um</div><div class="top-actions">${iconButton(navigator.onLine?'cloud':'offline',navigator.onLine?'Conexão e sincronização':'Sem conexão','sync')}${iconButton('account','Conta','account')}</div></header><nav class="nav" aria-label="Principal">${iconButton('study','Meus estudos','home',`aria-current="${screen==='home'?'page':'false'}"`)}${iconButton('graph','Explorar acervo','explore',`aria-current="${screen==='explore'?'page':'false'}"`)}</nav><main id="main" tabindex="-1"></main></div>`;return app.querySelector<HTMLElement>('main')!;}
function error(root:HTMLElement,e:unknown){root.insertAdjacentHTML('beforeend',`<p class="error" role="alert">${esc((e as Error).message)}</p>`);}
async function show(name:string){screen=name;activeClient=null;const root=shell();try{if(name==='authorize')dispose=await mountConsent(root,new URLSearchParams(location.hash.slice(1)).get('authorize')||'');else if(name==='account')await account(root);else if(!session)welcome(root);else if(name==='explore')await explore(root);else await home(root);}catch(e){error(root,e);}}
function welcome(root:HTMLElement){root.innerHTML=`<section class="card"><h1>Leitura e estudo em Humanidades</h1><p>Textos, fontes e apoios preparados para o seu estudo, com espaço para notas e diálogo.</p><div class="submit-row">${iconButton('sign-in','Entrar para estudar','account')}</div></section>`;}
async function home(root:HTMLElement){
 const profiles=(await api('profile_list',{})).items.filter((p:any)=>p.holderId===session!.user.id);
 if(!profileId||!profiles.some((p:any)=>p.id===profileId))profileId=profiles[0]?.id||null;
 root.innerHTML=`<h1>Meus estudos</h1>${profiles.length>1?`<label class="field">Perfil<select id="profile">${profiles.map((p:any)=>`<option value="${p.id}" ${p.id===profileId?'selected':''}>${esc(p.fields.name||'Meu perfil')}</option>`).join('')}</select></label>`:''}<div id="studies"></div>`;
 root.querySelector('#profile')?.addEventListener('change',e=>{profileId=(e.target as HTMLSelectElement).value;void show('home');});
 if(!profileId){root.querySelector('#studies')!.innerHTML='<p class="empty">Aceite o convite recebido na sua conta para encontrar seu estudo.</p>';return;}
 const projects=(await api('project_list',{})).items;let count=0;
 for(const p of projects){const detail=await api('project_get',{projectId:p.id}),part=detail.participations.find((x:any)=>x.profile_id===profileId);if(!part)continue;count++;const needsForm=part.nextAction==='await_submission';const state=needsForm?'Preparação disponível':part.state==='available'?'Apoios preparados':p.active_revision?'Estudo disponível · apoios em preparação':'Estudo em preparação';root.querySelector('#studies')!.insertAdjacentHTML('beforeend',`<article class="card study-card"><div><h2>${esc(p.title)}</h2><p class="muted">${esc(state)}</p></div>${needsForm?iconButton('edit','Responder preparação','form',`data-form="${part.form_id}" data-project="${p.id}"`):p.active_revision?iconButton('book-open','Abrir estudo','reader',`data-project="${p.id}"`):''}</article>`);}
 if(!count)root.querySelector('#studies')!.innerHTML='<p class="empty">Nenhum estudo associado a este perfil.</p>';
}
async function account(root:HTMLElement){
 const accountId=session?.user.id;
 root.innerHTML=`<div class="section-title"><h1>Conta</h1>${iconButton('theme-'+theme,'Tema: '+({system:'sistema',light:'claro',dark:'escuro'}[theme]||'sistema'),'theme')}</div>`;
 if(!session){root.insertAdjacentHTML('beforeend',`<form id="login"><label class="field">E-mail<input type="email" name="email" autocomplete="username" required></label><label class="field">Senha<input type="password" name="password" autocomplete="current-password" required minlength="8"></label><div class="submit-row">${iconButton('account-add','Criar conta','signup')}${iconButton('sign-in','Entrar','signin')}</div><p role="status" id="auth-status"></p></form>`);const form=root.querySelector('form')!;form.addEventListener('submit',e=>{e.preventDefault();void login(false);});const login=async(signup:boolean)=>{const values=new FormData(form),credentials={email:String(values.get('email')),password:String(values.get('password'))};const result=signup?await auth.signUp(credentials):await auth.signInWithPassword(credentials);if(result.error)root.querySelector('#auth-status')!.textContent=result.error.message;else if(!result.data.session)root.querySelector('#auth-status')!.textContent='Confira seu e-mail para confirmar a conta.';};root.querySelector('[data-action=signin]')!.addEventListener('click',()=>void login(false));root.querySelector('[data-action=signup]')!.addEventListener('click',()=>void login(true));return;}
 root.insertAdjacentHTML('beforeend',`<p>${esc(session.user.email||'Conta autenticada')}</p><section class="card"><h2>Aceitar convite</h2><label class="field">Código do convite<input id="invite" autocomplete="off" value="${esc(new URLSearchParams(location.hash.slice(1)).get('invite')||'')}"></label><div class="submit-row">${iconButton('ready-state','Aceitar convite nesta conta','accept-invite')}</div></section><section class="card"><h2>Autorizações</h2><div id="grants"></div></section><div class="submit-row">${iconButton('sign-out','Sair e limpar dados locais da conta','logout')}</div>`);
 try{const grants=await remote('account_grants',{},accountId);root.querySelector('#grants')!.innerHTML=grants.items.length?grants.items.map((g:any)=>`<div class="study-card"><p>${esc(g.name||'Cliente autorizado')}<br><span class="muted">${g.permission==='write'?'Leitura e escrita':'Somente leitura'} · ${g.active?'Conexão ativa':'Sem conexão ativa'}</span></p>${iconButton('trash','Revogar cliente','revoke',`data-client="${g.client_id}"`)}</div>`).join(''):'<p class="muted">Nenhum cliente autorizado.</p>';}catch{root.querySelector('#grants')!.innerHTML='<p class="muted">Conecte-se para conferir autorizações.</p>';}
 root.insertAdjacentHTML('beforeend',`<section class="card"><h2>Remoção de arquivos</h2><p id="data-status" role="status">Conferindo remoções solicitadas…</p>${iconButton('reset','Retomar remoção de arquivos','data-cleanup')}</section>`);
 await refreshDeletionStatus(root);
 dispose=await mountProfiles(root,{accountId:accountId!,api:(task,args)=>remote(task,args,accountId),onInvalidated:async id=>{
  let deleted=false;try{await remote('profile_get',{profileId:id},accountId);}catch(e){if((e as any)?.status===404)deleted=true;else throw e;}
  await (await client()).store.clear();
  if(deleted){for(const [key,c]of clients)if(key.split(':')[1]===id){await c.store.clear();c.close();clients.delete(key);}if(profileId===id)profileId=null;await cleanupData();await refreshDeletionStatus(root);}
 }});
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
 if(['home','account','explore'].includes(action!))await show(action!);
 if(action==='theme'){theme=theme==='system'?'light':theme==='light'?'dark':'system';localStorage.setItem('um-theme',theme);setTheme();await show('account');}
 if(action==='accept-invite'){await remote('invite_accept',{operationId:crypto.randomUUID(),token:(root.querySelector('#invite') as HTMLInputElement).value.trim()},accountId);history.replaceState(null,'',location.pathname);announce('Convite aceito.');await show('home');}
 if(action==='data-cleanup'){button.disabled=true;try{await cleanupData();await refreshDeletionStatus(root);}finally{button.disabled=false;}}
 if(action==='revoke'){await remote('account_grant_set',{operationId:crypto.randomUUID(),clientId:button.dataset.client,permission:'revoke'},accountId);await show('account');}
 if(action==='logout'){const accountId=session!.user.id;dispose?.();dispose=undefined;profileId=null;for(const c of clients.values())c.close();clients.clear();activeClient=null;const signedOut=await auth.signOut({scope:'local'});session=null;await accountCleanup;await clearAccount(accountId);await show('account');if(signedOut.error)announce('Dados locais removidos. A revogação da sessão no serviço ainda não foi confirmada.');}
 if(action==='sync'){if(activeClient)try{await activeClient.sync();}catch(e){announce((e as Error).message);}const operations=activeClient?await activeClient.store.operations():[];root.insertAdjacentHTML('afterbegin',`<section class="card" id="sync-status"><h2>Conexão e dados locais</h2><p>${navigator.onLine?'Conectado':'Sem conexão'}</p><p class="muted">${operations.filter(o=>o.state!=='confirmed').length} operações aguardam confirmação ou revisão.</p>${activeClient?iconButton('offline','Preparar este estudo para uso offline','prepare-offline'):''}${operations.filter(o=>o.state!=='confirmed').map(o=>`<p>${esc(o.state)} · ${esc(o.error||'Aguardando conexão')}</p>`).join('')}</section>`);}
 if(action==='prepare-offline'&&activeClient){button.disabled=true;try{const result=await activeClient.download();announce(result.downloaded?'Estudo preparado neste dispositivo.':'Os direitos registrados permitem apenas a consulta online deste estudo.');}finally{button.disabled=false;}}
 if(action==='form'){dispose?.();activeClient=await client(profileId!,button.dataset.project);dispose=await mountForm(root,button.dataset.form!,activeClient.api,()=>void show('home'));}
 if(action==='reader'){const {mountReader}=await import('./reader-view.ts');dispose?.();activeClient=await client(profileId!,button.dataset.project!);const readerClient=activeClient;if(navigator.onLine)try{await readerClient.sync();}catch(e){if((e as any)?.status&&((e as any).status<500))throw e;announce('Sem confirmação do serviço. Abrindo o conteúdo disponível neste dispositivo.');}const options={projectId:button.dataset.project!,profileId:profileId!,api:readerClient.api,onExit:()=>void show('home'),onUpdate:async()=>{const result=await readerClient.update();dispose?.();dispose=await mountReader(root,options);announce(result.needsReview?`Estudo atualizado. ${result.needsReview} passagem(ns) precisam de conferência; citações anteriores preservadas.`:'Estudo atualizado; suas respostas, notas e abas foram preservadas.');}};dispose=await mountReader(root,options);}
 }catch(errorValue){error(root,errorValue);}});
function initialScreen(){const hash=new URLSearchParams(location.hash.slice(1));return hash.has('authorize')?'authorize':hash.has('invite')?'account':'home';}
auth.onAuthStateChange((event,next)=>{
 const previous=session?.user.id,changed=previous!==next?.user.id;session=next;
 if(changed||event==='SIGNED_OUT'){
  accountEpoch++;const epoch=accountEpoch;dispose?.();dispose=undefined;profileId=null;activeClient=null;for(const c of clients.values())c.close();clients.clear();
  app.innerHTML='<main><p role="status">Conferindo a conta e os dados deste dispositivo…</p></main>';
  if(previous){cleanupCursor.delete(previous);accountCleanup=accountCleanup.catch(()=>{}).then(()=>clearAccount(previous));}
  if(event!=='INITIAL_SESSION')setTimeout(()=>{void accountCleanup.then(()=>{if(epoch===accountEpoch)return show(initialScreen());}).catch(()=>{if(epoch===accountEpoch)app.innerHTML='<main><p role="alert">Não foi possível concluir a limpeza local. Reabra o aplicativo.</p></main>';});},0);
 }
});
window.addEventListener('hashchange',()=>{if(new URLSearchParams(location.hash.slice(1)).has('authorize'))void show('authorize');});
session=(await auth.getSession()).data.session;await show(initialScreen());
if(import.meta.env.PROD&&location.hostname!=='appassets.androidplatform.net'&&'serviceWorker'in navigator)void navigator.serviceWorker.register(new URL('sw.js',document.baseURI)).catch(()=>announce('A aplicação ainda não está preparada para reabrir sem conexão.'));
window.addEventListener('online',()=>{if(session)void cleanupData().catch(()=>{});for(const c of clients.values())void c.sync().catch(()=>{});});
(window as any).UmAndroid={flush:()=>{window.dispatchEvent(new Event('um-flush'));},back:()=>{if(screen!=='home'||activeClient){void show('home');activeClient=null;return true;}return false;}};
