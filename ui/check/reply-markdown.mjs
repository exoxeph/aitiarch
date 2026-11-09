// Fake provider only. Rich replies, no fetched resources, and exact editor insertion/undo.
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,mkdir} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright-core';
import {Store} from '../server/store.ts';import {InkStore} from '../server/ink-store.ts';import {NoteWatcher} from '../server/watch.ts';import {createApp} from '../server/http.ts';import {captureAnchor} from '../shared/anchors.ts';
const out=path.resolve(process.env.BATCH2A_OUTPUT??'');assert(process.env.BATCH2A_OUTPUT&&!out.toLowerCase().startsWith(path.resolve('..').toLowerCase()));await mkdir(out,{recursive:true});
const root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-reply-markdown-'));execFileSync('git',['init','-q'],{cwd:root});await writeFile(path.join(root,'.gitignore'),'/.cache/\n/ui-state.json*\n');
const text='Anchor paragraph.\n\nUntouched  tail.\n',bytes=Buffer.from('\ufeff'+text.replace(/\n/g,'\r\n'));
const body='A useful example.\n\n```js\nconst x = 1;\nconst y = 2;\n```\n\n| A | B |\n| :---: | ---: |\n| **bold *nested*** | `code` |\n\n- first\n- second\n\n1. next\n\n- [x] done\n- [ ] waiting\n\n> [!tip]\n> Keep it small.\n\n<script>bad()</script>\n\n![remote](https://invalid.test/image) [link](https://invalid.test/link)';
await writeFile(path.join(root,'fixture.md'),bytes);
const ink=await InkStore.open(root),seed=await ink.read('fixture.md'),anchor=captureAnchor(text,0,17);
seed.document.items.push({id:'rich',kind:'answer',body,anchor,originalAnchor:anchor,attachment:{status:'attached',...anchor.position},generation:{requestId:'rich',action:'think',provider:'claude',model:null,status:'complete',createdAt:'2026-11-10T00:00:00Z',evidence:[],dismissed:false}});await ink.write('fixture.md',seed.document,null);
const store=await Store.open(root),watcher=new NoteWatcher(store,60,10);await watcher.start();
const app=createApp({store,watcher,distDir:path.resolve('dist'),provider:{name:'claude',checkAvailability:async()=>({available:true}),invoke:async r=>({id:r.id,provider:'claude',model:null,answer:body,claims:[],usage:null})}});let browser;const errors=[],requests=[];
try{
 const base='http://127.0.0.1:'+await app.listen(0);browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:2000,height:1100},permissions:['clipboard-read','clipboard-write']});page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!r.url().startsWith(base))requests.push(r.url());});
 await page.goto(base+'/?debug');const blob=page.locator('.margin-card[data-ink-id="rich"]');await blob.waitFor();
 const check=async scope=>{assert.equal(await scope.locator('table').count(),1);assert.equal(await scope.locator('pre code').textContent(),'const x = 1;\nconst y = 2;');assert.equal(await scope.locator('ul').count(),2);assert.equal(await scope.locator('ol').count(),1);assert.equal(await scope.locator('input[type=checkbox][disabled]').count(),2);assert.equal(await scope.locator('.cm-callout-tip').count(),1);assert.equal(await scope.locator('img,a,script,iframe').count(),0);assert.equal(await scope.locator('table strong em').textContent(),'nested');};
 await check(blob);await blob.getByRole('button',{name:'Copy JavaScript code',exact:true}).click();assert.equal((await page.evaluate(()=>navigator.clipboard.readText())).replace(/\r\n/g,'\n'),'const x = 1;\nconst y = 2;');
 await blob.getByRole('button',{name:/^Open AI thought thread:/}).click();const chat=page.getByRole('region',{name:'AI thought conversation',exact:true});await chat.waitFor();await check(chat);assert.equal(await chat.getByLabel('Your takeaway',{exact:true}).inputValue(),'');await page.screenshot({path:path.join(out,'rich-reply-light.png'),fullPage:true});
 await chat.getByRole('button',{name:'Collapse thought conversation'}).click();
 // Use a resource-free body for the insertion: hostile Markdown must never cause a fetch in the editor check.
 const safeBody=body.slice(0,body.indexOf('\n\n<script>'));const current=await ink.read('fixture.md');current.document.items[0].body=safeBody;await ink.write('fixture.md',current.document,current.version);await page.reload();await blob.waitFor();
 await blob.getByRole('button',{name:'Add to note',exact:true}).click();
 const expected=text.replace('\n\nUntouched','\n\n> [!ai]\n'+safeBody.split('\n').map(line=>'> '+line).join('\n')+'\n\nUntouched');
 await page.waitForFunction(()=>window.__aitiarch['fixture.md'].session.status==='saved'&&window.__aitiarch['fixture.md'].view.state.doc.toString().includes('> [!ai]'));
 assert.deepEqual(await readFile(path.join(root,'fixture.md')),Buffer.from('\ufeff'+expected.replace(/\n/g,'\r\n')));
 await page.evaluate(()=>{const v=window.__aitiarch['fixture.md'].view;v.dispatch({selection:{anchor:v.state.doc.length}});v.focus();});
 await page.locator('.cm-table-widget').waitFor();assert.equal(await page.locator('.cm-fence-head .cm-fence-lang').filter({hasText:'JavaScript'}).count()>0,true);
 await page.locator('.cm-editor .cm-fence-copy').click();assert.equal((await page.evaluate(()=>navigator.clipboard.readText())).replace(/\r\n/g,'\n'),'const x = 1;\nconst y = 2;');
 assert.equal(await page.locator('.cm-callout-tip').count()>0,true);
 await page.evaluate(()=>document.documentElement.dataset.theme='dark');await page.screenshot({path:path.join(out,'rich-reply-dark.png'),fullPage:true});
 await page.keyboard.press('Control+z');await page.waitForFunction(()=>window.__aitiarch['fixture.md'].session.status==='saved'&&!window.__aitiarch['fixture.md'].view.state.doc.toString().includes('> [!ai]'));assert.deepEqual(await readFile(path.join(root,'fixture.md')),bytes);
 await page.setViewportSize({width:900,height:1100});await page.locator('.cm-ink-block .reply-markdown table').waitFor();
 assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);console.log(JSON.stringify({pass:true,blocks:5,clipboard:true,conversation:true,insertUndoByteExact:true,narrow:true,externalRequests:requests.length}));
}finally{await browser?.close();await app.close();await watcher.stop();console.log('Cleanup fixture:',root);await rm(root,{recursive:true,force:true});}
