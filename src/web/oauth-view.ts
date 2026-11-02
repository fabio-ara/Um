import {apiOrigin,consentAuth} from './api.ts';
import {escapeHtml as h,iconButton,announce} from './dom.ts';
import type {Session} from '@supabase/supabase-js';

/** Consent uses a separate, nonpersistent session. Its refresh token is sent
 * directly to the authorization endpoint, never to IndexedDB or operation logs. */
export async function mountConsent(root:HTMLElement,requestId:string):Promise<()=>void>{
 const auth=consentAuth(),controller=new AbortController();let session:Session|null=null,approved=false,busy=false;
 root.innerHTML='<section class="card"><h1>Conectar ao Um</h1><p role="status">Conferindo solicitação…</p></section>';
 async function json(response:Response){const value=await response.json();if(!response.ok)throw Error(value.error_description||'Não foi possível continuar a autorização.');return value;}
 let info:any;
 try{info=await json(await fetch(apiOrigin+'/oauth/request?request='+encodeURIComponent(requestId),{signal:controller.signal}));}
 catch(e){root.innerHTML=`<section class="card"><h1>Conexão indisponível</h1><p role="alert">${h((e as Error).message)}</p><p>Inicie outra conexão no cliente.</p></section>`;return ()=>controller.abort();}
 function render(message=''){
  if(controller.signal.aborted)return;
  root.innerHTML=`<section class="card"><h1>Conectar ao Um</h1><h2>${h(info.clientName)}</h2><p>Destino da autorização: <span dir="ltr">${h(new URL(info.redirectUri).origin)}</span></p><p>${info.permission==='write'?'Este cliente solicita ler e alterar os dados do Um que você pode acessar.':'Este cliente solicita somente leitura dos dados do Um que você pode acessar.'}</p><p>Você pode retirar essa autorização pela Conta.</p>
  ${session?`<p>Conta: ${h(session.user.email)}</p><div class="submit-row">${iconButton('ready-state','Autorizar conexão','consent-allow')}${iconButton('remove-state','Negar conexão','consent-deny')}</div>`:`<form id="consent-login"><p>Entre na conta que deseja conectar.</p><label class="field">E-mail<input name="email" type="email" autocomplete="username" required></label><label class="field">Senha<input name="password" type="password" autocomplete="current-password" required></label><div class="submit-row">${iconButton('sign-in','Entrar para autorizar','consent-login')}${iconButton('remove-state','Negar conexão','consent-deny')}</div></form>`}
  <p role="status" id="consent-status">${h(message)}</p></section>`;
 }
 function status(message:string){const el=root.querySelector('#consent-status');if(el)el.textContent=message;announce(message);}
 async function act(action:string){
  if(busy)return;busy=true;root.querySelectorAll<HTMLButtonElement>('button').forEach(b=>b.disabled=true);
  try{
   if(action==='consent-login'){
    const form=root.querySelector<HTMLFormElement>('form')!;if(!form.reportValidity())return;const data=new FormData(form),result=await auth.signInWithPassword({email:String(data.get('email')),password:String(data.get('password'))});if(result.error)throw result.error;if(!result.data.session)throw Error('Confirme sua conta antes de conectar.');session=result.data.session;render('Confira o acesso solicitado antes de autorizar.');return;
   }
   if(action!=='consent-allow'&&action!=='consent-deny')return;
   if(action==='consent-allow'&&!session)throw Error('Entre na conta antes de autorizar.');
   const result=await json(await fetch(apiOrigin+'/oauth/consent',{method:'POST',headers:{'Content-Type':'application/json',...(session?{Authorization:'Bearer '+session.access_token}:{})},body:JSON.stringify({request:requestId,decision:action==='consent-allow'?'allow':'deny',...(action==='consent-allow'?{refresh_token:session!.refresh_token}:{})}),signal:controller.signal}));
   const target=new URL(result.redirectUri),registered=new URL(info.redirectUri);if(target.origin!==registered.origin||target.pathname!==registered.pathname)throw Error('Destino incompatível com a solicitação.');
   approved=action==='consent-allow';if(!approved&&session)await auth.signOut({scope:'local'});session=null;location.assign(target.href);
  }catch(e){status((e as Error).message);}finally{busy=false;root.querySelectorAll<HTMLButtonElement>('button').forEach(b=>b.disabled=false);}
 }
 render();root.addEventListener('click',e=>{const button=(e.target as Element).closest<HTMLElement>('[data-action]');if(button?.dataset.action?.startsWith('consent-')){e.preventDefault();void act(button.dataset.action);}},{signal:controller.signal});
 root.addEventListener('submit',e=>{e.preventDefault();void act('consent-login');},{signal:controller.signal});
 return ()=>{controller.abort();if(session&&!approved)void auth.signOut({scope:'local'});session=null;auth.stopAutoRefresh();};
}
