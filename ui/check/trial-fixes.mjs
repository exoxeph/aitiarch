// Disposable synthetic notebook and fake provider only. Screenshots stay outside the repo.
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';
import {Store} from '../server/store.ts';import {NoteWatcher} from '../server/watch.ts';import {createApp} from '../server/http.ts';
import {InkStore} from '../server/ink-store.ts';import {captureAnchor} from '../shared/anchors.ts';
const here=path.dirname(fileURLToPath(import.meta.url));
const root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-trial-check-'));
const screenshots=await mkdtemp(path.join(os.tmpdir(),'aitiarch-trial-screens-'));
const note='# Synthetic trial\n\n'+Array.from({length:12},(_,n)=>`Paragraph ${n+1}. The fictional repair app keeps a list of requests for a volunteer. This is body text behind the floating toolbar.`).join('\n\n')+'\n';
await writeFile(path.join(root,'fixture.md'),note);
const ink=await InkStore.open(root),snapshot=await ink.read('fixture.md'),from=note.indexOf('Paragraph 5.'),anchor=captureAnchor(note,from,from+12);
for(let n=0;n<5;n++)snapshot.document.items.push({id:'answer-'+n,kind:'answer',body:'Synthetic extra answer '+n,anchor,originalAnchor:anchor,attachment:{status:'attached',...anchor.position}});await ink.write('fixture.md',snapshot.document,null);
const store=await Store.open(root),watcher=new NoteWatcher(store);await watcher.start();
const app=createApp({store,watcher,distDir:path.join(here,'../dist'),provider:{name:'claude',checkAvailability:async()=>({available:true}),invoke:async()=>{throw new Error('This check never invokes a provider.');}}});
let browser;
try{
 const port=await app.listen(0);browser=await chromium.launch({channel:'msedge',headless:true});
 for(const theme of ['light','dark'])for(const width of [1440,375]){
  const page=await browser.newPage({viewport:{width,height:900},colorScheme:theme});const errors=[];page.on('pageerror',e=>errors.push(e.name));
  await page.goto(`http://127.0.0.1:${port}/?debug=1`);await page.waitForSelector('.cm-editor');
  const more=page.locator('.cm-ink-group summary');await more.waitFor();assert.equal(await more.textContent(),'Show 3 more');assert.equal(await page.locator('.cm-ink-block:visible').count(),2);await more.click();assert.equal(await page.locator('.cm-ink-block:visible').count(),5);await more.click();
  for(const phrase of ['Paragraph 5.','Synthetic trial']){
   await page.evaluate(phrase=>{const {view}=window.__aitiarch['fixture.md'],from=view.state.doc.toString().indexOf(phrase);view.dispatch({selection:{anchor:from,head:from+phrase.length},scrollIntoView:true});view.focus();},phrase);
   const toolbar=page.getByRole('toolbar',{name:'Format selection'});await toolbar.waitFor();
   await page.waitForTimeout(100);
   const shape=await toolbar.evaluate(el=>{const r=el.getBoundingClientRect(),style=getComputedStyle(el),top=document.elementFromPoint(r.left+Math.min(15,r.width/2),r.top+Math.min(15,r.height/2));return {background:style.backgroundColor,inside:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,aboveBody:el.contains(top)||top===el};});
   assert.notEqual(shape.background,'rgba(0, 0, 0, 0)','toolbar must be opaque over note text');assert(shape.inside,'toolbar must stay in viewport');assert(shape.aboveBody,'toolbar must paint above note text');
   await page.screenshot({path:path.join(screenshots,`toolbar-${theme}-${width}-${phrase==='Synthetic trial'?'top':'body'}.png`)});
  }
  assert.equal(errors.length,0);await page.close();
 }
 console.log(JSON.stringify({pass:true,screenshots,checks:['opaque toolbar','layering','viewport at body and top','light/dark','wide/narrow'],providerCalls:0}));
}finally{await browser?.close();watcher.stop();await app.close();await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
