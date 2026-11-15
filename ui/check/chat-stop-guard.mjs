// Real-browser check: in a ~390 px wide chat, a double tap on the review card's Send (or Enter then a click) must not hit the Stop that takes its place.
// Synthetic OS-temp note, in-process server, scripted fake stream, no CLI, no network.
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
const root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-stop-guard-'));
await writeFile(path.join(root,'fixture.md'),'# Stop guard fixture\n\nA short synthetic note.\n');
// A reply that stays open until the check cancels it.
const provider={name:'claude',async checkAvailability(){return {available:true};},
 async invoke(request,options={}){
  options.onTextDelta?.('{"answer":"Thinking about the first part of the reply here, ');
  await new Promise((_,reject)=>options.signal?.addEventListener('abort',()=>reject(new ProviderError('cancelled'))));
 }};
const store=await Store.open(root),watcher=new NoteWatcher(store),app=createApp({store,watcher,distDir:path.join(here,'../dist'),provider});
let browser;
try{
 const url=`http://127.0.0.1:${await app.listen(0)}/?debug=1`;
 for(const channel of ['msedge','chrome']){try{browser=await chromium.launch({channel,headless:true});break;}catch{/* next */}}
 if(!browser)throw new Error('Edge or Chrome is required.');
 const page=await (await browser.newContext({viewport:{width:390,height:844}})).newPage();page.setDefaultTimeout(8000);
 await page.goto(url);await page.waitForSelector('.cm-editor');
 await page.getByRole('button',{name:/^Chat/}).first().click();const panel=page.locator('#chat-panel');await panel.waitFor();
 const width=(await panel.boundingBox()).width;assert.ok(width>=360&&width<=390.5,'the panel is about 390 px wide (it is '+width+')');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'no sideways overflow at this width');
 const composer=panel.getByRole('textbox',{name:'Message Aitiarch AI'});await composer.fill('A question');await composer.press('Enter');
 const review=panel.getByRole('region',{name:'What will be sent'});await review.waitFor();
 const send=review.getByRole('button',{name:'Send',exact:true}),box=await send.boundingBox(),x=box.x+box.width/2,y=box.y+box.height/2;
 // Two quick taps on the same spot: the second one lands wherever the Send button used to be.
 await page.mouse.click(x,y);await page.waitForTimeout(80);await page.mouse.click(x,y);
 // And the tap that lands on Stop itself the moment it appears (it takes the place Send had on a narrow panel).
 const stop=panel.getByRole('button',{name:'Stop',exact:true});await stop.waitFor();await stop.click();
 await panel.locator('.chat-streaming').waitFor();await page.waitForTimeout(150);
 assert.equal(await panel.locator('.chat-error').count(),0,'a double tap did not cancel the request');
 assert.equal(await panel.locator('.chat-streaming').count(),1,'the reply is still streaming after the double tap');
 // Later, Stop works.
 await page.waitForTimeout(650);await panel.getByRole('button',{name:'Stop',exact:true}).click();
 await panel.locator('.chat-error').waitFor();assert.match(await panel.locator('.chat-error').innerText(),/cancel/i);
 await page.screenshot({path:path.join(output,'chat-stop-guard-390.png')});
 console.log(JSON.stringify({passed:true,panelWidth:Math.round(width)}));
}finally{await browser?.close();await app.close();watcher.stop();await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
