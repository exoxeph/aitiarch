// Synthetic notes + in-process fake provider only. No real notebooks or provider CLIs.
const confirmOn=async page=>{await page.keyboard.press('Control+k');await page.waitForTimeout(150);await page.keyboard.type('Add to note');await page.waitForTimeout(150);if(await page.getByText(/Add to note: confirm before adding/).count()){await page.keyboard.press('Enter');}else{await page.keyboard.press('Escape');}await page.waitForTimeout(100);};
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright-core';
import {Store} from '../server/store.ts';import {InkStore} from '../server/ink-store.ts';import {NoteWatcher} from '../server/watch.ts';import {createApp} from '../server/http.ts';import {captureAnchor} from '../shared/anchors.ts';
const out=path.resolve(process.env.BATCH2A_OUTPUT??'');assert(process.env.BATCH2A_OUTPUT&&!out.toLowerCase().startsWith(path.resolve('..').toLowerCase()));await mkdir(out,{recursive:true});
const root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-thoughts-'));execFileSync('git',['init','-q'],{cwd:root});await writeFile(path.join(root,'.gitignore'),'/.cache/\n/ui-state.json*\n');
const text='# Synthetic launch\n\nThe web app ships with a small checklist. The first release works offline.\n\nA second paragraph supports a different question.\n\nEnd of synthetic note.\n';
const bytes=Buffer.from('\ufeff'+text.replace(/\n/g,'\r\n'));await writeFile(path.join(root,'fixture.md'),bytes);
const ink=await InkStore.open(root),seed=await ink.read('fixture.md'),from=text.indexOf('The web'),anchor=captureAnchor(text,from,from+40);
for(const id of ['seed1','seed3','seed2'])seed.document.items.push({id,kind:'answer',body:'Synthetic thought '+id+'.',anchor,originalAnchor:anchor,attachment:{status:'attached',...anchor.position},generation:{requestId:id,action:'think',provider:'claude',model:null,status:'complete',createdAt:'2026-11-09T00:00:00Z',evidence:[],dismissed:false}});
await ink.write('fixture.md',seed.document,null);
const store=await Store.open(root),watcher=new NoteWatcher(store,60,10);await watcher.start();
let calls=0;const app=createApp({store,watcher,distDir:path.resolve('dist'),provider:{name:'claude',checkAvailability:async()=>({available:true}),invoke:async r=>{calls++;return {id:r.id,provider:'claude',model:null,answer:'Synthetic accepted reply.',claims:[],usage:null};}}});let browser;const errors=[];
try{
 const base='http://127.0.0.1:'+await app.listen(0);browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:2000,height:1050}});page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/?debug');await page.waitForFunction(()=>document.querySelectorAll('.margin-card').length===3);await page.waitForTimeout(150);
 assert.equal(await page.locator('.cm-ink-block').count(),0,'wide editor must not contain inline answer widgets');assert.equal(await page.locator('.cm-thought-anchor').count()>0,true);
 const collision=await page.locator('.margin-card').evaluateAll(els=>els.map(e=>({side:e.dataset.side,...Object.fromEntries(['top','bottom','left','right'].map(k=>[k,e.getBoundingClientRect()[k]]))})).sort((a,b)=>a.top-b.top));
 for(const side of ['left','right']){const rows=collision.filter(r=>r.side===side);for(let n=1;n<rows.length;n++)assert(rows[n].top>=rows[n-1].bottom+7);}
 assert.deepEqual(await readFile(path.join(root,'fixture.md')),bytes);
 const first=page.locator('.margin-card[data-ink-id="seed1"]');await first.hover();assert(await page.locator('.cm-thought-anchor.thought-active').count()>0);
 const button=first.getByRole('button',{name:/^Open AI thought thread:/});await button.focus();await page.keyboard.press('Enter');
 const chat=page.getByRole('region',{name:'AI thought conversation',exact:true});await chat.waitFor();assert.equal(await chat.getByLabel('Your takeaway',{exact:true}).inputValue(),'');
 await chat.getByLabel('Write back').fill('What matters?');await chat.getByRole('button',{name:'Review reply',exact:true}).click();await chat.getByRole('button',{name:'Send reply',exact:true}).click();await chat.getByText('Synthetic accepted reply.',{exact:true}).waitFor();assert.equal(calls,1);
 const chatTop=await chat.evaluate(e=>e.getBoundingClientRect().top);
 await page.evaluate(()=>window.__aitiarch['fixture.md'].view.dispatch({changes:{from:0,insert:'Temporary line.\n\n'}}));
 await page.waitForFunction(y=>Math.abs(document.querySelector('.thought-chat').getBoundingClientRect().top-y)>10,chatTop);
 await page.evaluate(()=>window.__aitiarch['fixture.md'].view.focus());await page.keyboard.press('Control+z');await page.waitForFunction(()=>window.__aitiarch['fixture.md'].session.status==='saved');
 await page.screenshot({path:path.join(out,'thoughts-chat-light.png'),fullPage:true});await chat.getByRole('button',{name:'Collapse thought conversation'}).click();
 await confirmOn(page);await first.getByRole('button',{name:'Add to note',exact:true}).click();const preview=page.getByRole('dialog',{name:'Review AI block insertion'});await preview.waitFor();assert.equal(await preview.getByRole('button',{name:'Insert labeled AI block',exact:true}).evaluate(e=>e===document.activeElement),true);await page.keyboard.press('Shift+Tab');assert.equal(await preview.getByRole('button',{name:'Cancel AI insertion',exact:true}).evaluate(e=>e===document.activeElement),true);assert((await preview.locator('pre').textContent()).includes('> [!ai]\n> Synthetic thought seed1.'));assert.deepEqual(await readFile(path.join(root,'fixture.md')),bytes);
 // Delay confirmation's disk read; a simultaneous edit must invalidate its frozen preview.
 let release;const blocked=new Promise(r=>release=r);let reached;const reading=new Promise(r=>reached=r);
 await page.route('**/api/file?path=fixture.md',async route=>{reached();await blocked;await route.continue();});
 await preview.getByRole('button',{name:'Insert labeled AI block',exact:true}).click();await reading;
 await page.evaluate(()=>window.__aitiarch['fixture.md'].view.dispatch({changes:{from:window.__aitiarch['fixture.md'].view.state.doc.length,insert:'Changed during check.'}}));release();await page.unrouteAll({behavior:'wait'});
 await page.getByRole('alert').filter({hasText:'The note changed. Review a new preview.'}).waitFor();assert(!(await page.evaluate(()=>window.__aitiarch['fixture.md'].view.state.doc.toString())).includes('> [!ai]'));
 await page.evaluate(()=>window.__aitiarch['fixture.md'].view.focus());await page.keyboard.press('Control+z');await page.waitForFunction(()=>window.__aitiarch['fixture.md'].session.status==='saved');
 await confirmOn(page);await first.getByRole('button',{name:'Add to note',exact:true}).click();await preview.waitFor();
 await preview.getByRole('button',{name:'Insert labeled AI block',exact:true}).click();await page.waitForFunction(()=>window.__aitiarch['fixture.md'].session.status==='saved'&&window.__aitiarch['fixture.md'].view.state.doc.toString().includes('> [!ai]'));
 await page.waitForFunction(async()=>{const r=await fetch('/api/threads?path=fixture.md');return r.ok;});await page.waitForTimeout(150);
 const inserted=await readFile(path.join(root,'fixture.md'));const expected=text.replace('\n\nA second','\n\n> [!ai]\n> Synthetic thought seed1.\n\nA second');assert.equal(inserted.toString(),'\ufeff'+expected.replace(/\n/g,'\r\n'));
 assert(await page.locator('.cm-callout-ai').count()>0);assert.equal(await page.locator('.cm-callout-ai .cm-callout-marker').first().evaluate(e=>getComputedStyle(e,'::after').content),'"AI"');
 await page.screenshot({path:path.join(out,'thoughts-brought.png'),fullPage:true});
 const ledger=JSON.parse(await readFile(path.join(root,'ledger.json'),'utf8'));assert(ledger.events.some(e=>e.event==='inserted'&&e.authorship==='ai'&&e.insertedBy==='human'));
 await page.evaluate(()=>window.__aitiarch['fixture.md'].view.focus());await page.keyboard.press('Control+z');await page.waitForFunction(()=>window.__aitiarch['fixture.md'].session.status==='saved'&&!window.__aitiarch['fixture.md'].view.state.doc.toString().includes('> [!ai]'));assert.deepEqual(await readFile(path.join(root,'fixture.md')),bytes);
 // External edit above anchor uses shared mapping, including after reload.
 const edited=Buffer.from('\ufeffInserted above.\r\n\r\n'+text.replace(/\n/g,'\r\n'));await writeFile(path.join(root,'fixture.md'),edited);await page.waitForFunction(()=>window.__aitiarch['fixture.md'].view.state.doc.toString().startsWith('Inserted above.'));await page.reload();await page.locator('.margin-card').first().waitFor();assert.deepEqual(await readFile(path.join(root,'fixture.md')),edited);
 for(const theme of ['light','dark']){await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await page.screenshot({path:path.join(out,'thoughts-'+theme+'.png'),fullPage:true});}
 await page.setViewportSize({width:780,height:1000});await page.waitForFunction(()=>document.querySelectorAll('.margin-card').length===0&&document.querySelectorAll('.cm-ink-block').length===3);await page.locator('.cm-ink-group').first().scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,'thoughts-narrow.png'),fullPage:true});assert.deepEqual(await readFile(path.join(root,'fixture.md')),edited);
 // Deleting the open thought closes it instead of switching to a different thread.
 await page.locator('.cm-ink-block[data-ink-id="seed1"]').getByRole('button',{name:/^Open AI thought thread:/}).click();await chat.waitFor();
 await chat.getByRole('button',{name:/^Delete thread/}).click();await chat.getByRole('button',{name:'Confirm delete thread',exact:true}).click();await chat.waitFor({state:'detached'});
 const sidecar=JSON.parse(await readFile(path.join(root,'ink/fixture.ink.json'),'utf8'));for(const i of sidecar.items){assert.equal(i.thread?.takeaway.text??null,null);assert(!('why' in i));assert(!('failedReason' in i));}assert.deepEqual(errors,[]);
 console.log(JSON.stringify({pass:true,checks:['margin-only wide','collision gap','AI labels','dotted anchor hover','keyboard mini chat','mini chat follows edits','delete closes mini chat','preview modal focus and Tab','edit during preview verification rejected','fake followup','empty takeaway','exact insertion preview','AI human ledger provenance','BOM CRLF inserted-byte diff','one undo exact bytes','external mapping reload','narrow paragraph list','owned fields untouched'],fakeCalls:calls,screenshots:out}));
}catch(e){if(browser)for(const context of browser.contexts())for(const p of context.pages())console.error(JSON.stringify({alerts:await p.locator('[role=alert]').allTextContents()}));throw e;}finally{await browser?.close();watcher.stop();await app.close();console.log('CLEANUP TARGET: '+root);await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
