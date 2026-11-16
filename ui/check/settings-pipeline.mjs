// Real-browser check: Settings > Pipeline and the Codex/Kiro chat hookup (slice 3b-i). Fake adapters only, synthetic temp notes and a temp settings folder; no provider is called.
// Needs BATCH2A_OUTPUT (a folder outside the repo) for screenshots. Run from the ui folder after a build.
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright-core';
import {Store} from '../server/store.ts';
import {NoteWatcher} from '../server/watch.ts';
import {createApp} from '../server/http.ts';
import {SessionIndex} from '../server/harness/session-index.ts';
const output=path.resolve(process.env.BATCH2A_OUTPUT??'');assert(process.env.BATCH2A_OUTPUT&&!output.toLowerCase().startsWith(path.resolve('..').toLowerCase()),'BATCH2A_OUTPUT must be a folder outside the repo');await mkdir(output,{recursive:true});
const base=await mkdtemp(path.join(os.tmpdir(),'aitiarch-settings-pipeline-')),notes=path.join(base,'notes'),settings=path.join(base,'settings'),configFile=path.join(settings,'pipeline-config.json');await mkdir(notes);
await writeFile(path.join(notes,'plan.md'),'# Synthetic plan\n\nLaunch in June.\n');
const index=await SessionIndex.open(path.join(base,'harness'));let overCap=false,calls=0;
const answer='June.\n<claims>[{"source":"N1","quote":"Launch in June."}]</claims>';
const adapters=['codex','kiro','claude'].map(id=>({id,label:id==='codex'?'Codex':id==='kiro'?'Kiro':'Claude',safetyLabel:id==='codex'?'contained':id==='kiro'?'host-gated':'fenced',
 async *startTurn(){calls++;yield {type:'start'};yield {type:'delta',text:answer};yield {type:'complete',answer};yield {type:'usage',usage:id==='kiro'?{unit:'credits',amount:.05,afterTurn:true}:{unit:'tokens',amount:overCap?41000:100,afterTurn:true}};}}));
