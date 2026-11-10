// Real-browser check for M3: the chat panel against a scripted fake stream. Synthetic OS-temp note, in-process server, no CLI, no network.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile,mkdir} from 'node:fs/promises';
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
const root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-chat-ui-'));
const note='# Chat fixture\n\nA unique selected sentence.\n\nA second paragraph for the reply to land under.\n';
const bytes=Buffer.from('﻿'+note.replace(/\n/g,'\r\n'));
await writeFile(path.join(root,'fixture.md'),bytes);

// The scripted stream. `script` picks what the next call does; `hold` keeps a stream open after its first chunk so the check can look at it mid-flight.
const calls=[];let script={kind:'normal',answer:'Synthetic.'},release=()=>{};
const provider={name:'claude',
 async checkAvailability(){return {available:true};},
 async invoke(request,options={}){
  calls.push(request);const s=script;
  if(s.kind==='fail')throw new ProviderError('unsupported_cli');
  const json=JSON.stringify({answer:s.answer,claims:[]}),cut=Math.max(34,Math.floor(json.length/2));
  const chunks=s.kind==='hang'?[json.slice(0,44)]:[json.slice(0,cut),json.slice(cut)];
  for(let i=0;i<chunks.length;i++){
   if(options.signal?.aborted)throw new ProviderError('cancelled');
   options.onTextDelta?.(chunks[i]);
   if(s.hold&&i===0)await s.hold;
   if(s.kind==='hang')await new Promise((_,reject)=>options.signal?.addEventListener('abort',()=>reject(new ProviderError('cancelled'))));
   await new Promise(r=>setTimeout(r,25));
  }
  return {id:request.id,provider:'claude',model:null,answer:s.answer,claims:[],usage:{inputTokens:120,cachedTokens:20,outputTokens:60}};
 }};
const holdOpen=()=>{let resolve;const hold=new Promise(r=>{resolve=r;});release=()=>resolve();return hold;};
const RICH='Here is a table:\n\n| Level | Meaning |\n| --- | --- |\n| Remember | Recall facts |\n\n```js\nconst x = 1;\n```\n\n> [!note]\n> Keep it short.';

