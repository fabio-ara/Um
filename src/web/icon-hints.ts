// One delegated hint for dynamic icon bars. Accessible names stay on the controls.
export function installIconHints(){
 const tip=document.createElement('div');tip.className='icon-hint';tip.setAttribute('role','tooltip');tip.hidden=true;document.body.append(tip);
 let owner:HTMLElement|null=null,timer:ReturnType<typeof setTimeout>|undefined,pressed:HTMLElement|null=null,suppress:HTMLElement|null=null,pinned=false,start={x:0,y:0};
 const control=(target:EventTarget|null)=>target instanceof Element?target.closest<HTMLElement>('.icon-button[aria-label]'):null;
 const cancel=()=>{clearTimeout(timer);timer=undefined;pressed=null;};
 const hide=()=>{tip.hidden=true;owner=null;pinned=false;};
 const show=(button:HTMLElement)=>{
  if(!button.isConnected)return;owner=button;tip.textContent=button.getAttribute('aria-label');tip.hidden=false;
  const b=button.getBoundingClientRect(),t=tip.getBoundingClientRect();
  tip.style.left=Math.max(8,Math.min(innerWidth-t.width-8,b.left+b.width/2-t.width/2))+'px';
  tip.style.top=(b.bottom+t.height+12<innerHeight?b.bottom+6:Math.max(8,b.top-t.height-6))+'px';
 };
 document.addEventListener('focusin',e=>{const b=control(e.target);if(b?.matches(':focus-visible'))show(b);});
 document.addEventListener('focusout',()=>{if(!pinned)hide();});
 document.addEventListener('pointerover',e=>{const b=control(e.target);if(e.pointerType==='mouse'&&b)show(b);});
 document.addEventListener('pointerout',e=>{if(!pinned&&e.pointerType==='mouse'&&owner&&!owner.contains(e.relatedTarget as Node|null))hide();});
 document.addEventListener('pointerdown',e=>{cancel();hide();suppress=null;const b=control(e.target);if(e.pointerType!=='mouse'&&b){pressed=b;start={x:e.clientX,y:e.clientY};timer=setTimeout(()=>{suppress=b;show(b);pinned=true;},550);}});
 document.addEventListener('pointermove',e=>{if(pressed&&Math.hypot(e.clientX-start.x,e.clientY-start.y)>10){cancel();hide();}});
 document.addEventListener('pointerup',cancel);document.addEventListener('pointercancel',()=>{cancel();hide();});
 document.addEventListener('click',e=>{const b=control(e.target);if(b&&b===suppress&&e.detail!==0){e.preventDefault();e.stopImmediatePropagation();suppress=null;return;}hide();},true);
 document.addEventListener('contextmenu',e=>{const b=control(e.target);if(b&&b===suppress)e.preventDefault();});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'){cancel();hide();}});
 document.addEventListener('scroll',hide,true);window.addEventListener('resize',hide);window.addEventListener('blur',hide);
 new MutationObserver(()=>{if(owner&&!owner.isConnected)hide();}).observe(document.getElementById('app')!,{childList:true,subtree:true});
}
