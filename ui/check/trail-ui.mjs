// Real-browser check for M5: the investigation trail, the permission card and the AI settings screens, against scripted fake streams.
// Synthetic OS-temp project, in-process server, scripted runners. No CLI, no network, no real notebook.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,realpathSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';
import {Store} from '../server/store.ts';
import {NoteWatcher} from '../server/watch.ts';
import {createApp} from '../server/http.ts';
import {FakeChatProvider} from '../server/chat/fake.ts';

const here=path.dirname(fileURLToPath(import.meta.url));
const output=process.env.BATCH2A_OUTPUT||process.env.GROVE_OUTPUT;
if(!output)throw new Error('Set BATCH2A_OUTPUT (or GROVE_OUTPUT) to a folder outside the repository.');
mkdirSync(output,{recursive:true});
const project=mkdtempSync(path.join(realpathSync.native(os.tmpdir()),'aitiarch-trail-ui-')),root=path.join(project,'.aitiarch');
mkdirSync(root);mkdirSync(path.join(project,'src'));mkdirSync(path.join(project,'docs'));
execFileSync('git',['init','-q'],{cwd:project,stdio:'pipe'});
writeFileSync(path.join(project,'src','parse.ts'),Array.from({length:12},(_,i)=>`// parser line ${i+1}`).join('\n')+'\n');
const note='# Plan\n\nA paragraph the answer will land under.\n';
const bytes=Buffer.from('﻿'+note.replace(/\n/g,'\r\n'));
writeFileSync(path.join(root,'plan.md'),bytes);

// A scripted runner: each call takes the next step from the queue. Steps may emit events, wait on a gate, or hang until aborted.
class Scripted{
 calls=[];queue=[];
 async run(input){this.calls.push(input);const step=this.queue.shift();if(!step)throw new Error('No scripted step.');return step(input);}
}
const runner=new Scripted();
const result=obj=>({text:JSON.stringify(obj),tokens:30,cost:null,turns:1});
const envelope=(say,delegate=[])=>result({say,delegate});
const lookupJob={id:'l1',kind:'lookup',agent:'claude',task:JSON.stringify({op:'read',path:'src/parse.ts',from:1,to:20}),scope:['src/parse.ts'],why:'Read the parser.'};
const agentJob=id=>({id,kind:'agent',agent:'claude',task:'Explain what the parser does.',scope:['src/parse.ts'],why:'Summarise it.'});
const hangUntilAborted=input=>new Promise((_,reject)=>input.signal.addEventListener('abort',()=>reject(new Error('aborted'))));
let release=()=>{};
const gate=()=>{let go;const p=new Promise(r=>{go=r;});release=()=>go();return p;};
const REPORT={findings:[{claim:'The parser trims input before it splits it.',evidence:[{path:'src/parse.ts',lines:[3,6]}]}],unknowns:[],files_read:['src/parse.ts']};