const store=await Store.open(root),watcher=new NoteWatcher(store);
const app=createApp({store,watcher,distDir:path.join(here,'../dist'),provider});
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
 const panel=page.locator('#chat-panel'),composer=()=>panel.getByRole('textbox',{name:'Message Aitiarch AI'});
 const ready=()=>page.waitForFunction(()=>{const t=document.querySelector('.chat-composer textarea');return t&&!t.disabled;});
 const ask=async q=>{await ready();await composer().fill(q);await composer().press('Enter');};
 const doc=()=>page.evaluate(()=>window.__aitiarch['fixture.md'].view.state.doc.toString());
 await page.getByRole('button',{name:/^Chat/}).click();await panel.waitFor();

 // ---- empty state, chips with estimates, previews
 assert.equal(await panel.locator('.chat-suggestion').count(),3);
 assert.match(await panel.locator('.chat-usage').innerText(),/^No calls yet/);
 const noteBytes=Buffer.byteLength(note);
 const noteChip=panel.getByRole('button',{name:/^This note/});
 const chipText=await noteChip.innerText();assert.match(chipText,/· \d/,'the chip shows an estimate');
 assert.ok(Math.abs(Number(/· (\d+)/.exec(chipText)?.[1]??NaN)-noteBytes)<=12,`This note estimate should be about ${noteBytes} (got ${chipText})`);
 assert.match(await panel.locator('.chat-context-total').innerText(),/About .* tokens of context/);
 await panel.getByRole('button',{name:'Preview This note',exact:true}).click();
 assert.match(await panel.getByRole('region',{name:'Preview of This note'}).innerText(),/Chat fixture/);
 await panel.getByRole('button',{name:'Preview This note',exact:true}).click();assert.equal(await panel.getByRole('region',{name:/^Preview of/}).count(),0);
 // The selection chip is off until chosen, then counts the selected text.
 await page.evaluate(()=>{const {view}=window.__aitiarch['fixture.md'],q='A unique selected sentence.',from=view.state.doc.toString().indexOf(q);view.dispatch({selection:{anchor:from,head:from+q.length}});});
 const selChip=panel.getByRole('button',{name:/^Selection/});assert.equal(await selChip.getAttribute('aria-pressed'),'false');
 await selChip.click();assert.equal(await selChip.getAttribute('aria-pressed'),'true');
 assert.match(await selChip.innerText(),/· 27/,'27 bytes of selected text');

 // ---- the first-message review card: nothing is sent until Send
 script={kind:'normal',answer:'**Synthetic** reply. It has [a link](https://example.com) and enough words to see it stream in.',hold:holdOpen()};
 await ask('What does the fixture say?');
 const review=panel.getByRole('region',{name:'What will be sent'});await review.waitFor();
 assert.equal(calls.length,0,'the review card must appear before any provider call');
 const reviewText=await review.innerText();
 for(const needle of ['What does the fixture say?','A unique selected sentence.','This note','tokens in all','Don’t ask again this session'])assert.ok(reviewText.includes(needle),`review card should show “${needle}”`);
 assert.ok(await review.getByRole('button',{name:'Send',exact:true}).evaluate(b=>document.activeElement===b),'Send takes focus so Enter confirms');
 await page.screenshot({path:path.join(output,'chat-review.png')});
 await review.getByLabel(/ask again this session/i).check();
 await review.getByRole('button',{name:'Send',exact:true}).click();

 // ---- streamed tokens with a gentle caret
 await page.waitForFunction(()=>(document.querySelector('.chat-stream')?.textContent??'').length>4);
 assert.equal(calls.length,1);
 const live=panel.locator('.chat-streaming');assert.equal(await live.getAttribute('aria-busy'),'true');
 assert.ok(await panel.locator('.chat-caret').count()===1,'a caret trails the streamed text');
 assert.equal(await panel.locator('.chat-caret').evaluate(e=>getComputedStyle(e).animationName),'chat-caret','the caret pulses gently');
 await panel.getByRole('button',{name:'Stop',exact:true}).waitFor();
 await page.screenshot({path:path.join(output,'chat-streaming.png')});
 release();
 await panel.locator('.chat-ai:not(.chat-streaming) strong').first().waitFor();
 assert.equal(await panel.locator('.chat-caret').count(),0);
 assert.match(await panel.locator('.chat-usage').innerText(),/^1 call · 140 in · 60 out · 200 of 50k tokens/);
 assert.match(await panel.locator('.chat-persist').innerText(),/Kept in memory only/);

 // ---- Add to note: quiet at rest, visible on hover and keyboard focus
 const add=panel.getByRole('button',{name:'Add to note',exact:true}).first();
 await page.mouse.move(700,700);await page.waitForTimeout(250);
 assert.equal(await add.evaluate(e=>getComputedStyle(e).opacity),'0','Add to note is invisible at rest');
 await panel.locator('.chat-ai').first().hover();await page.waitForFunction(()=>Number(getComputedStyle(document.querySelector('.chat-add')).opacity)>0.95);
 await page.mouse.move(700,700);await page.waitForTimeout(250);
 await page.keyboard.press('Shift');await add.focus();await page.waitForTimeout(250); // a key press first, so the focus counts as keyboard focus
 assert.equal(await add.evaluate(e=>getComputedStyle(e).opacity),'1','keyboard focus reveals it');
 assert.ok(await add.evaluate(e=>{const s=getComputedStyle(e);return s.outlineStyle!=='none'&&parseFloat(s.outlineWidth)>=1;}),'and shows a focus ring');
 await page.keyboard.press('Enter');
 const toast=page.locator('.thought-toast').filter({hasText:'Added from chat'});await toast.waitFor();
 assert.match(await toast.innerText(),/Undo/);
 const added=await doc();assert.ok(added.includes('> [!ai]')&&added.includes('Synthetic'),'the reply is in the note as an AI callout');
 await toast.getByRole('button',{name:'Undo',exact:true}).click();
 assert.equal((await doc()).replace(/\r\n/g,'\n'),note,'Undo puts the note back');
 for(let i=0;i<40;i++){if((await readFile(path.join(root,'fixture.md'))).equals(bytes))break;await page.waitForTimeout(150);}
 assert.ok((await readFile(path.join(root,'fixture.md'))).equals(bytes),'the saved note is byte-identical after Undo (BOM and CRLF intact)');

 // ---- rich markdown with the editor's widgets; no review card now that "don't ask again" is on
 script={kind:'rich',answer:RICH};
 await ask('Show a table.');
 await panel.locator('.chat-ai table').waitFor();
 assert.equal(await panel.getByRole('region',{name:'What will be sent'}).count(),0,'no review card after “don’t ask again”');
 assert.ok(await panel.locator('.reply-code').count()>=1,'fenced code uses the editor code widget');
 assert.ok(await panel.locator('.cm-callout').count()>=1,'callouts keep their style');
 await page.screenshot({path:path.join(output,'chat-rich.png')});

 // ---- secrets-scan warning: shown, and Add to note is blocked
 script={kind:'secret',answer:'Use password: Synthetic0123456789abc to log in.'};
 await ask('How do I log in?');
 const warn=panel.locator('.chat-warn');await warn.waitFor();
 assert.match(await warn.innerText(),/secret or private key/);
 const lastAdd=panel.getByRole('button',{name:'Add to note',exact:true}).last();assert.equal(await lastAdd.isDisabled(),true);
 assert.equal((await doc()).replace(/\r\n/g,'\n'),note,'nothing was inserted');

 // ---- error state: the partial text is gone, nothing is retried
 script={kind:'fail',answer:'unused'};const before=calls.length;
 await ask('This one will fail.');
 const err=panel.locator('.chat-error');await err.waitFor();
 assert.match(await err.innerText(),/could not complete this request/);
 assert.equal(calls.length,before+1,'a failed request is never retried');
 await err.getByRole('button',{name:'Dismiss'}).click();assert.equal(await panel.locator('.chat-error').count(),0);

 // ---- cancel: Stop discards the partial reply
 script={kind:'hang',answer:'unused'};
 await ask('This one will be cancelled.');
 await page.waitForFunction(()=>(document.querySelector('.chat-stream')?.textContent??'').length>2);
 await panel.getByRole('button',{name:'Stop',exact:true}).click();
 await panel.locator('.chat-error').waitFor();
 assert.match(await panel.locator('.chat-error').innerText(),/cancelled/i);
 assert.equal(await panel.locator('.chat-stream').count(),0,'the partial reply is discarded');

 // ---- reload: accepted replies come back, questions do not
 await page.reload();await page.waitForSelector('.cm-editor');await page.getByRole('button',{name:/^Chat/}).click();await panel.waitFor();
 await panel.locator('.chat-ai').first().waitFor();
 assert.equal(await panel.locator('.chat-ai').count(),3,'the three accepted replies are restored');
 assert.equal(await panel.getByText('Question unavailable after reload.').count(),3);
 assert.match(await panel.locator('.chat-usage').innerText(),/calls? · .* tokens/);
 await context.close();

 // ---- reduced motion: the caret holds still
 {const {context:c,page:p}=await newPage({reducedMotion:'reduce'});
  const pn=p.locator('#chat-panel');await p.getByRole('button',{name:/^Chat/}).click();await pn.waitFor();
  script={kind:'normal',answer:'A slow reply with enough words to see the caret before it finishes.',hold:holdOpen()};
  await p.waitForFunction(()=>{const t=document.querySelector('.chat-composer textarea');return t&&!t.disabled;});
  await pn.getByRole('textbox',{name:'Message Aitiarch AI'}).fill('Reduced motion?');await pn.getByRole('textbox',{name:'Message Aitiarch AI'}).press('Enter');
  await p.waitForFunction(()=>(document.querySelector('.chat-stream')?.textContent??'').length>4);
  assert.equal(await pn.locator('.chat-caret').evaluate(e=>getComputedStyle(e).animationName),'none','reduced motion: no pulsing');
  release();await pn.locator('.chat-ai:not(.chat-streaming)').last().waitFor();await c.close();}

 assert.deepEqual(external,[],'no request left the machine');
 assert.ok((await readFile(path.join(root,'fixture.md'))).equals(bytes),'Markdown bytes untouched');
 console.log(JSON.stringify({pass:true,providerCalls:calls.length,output}));
}finally{
 await browser?.close().catch(()=>{});watcher.stop();await app.close();
 const target=path.resolve(root);if(target.startsWith(path.resolve(os.tmpdir()))&&path.basename(target).startsWith('aitiarch-chat-ui-')){console.log('CLEANUP TARGET:',target);await rm(target,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
}
