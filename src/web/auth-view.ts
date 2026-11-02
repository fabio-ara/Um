import {auth,appUrl,requireAccount} from './api.ts';
import {iconButton,announce} from './dom.ts';

export function mountAuth(root:HTMLElement,mode:'login'|'recover'|'password',onDone:()=>void,accountId?:string){
 const controller=new AbortController(),{signal}=controller;
 const view=document.createElement('section');root.appendChild(view);
 if(mode==='password'&&!accountId){view.innerHTML='<p role="alert">O link de recuperação não está ativo. Solicite um novo link para recuperar o acesso.</p>'+iconButton('key','Solicitar recuperação de senha','recover');return ()=>controller.abort();}
 view.innerHTML=mode==='login'?`<p>Entre com seu e-mail e senha. Se já usa esta conta no AraLearn, use a mesma senha.</p><form id="login"><label class="field">E-mail<input type="email" name="email" autocomplete="username" required></label><label class="field">Senha<input type="password" name="password" autocomplete="current-password" required></label><div class="submit-row">${iconButton('account-add','Criar conta','signup')}${iconButton('sign-in','Entrar','signin')}</div><p role="status" id="auth-status"></p></form><p>Esqueceu a senha?</p>${iconButton('key','Recuperar acesso','recover')}`:
 mode==='recover'?`<h2>Recuperar acesso</h2><p>Informe o e-mail da sua conta. O link permite escolher uma nova senha no site do Um, também se você estiver usando o Android.</p><form><label class="field">E-mail<input type="email" name="email" autocomplete="username" required></label><div class="submit-row">${iconButton('ready-state','Enviar link de recuperação','send-recovery')}</div><p role="status" id="auth-status"></p></form>`:
 `<h2>Escolher nova senha</h2><form><label class="field">Nova senha<input type="password" name="password" autocomplete="new-password" required minlength="8"></label><label class="field">Confirmar nova senha<input type="password" name="confirm" autocomplete="new-password" required minlength="8"></label><div class="submit-row">${iconButton('save','Salvar nova senha','save-password')}</div><p role="status" id="auth-status"></p></form>`;
 const form=view.querySelector('form')!,status=view.querySelector<HTMLElement>('#auth-status')!;let busy=false;
 const run=async(action:string)=>{
  if(busy||!form.reportValidity())return;
  const data=new FormData(form),password=String(data.get('password')||''),email=String(data.get('email')||'').trim();
  if(action==='signup'&&password.length<8){status.textContent='Use uma senha com pelo menos oito caracteres.';return;}
  if(action==='save-password'&&password!==data.get('confirm')){status.textContent='As senhas não coincidem.';return;}
  busy=true;form.querySelectorAll('button').forEach(b=>b.disabled=true);status.textContent='Aguarde…';
  try{
   if(action==='send-recovery'){
    const redirect=new URL(appUrl);redirect.searchParams.set('recovery','1');redirect.hash='';
    const result=await auth.resetPasswordForEmail(email,{redirectTo:redirect.href});if(result.error)throw result.error;
    status.textContent='Se este e-mail estiver cadastrado, você receberá um link para escolher uma nova senha. Confira também a pasta de spam.';
   }else if(action==='save-password'){
    await requireAccount(accountId!);const result=await auth.updateUser({password});if(result.error)throw result.error;await requireAccount(accountId!);
    if(!signal.aborted){announce('Senha atualizada.');onDone();}
   }else{
    const result=action==='signup'?await auth.signUp({email,password,options:{emailRedirectTo:appUrl}}):await auth.signInWithPassword({email,password});if(result.error)throw result.error;
    if(!result.data.session)status.textContent='Confira seu e-mail para confirmar a conta. Depois, volte ao Um para entrar.';
   }
  }catch(error){if(!signal.aborted)status.textContent=(error as Error).message;}
  finally{busy=false;if(!signal.aborted)form.querySelectorAll('button').forEach(b=>b.disabled=false);}
 };
 form.addEventListener('submit',e=>{e.preventDefault();void run(mode==='recover'?'send-recovery':mode==='password'?'save-password':'signin');},{signal});
 form.addEventListener('click',e=>{const action=(e.target as Element).closest<HTMLElement>('[data-action]')?.dataset.action;if(action){e.preventDefault();void run(action);}},{signal});
 return ()=>controller.abort();
}