const provider={name:'claude',async checkAvailability(){return {available:true};},async invoke(){throw new Error('A live provider call is forbidden in this check.');}};
const store=await Store.open(notes),watcher=new NoteWatcher(store);await watcher.start();
const app=createApp({store,watcher,distDir:path.resolve('dist'),provider,pipelineConfigDir:settings,council:{index,adapters,availabilityChecks:adapters.map(a=>({...a,check:async()=>({available:true,reason:null})}))},harness:{command:process.execPath,prefixArgs:[path.resolve('test/fixtures/harness-cli.mjs')],dir:index.dir}});
let browser;
try{
 const url='http://127.0.0.1:'+await app.listen(0);browser=await chromium.launch({channel:'msedge',headless:true});
 const page=await browser.newPage({viewport:{width:1280,height:900}});page.setDefaultTimeout(12000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const boot=async()=>{await page.goto(url+'/?debug=1');await page.waitForSelector('.cm-editor');};
 const dialog=page.getByRole('dialog',{name:'AI settings'}),panel=page.locator('#chat-panel');
 const openSettings=async()=>{await page.getByRole('button',{name:'Notes menu',exact:true}).click();await page.getByRole('button',{name:'AI settings'}).click();await dialog.waitFor();await dialog.getByRole('tab',{name:'Pipeline'}).click();};
 const closeSettings=async()=>{await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});};
 const select=dialog.getByLabel('Normal chat is answered by'),save=dialog.getByRole('button',{name:'Save',exact:true});
 const openChat=async()=>{await page.getByRole('button',{name:/^Chat/}).first().click();await panel.waitFor();};
 const composer=()=>panel.getByRole('textbox',{name:'Message Aitiarch AI'});
 const sendThroughReview=async()=>{const review=panel.getByRole('region',{name:'What will be sent'});await review.waitFor();await review.getByRole('button',{name:'Send',exact:true}).click();};
 // 1. The section: the note, the three providers with safety label and availability, Save only when something changed.
 await boot();await openSettings();
 await dialog.getByText('Applies to every project on this computer.').waitFor();
 assert.equal(await select.inputValue(),'claude','Claude is the default');assert(await save.isDisabled(),'Save waits for a change');
 for(const [id,label] of [['claude','fenced'],['codex','contained'],['kiro','host-gated']]){const row=dialog.locator(`.pipeline-providers li[data-provider=${id}]`);assert.match(await row.innerText(),new RegExp(label));assert.match(await row.innerText(),/Available/);}
 await page.screenshot({path:path.join(output,'settings-pipeline.png')});
 // 2. The dropdown saves, through the server, and survives a reload.
 await select.selectOption('codex');await save.click();await dialog.getByText(/^Saved\./).waitFor();
 assert.deepEqual(JSON.parse(await readFile(configFile,'utf8')),{version:1,overrides:{normalAnswerer:'codex'}});
 await boot();await openSettings();assert.equal(await select.inputValue(),'codex','the choice is still there after a reload');
 // 3. A refused save shows the server's own sentence and changes nothing.
 await page.route('**/api/pipeline-config',route=>{if(route.request().method()!=='PUT')return route.continue();return route.continue({postData:JSON.stringify({overrides:{normalAnswerer:'gpt'}})});});
 await select.selectOption('kiro');await save.click();const error=dialog.locator('[data-notice=pipeline-error]');await error.waitFor();const said=(await error.innerText()).trim();
 assert(said.length>12&&!/^[a-z_]+$/.test(said),'the server error is shown in words: '+said);assert.equal(await dialog.getByText(/^Saved\./).count(),0);
 assert.deepEqual(JSON.parse(await readFile(configFile,'utf8')),{version:1,overrides:{normalAnswerer:'codex'}},'a refused save changes nothing on disk');await page.unroute('**/api/pipeline-config');
 // 4. Reset restores Claude and removes the saved file.
 await dialog.getByRole('button',{name:'Reset to defaults'}).click();await dialog.getByText(/^Reset\./).waitFor();assert.equal(await select.inputValue(),'claude');assert(!existsSync(configFile),'the saved settings are gone');
 // 5. Codex: the approval card appears before the first turn, bound to the provider, then the answer names it and shows tokens.
 await select.selectOption('codex');await save.click();await dialog.getByText(/^Saved\./).waitFor();await closeSettings();
 await openChat();await composer().fill('When is launch?');await composer().press('Enter');
 const card=panel.getByRole('group',{name:'Approval for Codex'});await card.waitFor();assert.equal(calls,0,'nothing is sent before approval');
 const cardText=await card.innerText();assert.match(cardText,/Before Codex answers/);assert.match(cardText,/contained/);assert.match(cardText,/Your notes only/);assert.match(cardText,/40,000 tokens/);assert.equal(await card.getAttribute('data-provider'),'codex');
 assert.equal(await panel.getByRole('group',{name:'Plan for this conversation'}).count(),0,'never Claude’s card');
 await page.screenshot({path:path.join(output,'chat-approval-codex.png')});
 await card.getByRole('button',{name:'Approve and send'}).click();await sendThroughReview();
 const reply=panel.locator('.chat-ai[data-provider=codex]');await reply.first().waitFor();
 assert.match(await reply.first().locator('.chat-who').innerText(),/AI · Codex/);assert.match(await reply.first().innerText(),/June\./);
 assert.match(await reply.first().locator('[data-usage=native]').innerText(),/This turn used 100 tokens/);assert.equal(calls,1);
 assert.equal((await panel.locator('.chat-sessions-note').innerText()).trim(),'This provider keeps no session. Your notes and recent exchanges are sent fresh with each message.');
 // 6. A turn over its cap: the notice says so, and the next message needs the approval again before anything runs.
 overCap=true;await composer().fill('Second question');await composer().press('Enter');await sendThroughReview();
 await panel.locator('[data-notice=over-cap]').waitFor();assert.match(await panel.locator('[data-notice=over-cap]').innerText(),/re-approve/i);assert.match(await panel.locator('[data-notice=over-cap]').innerText(),/This turn used more than|exceeded the approved cap/);assert.equal(calls,2);
 await page.screenshot({path:path.join(output,'chat-over-cap.png')});
 overCap=false;await composer().fill('Third question');await composer().press('Enter');
 const again=panel.getByRole('group',{name:'Approval for Codex'});await again.waitFor();assert.match(await panel.locator('.chat-plan-notice').innerText(),/approval was withdrawn/i);assert.equal(calls,2,'the blocked turn never ran');
 await again.getByRole('button',{name:'Cancel'}).click();await again.waitFor({state:'detached'});assert.equal(await composer().inputValue(),'Third question','Cancel gives the question back');
 await composer().press('Enter');await panel.getByRole('group',{name:'Approval for Codex'}).getByRole('button',{name:'Approve and send'}).click();await sendThroughReview();
 try{await page.waitForFunction(()=>document.querySelectorAll('#chat-panel .chat-ai[data-provider=codex]').length===3);}catch(e){console.log('PANEL AT FAILURE:\n'+await panel.innerText(),'\ncalls',calls);throw e;}
 assert.equal(calls,3);
 // 7. Kiro: its own card in the same conversation, credits not tokens, at phone width too.
 await page.keyboard.press('Escape');await panel.waitFor({state:'detached'});await openSettings();await select.selectOption('kiro');await save.click();await dialog.getByText(/^Saved\./).waitFor();
 await page.setViewportSize({width:360,height:740});{const wide=await page.evaluate(()=>{const d=document.querySelector('.settings-dialog'),r=d.getBoundingClientRect();return {dialogRight:Math.round(r.right),inside:[...d.querySelectorAll('*')].filter(e=>e.getBoundingClientRect().right>r.right+0.5).map(e=>e.tagName+'.'+String(e.className).slice(0,30)).slice(0,6)};});
  assert(wide.dialogRight<=360&&wide.inside.length===0,'the Settings dialog and its Pipeline pane fit at 360px: '+JSON.stringify(wide));}await page.screenshot({path:path.join(output,'settings-pipeline-360.png')});await closeSettings();
 await openChat();await composer().fill('When is launch, Kiro?');await composer().press('Enter');
 const kiro=panel.getByRole('group',{name:'Approval for Kiro'});await kiro.waitFor();const kb=await kiro.boundingBox();assert(kb&&kb.x>=0&&kb.x+kb.width<=360.5,'the approval card fits at 360px: '+JSON.stringify(kb));{const pc=await panel.boundingBox();assert(pc&&pc.x>=0&&pc.x+pc.width<=360.5,'the chat panel fits at 360px');}
 const kiroText=await kiro.innerText();assert.match(kiroText,/host-gated/);assert.match(kiroText,/0\.1 credits/);assert.equal(await kiro.getAttribute('data-provider'),'kiro');await page.screenshot({path:path.join(output,'chat-approval-kiro-360.png')});
 await kiro.getByRole('button',{name:'Approve and send'}).click();await sendThroughReview();const kiroReply=panel.locator('.chat-ai[data-provider=kiro]');await kiroReply.first().waitFor();
 assert.match(await kiroReply.first().locator('.chat-who').innerText(),/AI · Kiro/);assert.match(await kiroReply.first().locator('[data-usage=native]').innerText(),/0\.05 credits/);
 // 8. Reset: Claude again, and its memory line is back.
 await page.keyboard.press('Escape');await panel.waitFor({state:'detached'});await page.setViewportSize({width:1280,height:900});await openSettings();await dialog.getByRole('button',{name:'Reset to defaults'}).click();await dialog.getByText(/^Reset\./).waitFor();await closeSettings();
 await openChat();assert.match((await panel.locator('.chat-sessions-note').innerText()).trim(),/^Claude remembers this conversation/);
 assert.deepEqual(errors,[]);console.log(JSON.stringify({pass:true,calls,screenshots:output,refusedSaveSaid:said}));
}finally{await browser?.close();await app.close();watcher.stop();console.log('Cleanup target:',base);await rm(base,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
