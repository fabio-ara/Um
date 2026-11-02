import {effectiveAnswers,visibleQuestions,validateSubmission} from '../forms.ts';
import type {FormDefinition,Answers} from '../contracts.ts';
import {escapeHtml as esc,iconButton,announce,type StudyApi} from './dom.ts';

export async function mountForm(root:HTMLElement,formId:string,api:StudyApi,onExit:()=>void){
 const loaded=await api('form_get',{formId}),form=loaded.definition as FormDefinition;
 if(!loaded.published)throw Error('Esta preparação ainda não foi disponibilizada.');
 let pending=loaded.pendingSubmission as Record<string,any>|null;
 const previous=loaded.submission?.formRevision===form.revision?loaded.submission.answers:{};
 let answers:Answers=pending?.answers||loaded.draft?.answers||previous,draftRevision=loaded.draft?.revision||0,chain=Promise.resolve(),timer:ReturnType<typeof setTimeout>|undefined,disposed=false,dirty=false,submitting=false,confirmed=false,navigating=false;
 const controller=new AbortController(),{signal}=controller;
 const unanswered=visibleQuestions(form,answers).findIndex(q=>q.required&&!(Array.isArray(answers[q.id])?(answers[q.id] as string[]).length:String(answers[q.id]||'').trim().length));
 let step=pending?visibleQuestions(form,answers).length-1:unanswered<0?0:unanswered;
 root.innerHTML=`<div class="section-title"><h1>Preparação do estudo</h1>${iconButton('arrow-left','Voltar aos estudos','back')}</div><p class="muted">Suas respostas ajudam a preparar os apoios deste estudo. Perguntas de texto são opcionais.</p>${loaded.submission?'<p>Você já enviou respostas. Pode revê-las e enviar uma correção; os apoios anteriores conservam a referência ao envio usado.</p>':''}<form id="preparation"><p id="form-progress" class="muted" aria-live="polite"></p><div id="questions" tabindex="-1"></div><p class="statusline" role="status"></p><div class="submit-row">${iconButton('arrow-left','Pergunta anterior','previous')}${iconButton('save','Salvar rascunho','save')}${iconButton('arrow-right','Próxima pergunta','next')}${iconButton('ready-state','Enviar respostas','submit')}${iconButton('edit','Corrigir respostas enviadas','edit-answers')}</div></form>`;
 const questions=root.querySelector<HTMLElement>('#questions')!,status=root.querySelector<HTMLElement>('.statusline')!;
 const button=(action:string)=>root.querySelector<HTMLButtonElement>(`[data-action=${action}]`)!;
 function draw(focus=false){
  const active=(document.activeElement as HTMLElement)?.dataset?.question,visible=visibleQuestions(form,answers);step=Math.min(step,Math.max(0,visible.length-1));const q=visible[step];
  root.querySelector('#form-progress')!.textContent=`Pergunta ${step+1} de ${visible.length} no percurso atual. O percurso pode mudar conforme suas respostas.`;
  questions.innerHTML=!q?'':q.type==='text'?`<label class="field">${esc(q.prompt)} <span class="muted">Opcional</span><textarea data-question="${esc(q.id)}">${esc(answers[q.id]||'')}</textarea></label>`:`<fieldset><legend>${esc(q.prompt)}${q.required?' <span class="sr-only">Obrigatória</span>':''}</legend>${q.options!.map(o=>`<label class="option"><input data-question="${esc(q.id)}" name="${esc(q.id)}" type="${q.type==='single_choice'?'radio':'checkbox'}" value="${esc(o.id)}" ${(Array.isArray(answers[q.id])?(answers[q.id] as string[]).includes(o.id):answers[q.id]===o.id)?'checked':''}><span>${esc(o.label)}</span></label>`).join('')}</fieldset>`;
  const locked=submitting||confirmed||Boolean(pending);button('previous').hidden=step===0||locked;button('next').hidden=step===visible.length-1||locked;button('submit').hidden=step!==visible.length-1||confirmed;button('submit').disabled=submitting;button('submit').setAttribute('aria-label',pending?'Conferir envio pendente':'Enviar respostas');button('save').hidden=locked;button('edit-answers').hidden=!confirmed||submitting;
  if(locked)questions.querySelectorAll<HTMLInputElement|HTMLTextAreaElement>('input,textarea').forEach(e=>e.disabled=true);
  if(focus)questions.focus();else if(active)questions.querySelector<HTMLElement>(`[data-question="${CSS.escape(active)}"]`)?.focus();
 }
 async function save(){
  if(!dirty||disposed||pending)return;const snapshot=structuredClone(answers);dirty=false;const op=crypto.randomUUID();
  chain=chain.then(async()=>{try{status.textContent='Salvando…';const r=await api('form_draft',{operationId:op,formId,formRevision:form.revision,expectedRevision:draftRevision,answers:snapshot});draftRevision=r.result.draftRevision;status.textContent=r.status==='confirmed'?'Rascunho salvo.':'Rascunho neste dispositivo; envio pendente.';}catch(e){dirty=true;status.textContent=(e as Error).message;status.classList.add('error');}});await chain;
 }
 function changed(event:Event){
  const input=event.target as HTMLInputElement|HTMLTextAreaElement,q=form.questions.find(q=>q.id===input.dataset.question);if(!q||submitting||confirmed||pending)return;
  if(q.type==='multiple_choice')answers[q.id]=[...questions.querySelectorAll<HTMLInputElement>(`input[data-question="${CSS.escape(q.id)}"]:checked`)].map(e=>e.value);else answers[q.id]=input.value;
  answers=effectiveAnswers(form,answers);dirty=true;if(q.type!=='text')draw();clearTimeout(timer);timer=setTimeout(()=>void save(),600);
 }
 root.addEventListener('input',changed,{signal});
 for(const event of ['pagehide','um-flush'])window.addEventListener(event,()=>void save(),{signal});
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')void save();},{signal});
 root.querySelector('form')!.addEventListener('submit',e=>e.preventDefault(),{signal});
 root.addEventListener('click',async e=>{
  const action=(e.target as Element).closest<HTMLElement>('[data-action]')?.dataset.action;if(!action)return;
  if(action==='save'){await save();announce(status.textContent||'');}
  if(action==='back'){await save();onExit();}
  if(action==='edit-answers'&&confirmed&&!submitting){confirmed=false;submitting=false;step=0;status.textContent='Revise as respostas e envie novamente para confirmar a correção.';draw(true);}
  if((action==='previous'||action==='next')&&!submitting&&!confirmed&&!pending&&!navigating){
   const visible=visibleQuestions(form,answers),q=visible[step],answer=answers[q.id];
   if(action==='next'&&q.required&&!(Array.isArray(answer)?answer.length:String(answer||'').trim().length)){status.textContent='Escolha uma resposta para continuar.';return;}
   navigating=true;try{await save();if(disposed)return;step=Math.max(0,Math.min(visible.length-1,step+(action==='next'?1:-1)));draw(true);}finally{navigating=false;}
  }
  if(action==='submit'){
   if(submitting||confirmed||navigating)return;
   try{
    const normalized=validateSubmission(form,answers);submitting=true;draw();await save();await chain;pending||={operationId:crypto.randomUUID(),formId,formRevision:form.revision,answers:normalized};status.textContent='Enviando…';
    const r=await api('form_submit',pending);submitting=false;confirmed=r.status==='confirmed';if(confirmed){draftRevision=0;pending=null;}
    status.textContent=confirmed?'Respostas enviadas. Volte à conversa com o Um no ChatGPT e peça para continuar o estudo. O envio não inicia a preparação automaticamente.':'Respostas salvas neste dispositivo. Envio pendente de conexão.';draw();announce(status.textContent);
   }catch(error){submitting=false;if([400,403,404,409,422].includes((error as any)?.status))pending=null;draw();status.textContent=(error as Error).message;status.classList.add('error');announce(status.textContent);}
  }
 },{signal});if(pending)status.textContent='Há um envio pendente neste dispositivo. Conecte-se e confira o envio antes de corrigir as respostas.';draw();
 return ()=>{clearTimeout(timer);void save();disposed=true;controller.abort();};
}
