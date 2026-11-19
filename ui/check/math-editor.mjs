import './config-isolation.mjs';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';
import {Store} from '../server/store.ts';
import {NoteWatcher} from '../server/watch.ts';
import {createApp} from '../server/http.ts';
import {InkStore} from '../server/ink-store.ts';
import {LedgerStore} from '../server/ledger-store.ts';
import {captureAnchor} from '../shared/anchors.ts';

const ui=fileURLToPath(new URL('../',import.meta.url));
const output=path.resolve(process.env.BATCH2A_OUTPUT??'');
const relative=path.relative(path.resolve(ui,'..'),output);
assert(process.env.BATCH2A_OUTPUT&&(relative.startsWith('..'+path.sep)||path.isAbsolute(relative)),'Use output outside the repo');
await mkdir(output,{recursive:true});
const root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-math-editor-'));
const file=path.join(root,'fixture.md');
const note=[
 '# Math fixture','','An inline $x_1$ with plain text nearby.','',
 'Price $5, inline code `$skip$`, and escaped \\$skip.','',
 '> [!ai]','> > $$','> > \\frac{1}{2}','> > $$','',
 'Broken $\\notAnAitiarchCommand{x}$ goes back to source.','',
 ...Array.from({length:60},(_,n)=>'Filler paragraph '+n+'\n'),
].join('\n');
const bytes=Buffer.from('\uFEFF'+note.replace(/\n/g,'\r\n'));
await writeFile(file,bytes);
const body=['Energy is $E=mc^2$.  ','> $$','> x^2','> $$','',
 '```mermaid','flowchart TD','A --> B','```','','```js','const amount = "$5";','```'].join('\n');
const marker='Filler paragraph 0',from=note.indexOf(marker),to=from+marker.length;
const anchor=captureAnchor(note,from,to);
const ink=await InkStore.open(root),seed=await ink.read('fixture.md');
seed.document.items.push({id:'rich-insertion',kind:'answer',body,anchor,originalAnchor:anchor,attachment:{status:'attached',from,to},
 generation:{requestId:'rich-insertion',action:'think',provider:'claude',model:null,createdAt:new Date().toISOString(),status:'complete',evidence:[],dismissed:false}});
await ink.write('fixture.md',seed.document,seed.version);
const store=await Store.open(root),watcher=new NoteWatcher(store);
let calls=0;
const app=createApp({store,watcher,distDir:path.join(ui,'dist'),provider:{name:'claude',
 checkAvailability:async()=>({available:true}),invoke:async()=>{calls++;throw Error('Provider call forbidden');}}});
