import {expect,type Page} from '@playwright/test';
/** Use the browser's real Range/Selection; the source may contain nested marks. */
export async function selectAndCapture(page:Page,blockId:string,start:number,end:number){
 await page.evaluate(({blockId,start,end})=>{
  const block=[...document.querySelectorAll<HTMLElement>('.source-block[data-block-id]')].find(el=>el.dataset.blockId===blockId);
  if(!block)throw Error('Bloco ausente.');
  const pointAt=(target:number)=>{
   let seen=0;const walker=document.createTreeWalker(block,NodeFilter.SHOW_TEXT);let node:Node|null;
   while((node=walker.nextNode())){const text=node as Text,points=Array.from(text.data);if(target<=seen+points.length)return {node:text,offset:points.slice(0,target-seen).join('').length};seen+=points.length;}
   throw Error('Posição fora do bloco.');
  };
  const from=pointAt(start),to=pointAt(end),range=document.createRange();range.setStart(from.node,from.offset);range.setEnd(to.node,to.offset);
  const selection=window.getSelection();if(!selection)throw Error('Selection indisponível.');selection.removeAllRanges();selection.addRange(range);
 },{blockId,start,end});
 await page.getByRole('button',{name:'Usar seleção',exact:true}).click();
 await expect(page.locator('.selection-panel')).toBeVisible();
}
