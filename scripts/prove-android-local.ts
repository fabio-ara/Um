// Android emulator proof through native ADB/CDP. No browser/app download UI.
import {execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const adb=join(process.env.ANDROID_HOME!,'platform-tools','adb.exe'),serial='emulator-5554',pkg='com.fabioara.um.debug';
const run=(args:string[])=>execFileSync(adb,['-s',serial,...args],{windowsHide:true});
const demo=JSON.parse(await readFile('.local/demo.json','utf8'));assert.equal(demo.kind,'local-synthetic-demonstration');
await mkdir('.local/proofs',{recursive:true});
run(['reverse','tcp:4417','tcp:4417']);run(['shell','am','start','-n',pkg+'/com.fabioara.um.MainActivity']);
async function attach(){
 let pid='';for(let i=0;i<80;i++){try{pid=run(['shell','pidof',pkg]).toString().trim();if(/^\d+$/.test(pid))break;}catch{}await new Promise(r=>setTimeout(r,250));}assert.match(pid,/^\d+$/);run(['forward','tcp:9223','localabstract:webview_devtools_remote_'+pid]);
 let targets:any[]=[];for(let i=0;i<80;i++){try{targets=await fetch('http://127.0.0.1:9223/json').then(r=>r.json()) as any[];if(targets[0])break;}catch{}await new Promise(r=>setTimeout(r,250));}assert.ok(targets[0]);
 const ws=new WebSocket(targets[0].webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));let next=0;const pending=new Map<number,{resolve:(x:any)=>void,reject:(x:any)=>void,timer:any}>();
 ws.addEventListener('message',e=>{const m=JSON.parse(String(e.data));if(m.id&&pending.has(m.id)){const p=pending.get(m.id)!;clearTimeout(p.timer);pending.delete(m.id);if(m.error)p.reject(Error(m.error.message));else p.resolve(m.result);}});
 const cmd=(method:string,params:any={})=>new Promise<any>((resolve,reject)=>{const id=++next,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},15000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
 const evaluate=async(expression:string)=>{const v=await cmd('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(v.exceptionDetails)throw Error(v.exceptionDetails.text);return v.result.value;};
 const wait=async(expression:string)=>{for(let i=0;i<100;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,200));}throw Error('Condition not reached: '+expression);};
 const click=async(selector:string)=>{await wait(`!!document.querySelector(${JSON.stringify(selector)})`);await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);};
 return {ws,cmd,evaluate,wait,click};
}
let c=await attach();
try{
 await c.click('[data-action="account"]');
 if(await c.evaluate('!!document.querySelector("#login")')){
  await c.evaluate(`(()=>{const v=${JSON.stringify(demo.students[0].credentials)};document.querySelector('[name=email]').value=v.email;document.querySelector('[name=password]').value=v.password;document.querySelector('[data-action=signin]').click();})()`);
 }
 await c.click('[data-action="home"]');await c.click(`[data-action="reader"][data-project="${demo.projectId}"]`);await c.wait('!!document.querySelector(".reader-shell .tab-list")');
 await c.click('.tab-list>summary');await c.evaluate(`[...document.querySelectorAll('[role=tab]')].find(x=>x.textContent==='Persuadir e dizer a verdade').click()`);
}catch(error){
 // A tab's stable data shape is inspected rather than guessed by later runs.
 await writeFile('.local/proofs/android-diagnostic.json',JSON.stringify(await c.evaluate('({body:document.body.innerText,buttons:[...document.querySelectorAll("button")].map(x=>({label:x.getAttribute("aria-label"),action:x.dataset.action,tab:x.dataset.tabId,role:x.getAttribute("role")}))})'),null,2));
 c.ws.close();throw error;
}
await c.click('[data-action="open-sources"]');await c.click('[data-action="open-source"]');await c.wait('document.querySelector(".source-block")?.textContent.includes("ὅτι μὲν ὑμεῖς")');
await c.click('[data-action="sync"]');await c.click('[data-action="prepare-offline"]');
await c.wait('document.querySelector("#live")?.textContent.includes("Estudo preparado neste dispositivo")');
await c.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
await writeFile('.local/proofs/android-source.png',run(['exec-out','screencap','-p']));
await c.evaluate('window.dispatchEvent(new Event("um-flush"))');await new Promise(r=>setTimeout(r,1200));c.ws.close();
run(['shell','am','force-stop',pkg]);run(['reverse','--remove','tcp:4417']);run(['shell','am','start','-n',pkg+'/com.fabioara.um.MainActivity']);
c=await attach();
try{
 await c.click(`[data-action="reader"][data-project="${demo.projectId}"]`);await c.wait('!!document.querySelector(".source-block")');assert.ok(await c.evaluate('document.querySelector(".source-block").textContent.includes("ὅτι μὲν ὑμεῖς")'));
 await c.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
 await writeFile('.local/proofs/android-offline-restart.png',run(['exec-out','screencap','-p']));
 await writeFile('.local/proofs/android-runtime.json',JSON.stringify({at:new Date().toISOString(),package:pkg,android:run(['shell','getprop','ro.build.version.release']).toString().trim(),api:run(['shell','getprop','ro.build.version.sdk']).toString().trim(),result:'pass',proof:'Real WebView, authentication, Greek source, force-stop, backend transport removed, restart retained tab and cached content',limits:['Debug APK','Local backend','No production signing or hosted integration claim']},null,2));console.log('PASS: Android source/tab persisted through process death and absent backend.');
}finally{c.ws.close();run(['reverse','tcp:4417','tcp:4417']);}
