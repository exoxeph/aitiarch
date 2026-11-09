// Three local browser checks. Synthetic Markdown, fake provider, no screenshots.
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright-core';
import {Store} from '../server/store.ts';import {NoteWatcher} from '../server/watch.ts';import {createApp} from '../server/http.ts';
const root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-typing-help-'));execFileSync('git',['init','-q'],{cwd:root});await writeFile(path.join(root,'.gitignore'),'/.cache/\n/ui-state.json*\n');
const original='# Synthetic fixture\n\nUntouched  spacing.\n\nA teh\n\nTail  unchanged.\n',bytes=Buffer.from('\ufeff'+original.replace(/\n/g,'\r\n'));await writeFile(path.join(root,'fixture.md'),bytes);
await writeFile(path.join(root,'terms.md'),'Project vocabulary: pargraph.');
const store=await Store.open(root),watcher=new NoteWatcher(store,60,10);await watcher.start();
assert.equal(store.rootReal.toLowerCase(),root.toLowerCase());
let calls=0,browser;const errors=[];
const app=createApp({store,watcher,distDir:path.resolve('dist'),provider:{name:'claude',checkAvailability:async()=>({available:true}),invoke:async()=>{calls++;throw Error('Provider calls forbidden');}}});
try{
 const base='http://127.0.0.1:'+await app.listen(0);browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({permissions:['clipboard-read','clipboard-write']});page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
 const graph=JSON.parse(await readFile('check/out/diagram-build-graph.json','utf8')),initial=new Set();const visit=file=>{if(initial.has(file))return;initial.add(file);for(const dep of graph.find(c=>c.file===file)?.imports??[])visit(dep);};graph.filter(c=>c.isEntry).forEach(c=>visit(c.file));
 const spelling=graph.filter(c=>c.modules.some(m=>/nspell|dictionary-en/.test(m))).map(c=>c.file);assert.equal(spelling.length,2);assert.ok(spelling.every(f=>!initial.has(f)));
 const loaded=new Set();page.on('request',r=>loaded.add(new URL(r.url()).pathname.slice(1)));
 await page.goto(base+'/?debug');await page.waitForFunction(()=>window.__aitiarch?.['fixture.md']);
 assert.ok(spelling.every(f=>!loaded.has(f)),'dictionary must not be fetched before typing');
 const doc=()=>page.evaluate(()=>window.__aitiarch['fixture.md'].view.state.doc.toString());
 const reset=async text=>{await page.evaluate(text=>{const v=window.__aitiarch['fixture.md'].view;v.dispatch({changes:{from:0,to:v.state.doc.length,insert:text},selection:{anchor:text.length},userEvent:'input.fixture'});v.focus();},text);};
 const expected=async text=>{try{await page.waitForFunction(text=>window.__aitiarch['fixture.md'].view.state.doc.toString()===text,text);}catch{assert.equal(await doc(),text);}};
 const flush=()=>page.evaluate(()=>window.__aitiarch['fixture.md'].session.flush());
 // 1. Actual typing, boundary corrections, separate undo/Backspace, Enter, and both palette preferences.
 const clearPersonal=async()=>{await page.evaluate(async()=>{const state=await (await fetch('/api/ui-state')).json();await fetch('/api/ui-state',{method:'PUT',headers:{'Content-Type':'application/json','X-Aitiarch':'1'},body:JSON.stringify({...state,neverCorrect:[]})});});await page.reload();await page.waitForFunction(()=>window.__aitiarch?.['fixture.md']);await page.keyboard.press('Shift');await page.waitForSelector('[data-smart-ready="true"]');};
 // New dictionary path: actual key events, safe local lazy assets, and the requested sentence.
 await reset('');await page.keyboard.type('Helo wht do itt do? ');await expected('Hello what do it do? ');
 await page.waitForSelector('[data-smart-ready="true"]');await reset('A sentnce');await page.keyboard.type(' ');await expected('A sentence ');
 await page.keyboard.press('Control+z');await expected('A sentnce ');
 await page.waitForFunction(async()=>{const s=await (await fetch('/api/ui-state')).json();return s.neverCorrect?.includes('sentnce');});
 await reset('A sentnce');await page.keyboard.type(' ');await expected('A sentnce ');await clearPersonal();
 // Vocabulary covers unopened notes and follows their external changes without writing any note itself.
 await reset('A pargraph');await page.keyboard.type(' ');await expected('A pargraph ');
 const changedVocabulary=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/file'&&new URL(r.url()).searchParams.get('path')==='terms.md');
 await writeFile(path.join(root,'terms.md'),'Project vocabulary: documnt.');await changedVocabulary;await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await reset('A documnt');await page.keyboard.type(' ');await expected('A documnt ');
 await reset('A pargraph');await page.keyboard.type(' ');await expected('A paragraph ');
 await reset('A teh');await page.keyboard.type(' ');await expected('A the ');await page.keyboard.press('Control+z');await expected('A teh ');await clearPersonal();
 await reset('A teh');await page.keyboard.type(' ');await expected('A the ');await page.keyboard.press('Backspace');await expected('A teh ');await clearPersonal();
 await reset('hello');await page.keyboard.type(' ');await expected('Hello ');
 await reset('A word ');await page.keyboard.type(' ');await expected('A word. ');await page.keyboard.press('Backspace');await expected('A word  ');
 await reset('A recieve');await page.keyboard.press('Enter');await expected('A receive\n');
 const toggle=async query=>{const field=query==='Typing help'?'typingHelp':query==='Smart corrections'?'smartCorrections':'doubleSpacePeriod',value=await page.evaluate(async field=>(await (await fetch('/api/ui-state')).json())[field]??true,field);
  const saved=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/ui-state'&&r.request().method()==='PUT'&&r.request().postDataJSON()?.[field]===!value&&r.ok());
  await page.keyboard.press('Control+k');const input=page.getByPlaceholder(/Type a command/);await input.waitFor();await input.fill(query);await page.keyboard.press('Enter');await input.waitFor({state:'hidden'});await saved;
 };
 await toggle('Smart corrections');await reset('A sentnce');await page.keyboard.type(' ');await expected('A sentnce ');await flush();await page.reload();await page.waitForFunction(()=>window.__aitiarch?.['fixture.md']);await toggle('Smart corrections');
 await toggle('Typing help');await reset('teh');await page.keyboard.type(' ');await expected('teh ');await flush();
 await page.reload();await page.waitForFunction(()=>window.__aitiarch?.['fixture.md']);await reset('teh');await page.keyboard.type(' ');await expected('teh ');await toggle('Typing help');
 await toggle('Double-space period');await reset('A word ');await page.keyboard.type(' ');await expected('A word  ');await toggle('Double-space period');
 // 2. Clipboard paste, subsequent programmatic insertion and reload preserve the input verbatim.
 await reset('');await page.evaluate(()=>navigator.clipboard.writeText('Helo wht do itt do? \nsentnce teh  i\nrecieve '));await page.keyboard.press('Control+v');await expected('Helo wht do itt do? \nsentnce teh  i\nrecieve ');await flush();await page.reload();await page.waitForFunction(()=>window.__aitiarch?.['fixture.md']);assert.equal(await doc(),'Helo wht do itt do? \nsentnce teh  i\nrecieve ');
 // 3. Disk bytes: only the explicit word correction and boundary may change; undo + deletion restore BOM/CRLF.
 await writeFile(path.join(root,'fixture.md'),bytes);await page.waitForFunction(text=>window.__aitiarch['fixture.md'].view.state.doc.toString()===text,original);await page.reload();await page.waitForFunction(()=>window.__aitiarch?.['fixture.md']);assert.deepEqual(await readFile(path.join(root,'fixture.md')),bytes);
 await page.evaluate(pos=>{const v=window.__aitiarch['fixture.md'].view;v.dispatch({selection:{anchor:pos}});v.focus();},original.indexOf('teh')+3);await page.keyboard.type(' ');await expected(original.replace('A teh','A the '));await flush();
 assert.deepEqual(await readFile(path.join(root,'fixture.md')),Buffer.from('\ufeff'+original.replace('A teh','A the ').replace(/\n/g,'\r\n')));
 await page.keyboard.press('Control+z');await expected(original.replace('A teh','A teh '));await page.keyboard.press('Backspace');await expected(original);await flush();assert.deepEqual(await readFile(path.join(root,'fixture.md')),bytes);
 assert.equal(calls,0);assert.deepEqual(errors,[]);console.log(JSON.stringify({typing:true,pasteUnchanged:true,bomCrlfByteIdentity:true,providerCalls:calls}));
}finally{await browser?.close();await app.close();await watcher.stop();console.log('Cleanup fixture:',root);await rm(root,{recursive:true,force:true});}

