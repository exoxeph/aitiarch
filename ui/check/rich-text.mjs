// Local browser checks: synthetic Markdown and an inert provider only.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';import {chromium} from 'playwright-core';
import {Store} from '../server/store.ts';import {NoteWatcher} from '../server/watch.ts';import {createApp} from '../server/http.ts';
import {InkStore} from '../server/ink-store.ts';import {captureAnchor} from '../shared/anchors.ts';
const ui=fileURLToPath(new URL('../',import.meta.url)),repo=path.resolve(ui,'..');
const output=path.resolve(process.env.BATCH2A_OUTPUT??'');assert(process.env.BATCH2A_OUTPUT&&output.toLowerCase()!==repo.toLowerCase()&&!output.toLowerCase().startsWith(repo.toLowerCase()+path.sep),'Output must be outside repo');await mkdir(output,{recursive:true});
const full=process.argv.includes('--full');
const root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-richtext-'));
execFileSync('git',['init','-q'],{cwd:root,stdio:'pipe'});await writeFile(path.join(root,'.gitignore'),'/.cache/\n/ui-state.json*\n');
const note='# Grove rendering fixture\n\nBefore **bold** and *italic* with ~~strike~~ and `code` plus [link](https://example.test).\n\n- A bullet\n- [ ] A task\n- [x] A finished task\n\nEnd.\n';
const bytes=Buffer.from('\uFEFF'+note.replaceAll('\n','\r\n'));await writeFile(path.join(root,'fixture.md'),bytes);
const ink=await InkStore.open(root),snapshot=await ink.read('fixture.md'),from=note.indexOf('bold'),anchor=captureAnchor(note,from,from+4);
snapshot.document.items.push({id:'fixture-answer',kind:'answer',body:'Fake AI answer for display only.',anchor,originalAnchor:anchor,attachment:{status:'attached',from,to:from+4}});await ink.write('fixture.md',snapshot.document,null);
const store=await Store.open(root),watcher=new NoteWatcher(store,50,10);await watcher.start();let calls=0,external=0;const errors=[],checks=[];
const app=createApp({store,watcher,distDir:path.join(ui,'dist'),provider:{name:'claude',checkAvailability:async()=>({available:true}),invoke:async()=>{calls++;throw Error('Provider calls forbidden');}}});let browser;
try{
 const base=`http://127.0.0.1:${await app.listen(0)}`;browser=await chromium.launch({channel:'msedge',headless:true});
 for(const theme of ['ember','moss']){
  const page=await browser.newPage({viewport:{width:1440,height:1000},});
  await page.route('**/*',route=>{if(new URL(route.request().url()).origin!==base){external++;return route.abort();}if(new URL(route.request().url()).pathname==='/api/usage')return route.fulfill({json:{providers:[],hourlyCap:2}});return route.continue();});page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/?debug=1');await page.waitForFunction(()=>window.__aitiarch?.['fixture.md']);await page.evaluate(t=>{document.documentElement.dataset.theme=t;},theme);
  const select=async(a,b=a)=>page.evaluate(([a,b])=>{const v=window.__aitiarch['fixture.md'].view;v.dispatch({selection:{anchor:a,head:b},scrollIntoView:true});v.focus();},[a,b]);
  const text=()=>page.evaluate(()=>window.__aitiarch['fixture.md'].view.state.doc.toString());
  await select(note.length);assert.equal(await page.locator('.cm-strong').innerText(),'bold');assert.equal(await page.locator('.cm-failed').innerText(),'strike');assert.equal(await page.locator('.cm-task-off').count(),2);
  const sidecar=await readFile(path.join(root,'ink/fixture.ink.json'),'utf8');
  // Real keyboard movement enters source coordinates; replacements never delete markers.
  const start=note.indexOf('**bold**');await select(start-1);await page.keyboard.press('ArrowRight');assert.equal(await page.evaluate(()=>window.__aitiarch['fixture.md'].view.state.selection.main.head),start);assert((await page.locator('.cm-content').innerText()).includes('**bold**'));
  await page.keyboard.press('ArrowRight');assert.equal(await page.evaluate(()=>window.__aitiarch['fixture.md'].view.state.selection.main.head),start+1);await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Shift+ArrowRight');assert.equal(await page.evaluate(()=>window.__aitiarch['fixture.md'].view.state.selection.main.to-window.__aitiarch['fixture.md'].view.state.selection.main.from),1);
  await select(start+2);await page.keyboard.press('Backspace');assert.equal(await text(),note.slice(0,start+1)+note.slice(start+2));await page.keyboard.press('Control+z');assert.equal(await text(),note);
  // ClipboardEvent exercises CodeMirror's real source-based copy/paste handlers without changing the system clipboard.
  await select(start,start+8);const copied=await page.evaluate(()=>{const v=window.__aitiarch['fixture.md'].view,data=new DataTransfer();v.contentDOM.dispatchEvent(new ClipboardEvent('copy',{clipboardData:data,bubbles:true,cancelable:true}));return data.getData('text/plain');});assert.equal(copied,'**bold**');
  await select(note.length);await page.evaluate(value=>{const v=window.__aitiarch['fixture.md'].view,data=new DataTransfer();data.setData('text/plain',value);v.contentDOM.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));},copied);assert.equal(await text(),note+copied);await page.keyboard.press('Control+z');assert.equal(await text(),note);
  if(full){
   const word=note.indexOf('Before');
   for(const key of ['Control+b','Control+i','Control+Shift+x']){await select(word,word+6);await page.keyboard.press(key);assert.notEqual(await text(),note);await page.keyboard.press(key);assert.equal(await text(),note);}
   for(const title of ['Bold (Ctrl+B)','Italic (Ctrl+I)','Strikethrough (Ctrl+Shift+X)']){await select(word,word+6);await page.getByTitle(title,{exact:true}).click();await page.getByTitle(title,{exact:true}).click();assert.equal(await text(),note);}
  }
  await page.evaluate(()=>window.__aitiarch['fixture.md'].session.flush());assert.deepEqual(await readFile(path.join(root,'fixture.md')),bytes);
  // The editor may checkpoint after actual edits; compare anchor geometry, not timestamps/hash metadata.
  const stored=JSON.parse(await readFile(path.join(root,'ink/fixture.ink.json'),'utf8')).items[0];assert.deepEqual(stored.anchor,JSON.parse(sidecar).items[0].anchor);assert.deepEqual(stored.attachment,{status:'attached',from,to:from+4});
  await select(note.length);await page.screenshot({path:path.join(output,`rendered-${theme}.png`),fullPage:true});
  await select(start+3);await page.screenshot({path:path.join(output,`active-span-${theme}.png`),fullPage:true});
  if(full){
   const burger=()=>page.getByRole('button',{name:'Notes menu',exact:true}),typingSwitch=()=>page.locator('#note-tree').getByRole('switch',{name:/Typing help/});
   const openMenu=async()=>{if((await burger().getAttribute('aria-expanded'))!=='true')await burger().click();await page.locator('#note-tree[data-state="open"]').waitFor();if(!(await typingSwitch().isVisible()))await page.locator('#note-tree').getByText('Settings',{exact:true}).click();await typingSwitch().waitFor();};
   const closeMenu=async()=>{if((await burger().getAttribute('aria-expanded'))==='true')await burger().click();await page.locator('#note-tree[data-state="closed"]').waitFor();await page.waitForTimeout(300);};
   // The left menu overlays the note: it never moves the column.
   const beforeLeft=await page.locator('.editor-col').evaluate(el=>el.getBoundingClientRect().left);await openMenu();assert.equal(await page.locator('.editor-col').evaluate(el=>el.getBoundingClientRect().left),beforeLeft);await page.screenshot({path:path.join(output,`menu-open-${theme}.png`),fullPage:true});await closeMenu();
   await page.setViewportSize({width:620,height:900});await openMenu();await page.screenshot({path:path.join(output,`narrow-menu-${theme}.png`),fullPage:true});await closeMenu();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(output,`narrow-editor-${theme}.png`),fullPage:true});
   // No implicit .gitignore changes: an unignored preference stays in memory until an explicit click.
   await writeFile(path.join(root,'.gitignore'),'');await rm(path.join(root,'ui-state.json'),{force:true});await page.setViewportSize({width:1440,height:1000});await page.reload();await page.waitForFunction(()=>window.__aitiarch?.['fixture.md']);await page.evaluate(t=>{document.documentElement.dataset.theme=t;},theme);
   await openMenu();await typingSwitch().click();await closeMenu();await page.getByText('File tree and theme preferences stay in memory',{exact:false}).waitFor();await page.waitForTimeout(500);
   assert.equal(JSON.parse(await readFile(path.join(root,'ui-state.json'),'utf8')).typingHelp,undefined);assert.equal(await readFile(path.join(root,'.gitignore'),'utf8'),'');
   await page.screenshot({path:path.join(output,`tree-memory-notice-${theme}.png`),fullPage:true});
   await page.getByRole('button',{name:'Dismiss tree preference notice',exact:true}).click();assert.equal(await readFile(path.join(root,'.gitignore'),'utf8'),'');
   await page.reload();await page.waitForFunction(()=>window.__aitiarch?.['fixture.md']);await page.evaluate(t=>{document.documentElement.dataset.theme=t;},theme);await openMenu();await typingSwitch().click();await closeMenu();
   await page.getByRole('button',{name:'Add /ui-state.json* to root .gitignore',exact:true}).click();
   for(let attempt=0;;attempt++){const saved=JSON.parse(await readFile(path.join(root,'ui-state.json'),'utf8'));if(saved.typingHelp===false)break;if(attempt>=30){console.log(JSON.stringify({preferenceDebug:await page.evaluate(async()=>({state:await fetch('/api/ui-state').then(r=>r.json()),notice:document.querySelector('main .notice')?.textContent})),savedKeys:Object.keys(saved)}));throw Error('Typing preference did not persist');}await page.waitForTimeout(100);}
   await page.reload();await page.waitForFunction(()=>window.__aitiarch?.['fixture.md']);await page.evaluate(t=>{document.documentElement.dataset.theme=t;},theme);await openMenu();assert.equal(await typingSwitch().getAttribute('aria-checked'),'false');await typingSwitch().click();await closeMenu();await page.waitForTimeout(500);await writeFile(path.join(root,'.gitignore'),'/.cache/\n/ui-state.json*\n');
  }
  checks.push({theme,rendering:true,arrows:true,backspace:true,selection:true,copyMarkdown:true,pasteMarkdown:true,byteExact:true,anchors:true,formatAndTree:full});await page.close();
 }
 assert.equal(calls,0);assert.equal(external,0);assert.deepEqual(errors,[]);assert.deepEqual(await readFile(path.join(root,'fixture.md')),bytes);
 await writeFile(path.join(output,'checks.json'),JSON.stringify({pass:true,checks,providerCalls:calls,externalRequests:external},null,2));console.log(JSON.stringify({pass:true,checks,providerCalls:calls,externalRequests:external,output}));
}finally{await browser?.close();watcher.stop();await app.close();await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