let browser;
try{
 const origin='http://127.0.0.1:'+await app.listen(0);
 browser=await chromium.launch({channel:'msedge',headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:800},reducedMotion:'reduce',permissions:['clipboard-read','clipboard-write']});
 page.setDefaultTimeout(8000);
 let unblock;
 const hold=new Promise(resolve=>{unblock=resolve;});
 await page.route(/\/assets\/katex-[^/]+\.js$/,async route=>{await hold;await route.continue();});
 await page.goto(origin+'/?debug=1');
 await page.waitForFunction(()=>window.__aitiarch?.['fixture.md']);
 const setSelection=async(anchor,head=anchor)=>page.evaluate(([anchor,head])=>{
  const editor=window.__aitiarch['fixture.md'].view;
  editor.dispatch({selection:{anchor,head}});editor.focus();
 },[anchor,head]);
 const inline=page.locator('.cm-math-inline math');
 const display=page.locator('.cm-math-display math');
 await page.locator('.cm-math-display code').waitFor({state:'attached'});
 await page.locator('.pane').evaluate(el=>{el.scrollTop=155;});
 const geometry=()=>page.evaluate(()=>({
  scroll:document.querySelector('.pane').scrollTop,
  top:document.querySelector('.cm-math-display').getBoundingClientRect().top,
  height:document.querySelector('.cm-math-display').getBoundingClientRect().height,
 }));
 const beforeLayout=await geometry();
 assert(beforeLayout.scroll>0,'The scroll probe must move the note');
 unblock();
 await inline.waitFor({state:'attached',timeout:5000});
 await display.waitFor({state:'attached'});
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 assert.deepEqual(await geometry(),beforeLayout,'Lazy math must leave geometry and scroll unchanged');
 await page.getByText('Math could not be rendered.',{exact:true}).waitFor({state:'attached'});
 assert.equal(await page.locator('[data-math-fallback] code').textContent(),'$\\notAnAitiarchCommand{x}$');
 assert.equal(await page.locator('.cm-editor math').count(),2);
 const first=note.indexOf('$x_1$'),last=note.indexOf('> > $$',note.indexOf('frac'))+6;
 await setSelection(first-1);
 await page.keyboard.press('Shift+ArrowRight');
 await page.keyboard.press('Shift+ArrowRight');
 await inline.waitFor({state:'detached'});
 assert.match(await page.locator('.cm-content').innerText(),/\$x_1\$/);
 const documentText=()=>page.evaluate(()=>window.__aitiarch['fixture.md'].view.state.doc.toString());
 const imeAt=first+2;
 await setSelection(imeAt);
 const cdp=await page.context().newCDPSession(page);
 await cdp.send('Input.imeSetComposition',{text:'\u3042',selectionStart:1,selectionEnd:1});
 await cdp.send('Input.insertText',{text:'\u3042'});
 assert.equal(await documentText(),note.slice(0,imeAt)+'\u3042'+note.slice(imeAt));
 await page.keyboard.press('Control+z');
 assert.equal(await documentText(),note);
 await page.evaluate(()=>window.__aitiarch['fixture.md'].session.flush());
 await setSelection(first,last);
 await display.waitFor({state:'detached'});
 await page.keyboard.press('Control+c');
 assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),note.slice(first,last));
 await setSelection(0);
 await display.waitFor({state:'attached'});
 const before=await documentText();
 assert.equal(before,note);
 assert.deepEqual(await readFile(file),bytes);
 // Exercise the existing review, journal, notice and editor history with rich source.
 const ledgerAppend=LedgerStore.prototype.append;
 let failRecording=true;
 LedgerStore.prototype.append=async function(event){
  if(failRecording&&event.event==='inserted')throw Error('Synthetic ledger write failure');
  return ledgerAppend.call(this,event);
 };
 try{
  await page.keyboard.press('Control+k');
  const search=page.getByRole('dialog',{name:'Command palette'}).getByRole('textbox');
  await search.fill('confirm before adding');
  await search.press('Enter');
  await page.locator('.margin-card[data-ink-id="rich-insertion"]').getByRole('button',{name:'Add to note',exact:true}).click();
  const preview=page.getByRole('dialog',{name:'Review AI block insertion'});
  const patch='\n\n> [!ai]\n'+body.split('\n').map(line=>'> '+line).join('\n');
  assert.equal(await preview.locator('pre').textContent(),patch);
  const recorded=page.waitForResponse(r=>r.request().method()==='PUT'&&new URL(r.url()).pathname==='/api/threads/bring-complete');
  await preview.getByRole('button',{name:'Insert labeled AI block'}).click();
  await recorded.catch(async error=>{
   const notices=await page.locator('.notice,[role=alert]').allTextContents();
   throw new Error(notices.join(' | '),{cause:error});
  });
  const pending=page.getByRole('status',{name:'AI insertion recording pending'});
  await pending.waitFor();
  const after=Buffer.from('\uFEFF'+(note.slice(0,to)+patch+note.slice(to)).replace(/\n/g,'\r\n'));
  assert.deepEqual(await readFile(file),after);
  const anchorBefore=async()=>((await ink.read('fixture.md')).document.items[0].attachment);
  assert.deepEqual(await anchorBefore(),{status:'attached',from,to});
  failRecording=false;
  await pending.getByRole('button',{name:'Retry recording (no AI call)'}).click();
  await pending.waitFor({state:'detached'});
  assert.equal((await new LedgerStore(root).read()).events.filter(event=>event.event==='inserted').length,1);
  const toast=page.locator('.thought-toast').filter({hasText:'Added under'});
  await toast.getByRole('button',{name:'Undo'}).click();
  const flush=()=>page.evaluate(()=>window.__aitiarch['fixture.md'].session.flush());
  await flush();
  assert.deepEqual(await readFile(file),bytes);
  await page.keyboard.press('Control+y');
  await flush();
  assert.deepEqual(await readFile(file),after);
  assert.deepEqual(await anchorBefore(),{status:'attached',from,to});
  const nested=(await documentText()).indexOf('> > x^2');
  await setSelection(0);
  await page.locator('.cm-math-display math').nth(1).waitFor({state:'attached'});
  await setSelection(nested+5);
  await page.locator('.cm-math-display math').nth(1).waitFor({state:'detached'});
  assert.match(await page.locator('.cm-content').innerText(),/x\^2/);
 }finally{LedgerStore.prototype.append=ledgerAppend;}
 assert.equal(calls,0);
 await writeFile(path.join(output,'math-editor.json'),JSON.stringify({
  sourceReveal:true,keyboardSelection:true,imeCommitAndUndo:true,sourceClipboard:true,
  stableMathLayout:beforeLayout,roundTrip:true,ledgerRepair:true,providerCalls:calls,
 },null,2));
 console.log('Math source reveal, keyboard selection, composition, scroll stability, and insertion repair passed.');
}finally{
 await browser?.close();
 watcher.stop();
 await app.close();
}
