// Real pointer clicks, controlled Date only: an accidental tap before 600ms must
// not cancel; a deliberate Stop double tap at/after 600ms must cancel. RAF,
// animations, scrolling and network keep running on real time.
// Synthetic OS-temp note, in-process server, scripted fake stream, no CLI, no network.
import './config-isolation.mjs'; // first: an empty temp config folder, never the machine's real one
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,mkdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';
import {Store} from '../server/store.ts';
import {NoteWatcher} from '../server/watch.ts';
import {createApp} from '../server/http.ts';
import {ProviderError} from '../server/providers/index.ts';

const here=path.dirname(fileURLToPath(import.meta.url));
const output=process.env.BATCH2A_OUTPUT||process.env.GROVE_OUTPUT;
if(!output)throw new Error('Set BATCH2A_OUTPUT (or GROVE_OUTPUT) to a folder outside the repository.');
await mkdir(output,{recursive:true});
let browser;
try{
 for(const channel of ['msedge','chrome']){try{browser=await chromium.launch({channel,headless:true});break;}catch{/* next */}}
 if(!browser)throw new Error('Edge or Chrome is required.');
 const results=[];
 for(const [width,height] of [[390,844],[1440,900],[1024,800],[1440,700],[1280,650],[600,800],[390,860],[360,640]]){
  const root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-stop-guard-'));
  await writeFile(path.join(root,'fixture.md'),'# Stop guard fixture\n\nA short synthetic note.\n');
  let started;const running=new Promise(resolve=>{started=resolve;});
  const provider={name:'claude',async checkAvailability(){return {available:true};},async invoke(request,options={}){
   options.onTextDelta?.('{"answer":"Thinking about the first part of the reply here, ');started();
   await new Promise((_,reject)=>options.signal?.addEventListener('abort',()=>reject(new ProviderError('cancelled'))));
  }};
  const store=await Store.open(root),watcher=new NoteWatcher(store),app=createApp({store,watcher,distDir:path.join(here,'../dist'),provider});
  const context=await browser.newContext({viewport:{width,height}}),page=await context.newPage();page.setDefaultTimeout(8000);
  let cancels=0;page.on('request',r=>{if(new URL(r.url()).pathname==='/api/chat/cancel')cancels++;});
  try{
   await page.goto(`http://127.0.0.1:${await app.listen(0)}/?debug=1`);await page.waitForSelector('.cm-editor');
   await page.evaluate(()=>{
    window.__stopClicks=[];
    document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b||!['Send','Stop'].includes(b.textContent.trim()))return;
     const hit=document.elementFromPoint(e.clientX,e.clientY);window.__stopClicks.push({button:b.textContent.trim(),time:Date.now(),realMs:performance.now(),x:e.clientX,y:e.clientY,hit:hit?.tagName,hitClass:hit?.className,reachable:!!hit&&b.contains(hit)});
    },true);
   });
   await page.getByRole('button',{name:/^Chat/}).first().click();const panel=page.locator('#chat-panel');await panel.waitFor();
   await panel.evaluate(el=>Promise.all(el.getAnimations().map(a=>a.finished)));
   // Retain the original 390px shell assertions; the additional sizes test Stop reachability.
   if(width===390){const w=(await panel.boundingBox()).width;assert.ok(w>=360&&w<=390.5,'the panel is about 390 px wide (it is '+w+')');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`no sideways overflow at ${width}x${height}`);
   }
   const composer=panel.getByRole('textbox',{name:'Message Aitiarch AI'});await composer.fill('A question');await composer.press('Enter');
   const review=panel.getByRole('region',{name:'What will be sent'});await review.waitFor();
   const send=review.getByRole('button',{name:'Send',exact:true});
   // Bound the clock to the send, not to how quickly CDP returns from a click.
   // The old check's first click sometimes took >900ms, making its "early" Stop deliberate.
   const sentAt=Date.now();await page.clock.setFixedTime(new Date(sentAt));
   const box=await send.boundingBox(),x=box.x+box.width/2,y=box.y+box.height/2;
   await page.mouse.click(x,y);await running;
   // Explicitly exercise a slow driver without letting it change the guard's test time.
   if(width===390&&height===844)await new Promise(resolve=>setTimeout(resolve,750));
   await page.clock.setFixedTime(new Date(sentAt+80));await page.mouse.click(x,y);
   const stop=panel.getByRole('button',{name:'Stop',exact:true});await stop.waitFor();
   const reach=()=>stop.evaluate(b=>{
    const r=b.getBoundingClientRect(),points=[[.5,.5],[.25,.25],[.75,.25],[.25,.75],[.75,.75]];
    return {inside:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,points:points.map(([x,y])=>{const hit=document.elementFromPoint(r.x+r.width*x,r.y+r.height*y);return {hit:hit?.tagName,hitClass:hit?.className,reachable:!!hit&&b.contains(hit)};})};
   });
   // Let real auto-scroll/animation settle, without advancing Date past the guard.
   await page.waitForFunction(()=>{const b=document.querySelector('#chat-panel .chat-stop');if(!b)return false;const r=b.getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&[[.5,.5],[.25,.25],[.75,.25],[.25,.75],[.75,.75]].every(([x,y])=>b.contains(document.elementFromPoint(r.x+r.width*x,r.y+r.height*y)));});
   const hit=await reach();assert(hit.inside&&hit.points.every(p=>p.reachable),`Stop is uncovered at ${width}x${height}: ${JSON.stringify(hit)}`);
   await stop.click();await panel.locator('.chat-streaming').waitFor();await page.waitForTimeout(150);
   assert.equal(cancels,0,'an accidental tap at 80ms sends no cancel');
   assert.equal(await panel.locator('.chat-error').count(),0,'a double tap did not cancel the request');
   assert.equal(await panel.locator('.chat-streaming').count(),1,'the reply is still streaming after the double tap');
   await page.clock.setFixedTime(new Date(sentAt+599));await stop.click();
   assert.equal(cancels,0,'Stop still ignores an accidental tap at 599ms');
   assert.equal(await panel.locator('.chat-error').count(),0,'the full 600ms guard is retained');
   await page.clock.setFixedTime(new Date(sentAt+600));await stop.dblclick();
   await panel.locator('.chat-error').waitFor();assert.match(await panel.locator('.chat-error').innerText(),/cancel/i);
   assert(cancels>=1,'a deliberate Stop double tap at 600ms sends cancel');
   assert.equal(await panel.locator('.chat-streaming').count(),0,'deliberate Stop ends the stream');
   const clicks=await page.evaluate(()=>window.__stopClicks);assert(clicks.filter(c=>c.button==='Stop').every(c=>c.reachable),'every actual Stop click hit the button');
   results.push({width,height,cancels,reach:hit,clicks});
   if(width===390&&height===844)await page.screenshot({path:path.join(output,'chat-stop-guard-390.png')});
  }finally{await context.close();await app.close();watcher.stop();console.log('Cleanup target:',root);await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
 }
 console.log(JSON.stringify({passed:true,results}));
}finally{await browser?.close();}