const store=await Store.open(root),watcher=new NoteWatcher(store);
const app=createApp({store,watcher,distDir:path.join(here,'../dist'),provider:new FakeChatProvider(),investigator:{claude:runner}});
let browser;const external=[];
try{
 const url=`http://127.0.0.1:${await app.listen(0)}/?debug=1`;
 for(const channel of ['msedge','chrome']){try{browser=await chromium.launch({channel,headless:true});break;}catch{/* next */}}
 if(!browser)throw new Error('Edge or Chrome is required.');
 const newPage=async(options={})=>{
  const context=await browser.newContext({viewport:{width:1440,height:900},...options}),page=await context.newPage();page.setDefaultTimeout(8000);
  page.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1')&&!r.url().startsWith('data:')&&!r.url().startsWith('blob:'))external.push(r.url());});
  await page.goto(url);await page.waitForSelector('.cm-editor');
  return {context,page};
 };
 const {context,page}=await newPage();
 const panel=page.locator('#chat-panel'),dialog=page.getByRole('dialog',{name:'AI settings'});
 const doc=()=>page.evaluate(()=>window.__aitiarch['plan.md'].view.state.doc.toString());
 const policy=()=>page.evaluate(async()=>(await fetch('/api/investigator')).json());
 const openChat=async()=>{await page.getByRole('button',{name:/^Chat/}).click();await panel.waitFor();};
 const closeChat=async()=>{await panel.getByRole('button',{name:'Close chat'}).click();await panel.waitFor({state:'hidden'});};
 const openSettings=async()=>{await page.getByRole('button',{name:'Notes menu',exact:true}).click();await page.locator('#note-tree[data-state="open"]').waitFor();await page.locator('#note-tree').getByRole('button',{name:'AI settings'}).click();await dialog.waitFor();};
 const closeSettings=async()=>{await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});};
 const ask=async q=>{await page.waitForFunction(()=>{const t=document.querySelector('.chat-composer textarea');return t&&!t.disabled;});const c=panel.getByRole('textbox',{name:'Message Aitiarch AI'});await c.fill(q);await c.press('Enter');};
 const investigate=async()=>{const chip=panel.getByRole('button',{name:'Investigate',exact:true});if((await chip.getAttribute('aria-pressed'))!=='true')await chip.click();assert.equal(await chip.getAttribute('aria-pressed'),'true');};

 // ======== the provider consent screen: off by default, nothing runs before consent
 await openChat();
 const chip=panel.getByRole('button',{name:'Investigate',exact:true});
 assert.equal(await chip.getAttribute('aria-disabled'),'true','the Investigate switch is off until the investigator is turned on');
 await chip.click({force:true});await dialog.waitFor(); // aria-disabled still lets a click through, and it leads straight to the settings
 assert.equal(runner.calls.length,0);
 const turnOn=dialog.getByRole('button',{name:'Turn on the investigator'});
 await turnOn.waitFor();for(const needle of ['Read-only.','Only through Aitiarch.','Codex agents stay blocked.','Off by default'])assert.ok((await dialog.innerText()).includes(needle),`consent screen says “${needle}”`);
 assert.equal(await turnOn.isDisabled(),true,'it cannot be turned on before the box is ticked');
 await dialog.getByLabel(/I understand what the investigator/).check();assert.equal(await turnOn.isDisabled(),false);
 await turnOn.click();await dialog.getByText('The investigator is on.').waitFor();
 assert.equal((await policy()).policy.enabled,true);assert.equal(runner.calls.length,0,'turning it on runs nothing');

 // ======== folders, permissions, deny list
 await dialog.getByRole('tab',{name:'Folders and permissions'}).click();
 const roots=dialog.locator('.roots li');assert.equal(await roots.count(),1);
 assert.equal(await dialog.getByRole('button',{name:`Remove folder ${project}`}).isDisabled(),true,'the last folder cannot be removed');
 await dialog.getByLabel('Folder to add').fill('docs');await dialog.getByRole('button',{name:'Add folder'}).click();
 assert.match(await dialog.getByRole('alert').first().innerText(),/absolute/i);
 const docs=path.join(project,'docs');
 await dialog.getByLabel('Folder to add').fill(docs);await dialog.getByRole('button',{name:'Add folder'}).click();await page.waitForFunction(()=>document.querySelectorAll('.roots li').length===2);
 await dialog.getByRole('button',{name:`Remove folder ${docs}`}).click();await page.waitForFunction(()=>document.querySelectorAll('.roots li').length===1);
 await dialog.getByLabel('Folder to add').fill(path.join(project,'.git'));await dialog.getByRole('button',{name:'Add folder'}).click();
 await page.waitForFunction(()=>/not allowed/i.test(document.querySelector('.settings-problem-bar')?.textContent??''));
 const deny=dialog.getByRole('list',{name:'Always blocked'});assert.equal(await deny.locator('li').count(),10);assert.ok((await deny.innerText()).includes('.env'));
 const inside=dialog.getByLabel('Read inside registered folders permission');
 assert.equal(await inside.locator('option[value="notebook"]').isDisabled(),true,'Always needs private storage');
 await inside.selectOption('ask');await page.waitForFunction(async()=>(await (await fetch('/api/investigator')).json()).policy.tiers.inside==='ask');
 await page.screenshot({path:path.join(output,'settings-folders.png')});
 // Put the default back for the full run below (the screen cannot choose Always without private storage, the API can).
 await page.evaluate(async()=>{const p=(await (await fetch('/api/investigator')).json()).policy;await fetch('/api/investigator/configure',{method:'PUT',headers:{'Content-Type':'application/json','X-Aitiarch':'1'},body:JSON.stringify({tiers:{...p.tiers,inside:'notebook'}})});});

 // ======== caps: a bad number is refused on screen, a good one is saved
 await dialog.getByRole('tab',{name:'Limits'}).click();
 const agents=dialog.getByLabel('Agents at once');
 await agents.fill('7');await agents.press('Enter');assert.match(await dialog.getByRole('alert').first().innerText(),/1 to 6/);assert.equal((await policy()).policy.settings.concurrency,3);
 await agents.fill('2');await agents.press('Enter');await page.waitForFunction(async()=>(await (await fetch('/api/investigator')).json()).policy.settings.concurrency===2);
 await dialog.getByLabel('Time limit per agent').fill('90');await dialog.getByLabel('Time limit per agent').press('Enter');
 await page.waitForFunction(async()=>(await (await fetch('/api/investigator')).json()).policy.settings.timeoutMs===90000);
 assert.equal(await dialog.getByLabel('Nesting depth').getAttribute('readonly')!==null,true,'depth is fixed');
 await agents.fill('3');await agents.press('Enter');await page.waitForFunction(async()=>(await (await fetch('/api/investigator')).json()).policy.settings.concurrency===3);

 // ======== live token meter: a chat call made while the screen is open moves the bar
 await dialog.getByRole('tab',{name:'Usage'}).click();
 await dialog.getByText('No chat has used tokens yet.').waitFor();
 await page.evaluate(async()=>{const h={'Content-Type':'application/json','X-Aitiarch':'1'},review=await (await fetch('/api/chat/review',{method:'PUT',headers:h,body:JSON.stringify({id:'meter-1',path:'plan.md',question:'Meter?',context:[]})})).json();
  await (await fetch('/api/chat/send',{method:'PUT',headers:h,body:JSON.stringify({reviewId:review.reviewId,confirmed:true})})).text();});
 const bar=dialog.getByRole('progressbar',{name:'Token budget for plan.md'});await bar.waitFor();
 await page.waitForFunction(()=>/^35 of 50k tokens/.test(document.querySelector('.meter-label')?.textContent??''));
 await page.evaluate(async()=>{const h={'Content-Type':'application/json','X-Aitiarch':'1'},review=await (await fetch('/api/chat/review',{method:'PUT',headers:h,body:JSON.stringify({id:'meter-2',path:'plan.md',question:'Meter again?',context:[]})})).json();
  await (await fetch('/api/chat/send',{method:'PUT',headers:h,body:JSON.stringify({reviewId:review.reviewId,confirmed:true})})).text();});
 await page.waitForFunction(()=>/^70 of 50k tokens/.test(document.querySelector('.meter-label')?.textContent??''),null,{timeout:6000});
 assert.equal(await bar.getAttribute('aria-valuenow'),'0','a small spend rounds to 0%');
 await closeSettings();assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'Notes menu','focus goes back to where the settings were opened');

 // ======== a full run: nested cards, steps, status, streamed text, answer, findings, plain sources
 await page.waitForFunction(()=>document.querySelector('.chat-investigate button')?.getAttribute('aria-disabled')==='false'); // the switch re-reads its state when the settings close
 await investigate();
 runner.queue=[
  async input=>{input.emit({type:'status',name:'system_init'});return envelope('Looking at the parser.',[lookupJob,agentJob('a1')]);},
  async input=>{input.emit({type:'status',name:'stream_event_message_start'});input.emit({type:'text',text:'Reading the parser…'});await gate();return result(REPORT);},
  async()=>envelope('The parser trims its input before splitting it, so blank lines never reach the tokenizer.'),
 ];
 await ask('How does the parser work?');
 const agentCard=panel.locator('.agent-card[data-role="agent"]');
 await agentCard.locator('.agent-status[data-status="running"]').waitFor();
 assert.equal(await agentCard.getAttribute('aria-label'),'Agent 1 - Claude Code');
 assert.match(await agentCard.locator('.agent-status').innerText(),/Thinking/);
 assert.match(await agentCard.locator('.agent-stream').innerText(),/Reading the parser/);
 assert.equal(await agentCard.locator('.chat-caret').count(),1);
 await panel.getByRole('button',{name:'Cancel Agent 1 - Claude Code'}).waitFor();await panel.getByRole('button',{name:'Stop all'}).waitFor();
 assert.ok((await panel.locator('.trail-status').innerText()).length>0,'the trail has a status line');
 const lookupToggle=panel.getByRole('button',{name:/Lookup 1 - Read in the app/});await lookupToggle.waitFor();
 if((await lookupToggle.getAttribute('aria-expanded'))!=='true')await lookupToggle.click();
 const step=panel.locator('.agent-card[data-role="lookup"] .agent-steps li').first();await step.waitFor();
 assert.match(await step.innerText(),/lookup[\s\S]*src\/parse\.ts[\s\S]*\d+(\.\d)? (B|KB)/,'a step shows its tool, target and result size');
 await page.screenshot({path:path.join(output,'trail-running.png')});
 release();
 const answer=panel.locator('.trail-answer');await answer.waitFor();
 await page.waitForFunction(()=>/trims its input/.test(document.querySelector('.trail-answer .reply-markdown')?.textContent??''));
 assert.match(await answer.locator('.findings h4').innerText(),/1 finding · 1 file read · 1 agent · 1 lookup/);
 assert.ok((await answer.locator('.finding-sources code').allInnerTexts()).includes('src/parse.ts:3-6'),'sources are plain file:line text');
 assert.equal(await panel.locator('.trail a, .trail [href]').count(),0,'no links anywhere in the trail');
 assert.equal(await panel.locator('.agent-card[data-role="agent"] .agent-status').innerText().then(t=>/Done/.test(t)),true);
 await page.screenshot({path:path.join(output,'trail-answer.png')});

 // ---- Add to note works on it, with the same toast and Undo
 await page.mouse.move(700,700);
 const add=answer.getByRole('button',{name:'Add to note'});
 await answer.hover();await page.waitForFunction(()=>Number(getComputedStyle(document.querySelector('.trail-answer .chat-add')).opacity)>0.95);
 await add.click();
 const toast=page.locator('.thought-toast').filter({hasText:'Added from investigation'});await toast.waitFor();
 const added=(await doc()).replace(/\r\n/g,'\n');
 assert.ok(added.includes('> [!ai]')&&added.includes('trims its input')&&added.includes('Sources:')&&added.includes('> - src/parse.ts:3-6'),'the answer and its plain-text sources are in the note');
 assert.ok(!/\]\(/.test(added),'no Markdown links were written');
 await toast.getByRole('button',{name:'Undo',exact:true}).click();
 assert.equal((await doc()).replace(/\r\n/g,'\n'),note);
 for(let i=0;i<40;i++){if(readFileSync(path.join(root,'plan.md')).equals(bytes))break;await page.waitForTimeout(150);}
 assert.ok(readFileSync(path.join(root,'plan.md')).equals(bytes),'byte-identical after Undo (BOM and CRLF)');

 // ---- per-agent Cancel, then Stop all
 runner.queue=[async()=>envelope('Two at once.',[agentJob('a1'),agentJob('a2')]),async input=>{input.emit({type:'text',text:'working one'});return hangUntilAborted(input);},async input=>{input.emit({type:'text',text:'working two'});return hangUntilAborted(input);}];
 await ask('Cancel one, then stop the rest.');
 const t2=panel.locator('.trail').last();
 await page.waitForFunction(()=>[...document.querySelectorAll('.trail')].pop()?.querySelectorAll('.agent-card[data-status="running"]').length===2);
 await t2.getByRole('button',{name:'Cancel Agent 1 - Claude Code'}).click();
 // The server reports a cancelled agent only when the whole run ends, so the card says "Cancelling…" at once and the other agent keeps going.
 await t2.locator('.agent-card').first().getByText('Cancelling…').waitFor();
 assert.equal(await t2.getByRole('button',{name:'Cancel Agent 1 - Claude Code'}).isDisabled(),true,'Cancel cannot be pressed twice');
 assert.equal(await t2.getByRole('button',{name:'Cancel Agent 2 - Claude Code'}).isDisabled(),false,'the other agent is untouched');
 await t2.getByRole('button',{name:'Stop all'}).click();
 await page.waitForFunction(()=>[...document.querySelectorAll('.trail')].pop()?.querySelectorAll('.agent-card[data-status="cancelled"]').length===2);
 assert.match(await t2.getByRole('alert').innerText(),/Cancelled\. No partial answer was kept\./);
 assert.equal(await t2.getByRole('button',{name:'Stop all'}).count(),0);assert.equal(await t2.locator('.trail-answer').count(),0,'a stopped run never shows an answer');
 await closeChat();

 // ======== the permission card: ask each time, chosen on the screen
 await openSettings();await dialog.getByRole('tab',{name:'Folders and permissions'}).click();await dialog.getByLabel('Read inside registered folders permission').selectOption('ask');
 await page.waitForFunction(async()=>(await (await fetch('/api/investigator')).json()).policy.tiers.inside==='ask');await closeSettings();
 await openChat();await investigate();
 const before=runner.calls.length;
 await ask('Needs permission.');
 const card=panel.getByRole('group',{name:'Permission needed'});await card.waitFor();
 assert.equal(runner.calls.length,before,'nothing was run before permission');
 assert.ok((await card.innerText()).includes('plan.md'));
 assert.ok(await card.getByRole('button',{name:'Allow once'}).evaluate(b=>document.activeElement===b),'the first choice has focus');
 assert.equal(await card.getByRole('button',{name:'Always for this notebook'}).isDisabled(),true);
 await page.screenshot({path:path.join(output,'trail-permission.png')});
 runner.queue=[async()=>envelope('Allowed for this chat.')];
 await card.getByRole('button',{name:'Allow for this chat'}).click();
 await page.waitForFunction(()=>/Allowed for this chat/.test([...document.querySelectorAll('.trail-answer .reply-markdown')].pop()?.textContent??''));
 assert.equal(await panel.getByRole('group',{name:'Permission needed'}).count(),0,'the card is gone once the answer is in');
 // a grant for this chat holds for the next question
 runner.queue=[async()=>envelope('Still allowed.')];await ask('Again, same chat.');
 await page.waitForFunction(()=>/Still allowed/.test([...document.querySelectorAll('.trail-answer .reply-markdown')].pop()?.textContent??''));
 assert.equal(await panel.getByRole('group',{name:'Permission needed'}).count(),0);
 // "this chat" ends with the chat: a new panel asks again. Allow once is spent by one read.
 await closeChat();await openChat();await investigate();
 await ask('New chat, new question.');await panel.getByRole('group',{name:'Permission needed'}).waitFor();
 runner.queue=[async()=>envelope('Allowed once.')];
 await panel.getByRole('button',{name:'Allow once'}).click();await page.waitForFunction(()=>/Allowed once/.test([...document.querySelectorAll('.trail-answer .reply-markdown')].pop()?.textContent??''));
 await ask('And once more.');await panel.getByRole('group',{name:'Permission needed'}).waitFor();
 // Deny reads nothing
 const calls=runner.calls.length;await panel.getByRole('button',{name:'Deny'}).click();
 await panel.getByText('Denied. Nothing was read.').waitFor();assert.equal(runner.calls.length,calls);assert.equal(await panel.getByRole('group',{name:'Permission needed'}).count(),0);
 // Always for this notebook needs the explicit ignore line first
 await closeChat();await openSettings();await dialog.getByRole('tab',{name:'Folders and permissions'}).click();
 await dialog.getByRole('button',{name:'Add the ignore line'}).click();
 await page.waitForFunction(()=>!document.querySelector('[aria-label="Read inside registered folders permission"] option[value="notebook"]').disabled);
 await closeSettings();
 await openChat();await investigate();await ask('Remember this.');
 const card2=panel.getByRole('group',{name:'Permission needed'});await card2.waitFor();
 assert.equal(await card2.getByRole('button',{name:'Always for this notebook'}).isDisabled(),false);
 runner.queue=[async()=>envelope('Remembered.')];
 await card2.getByRole('button',{name:'Always for this notebook'}).click();await page.waitForFunction(()=>/Remembered\./.test([...document.querySelectorAll('.trail-answer .reply-markdown')].pop()?.textContent??''));
 assert.equal((await policy()).policy.tiers.inside,'notebook');
 runner.queue=[async()=>envelope('No card this time.')];await ask('Ask again.');
 await page.waitForFunction(()=>/No card this time/.test([...document.querySelectorAll('.trail-answer .reply-markdown')].pop()?.textContent??''));
 assert.equal(await panel.getByRole('group',{name:'Permission needed'}).count(),0);
 await closeChat();

 // ======== turning it off puts the switch back to disabled
 await openSettings();await dialog.getByRole('button',{name:'Turn off'}).click();await dialog.getByLabel(/I understand what the investigator/).waitFor();await closeSettings();
 await openChat();await page.waitForFunction(()=>document.querySelector('.chat-investigate button')?.getAttribute('aria-disabled')==='true');await closeChat();
 await context.close();

 // ======== reduced motion: the status dot and the caret hold still
 {const {context:c,page:p}=await newPage({reducedMotion:'reduce'});
  await p.evaluate(async()=>{await fetch('/api/investigator/configure',{method:'PUT',headers:{'Content-Type':'application/json','X-Aitiarch':'1'},body:JSON.stringify({enabled:true,action:'enable-investigator'})});});
  await p.getByRole('button',{name:/^Chat/}).click();const pn=p.locator('#chat-panel');await pn.waitFor();
  await p.waitForFunction(()=>true);await pn.getByRole('button',{name:'Investigate',exact:true}).click();
  runner.queue=[async()=>envelope('Slow.',[agentJob('a1')]),async input=>{input.emit({type:'text',text:'slowly'});await gate();return result(REPORT);},async()=>envelope('Done slowly.')];
  const box=pn.getByRole('textbox',{name:'Message Aitiarch AI'});await p.waitForFunction(()=>!document.querySelector('.chat-composer textarea').disabled);await box.fill('Reduced motion?');await box.press('Enter');
  const dot=pn.locator('.agent-status[data-status="running"] i');await dot.waitFor();
  assert.equal(await dot.evaluate(e=>getComputedStyle(e).animationName),'none','reduced motion: the status dot does not pulse');
  assert.equal(await pn.locator('.agent-stream .chat-caret').evaluate(e=>getComputedStyle(e).animationName),'none');
  release();await pn.locator('.trail-answer').waitFor();await c.close();}

 assert.deepEqual(external,[],'no request left the machine');
 const ledger=JSON.parse(readFileSync(path.join(root,'ledger.json'),'utf8'));
 assert.ok(ledger.events.some(e=>e.event==='investigation'),'every run is recorded in the ledger (metadata only)');
 assert.ok(readFileSync(path.join(root,'plan.md')).equals(bytes),'Markdown bytes untouched');
 console.log(JSON.stringify({pass:true,runnerCalls:runner.calls.length,output}));
}finally{
 await browser?.close().catch(()=>{});watcher.stop();await app.close();
 const target=path.resolve(project);if(target.startsWith(realpathSync.native(os.tmpdir()))&&path.basename(target).startsWith('aitiarch-trail-ui-')){console.log('CLEANUP TARGET:',target);rmSync(target,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
}
