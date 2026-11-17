// Real browser geometry checks; synthetic notes, no provider calls.
import './config-isolation.mjs';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';
import {Store} from '../server/store.ts';import {NoteWatcher} from '../server/watch.ts';import {createApp} from '../server/http.ts';
import {InkStore} from '../server/ink-store.ts';import {captureAnchor} from '../shared/anchors.ts';
const out=path.resolve(process.env.BATCH2A_OUTPUT??'');
assert(process.env.BATCH2A_OUTPUT&&!out.toLowerCase().startsWith(path.resolve(fileURLToPath(new URL('../../',import.meta.url))).toLowerCase()));
await mkdir(out,{recursive:true});const root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-narrow-window-'));
const bytes=Buffer.from('\ufeff# Orders service redesign\r\n\r\nFictional orders use an outbox.\r\n');
await writeFile(path.join(root,'notebook.md'),bytes);
const ink=await InkStore.open(root),seed=await ink.read('notebook.md'),text=bytes.toString('utf8').replace(/^\ufeff/,'').replace(/\r\n/g,'\n'),from=text.indexOf('Fictional'),anchor=captureAnchor(text,from,from+9);
seed.document.items.push({id:'narrow-thread',kind:'answer',body:'Synthetic answer. '.repeat(100),anchor,originalAnchor:anchor,attachment:{status:'attached',...anchor.position},generation:{requestId:'narrow-thread',action:'think',provider:'claude',model:null,status:'complete',createdAt:'2026-11-09T00:00:00Z',evidence:[],dismissed:false}});await ink.write('notebook.md',seed.document,null);
const store=await Store.open(root),watcher=new NoteWatcher(store);await watcher.start();let calls=0;
const app=createApp({store,watcher,distDir:fileURLToPath(new URL('../dist',import.meta.url)),provider:{name:'claude',checkAvailability:async()=>({available:true}),invoke:async()=>{calls++;throw Error('No calls allowed');}}});
const browser=await chromium.launch({channel:'msedge',headless:true}),base='http://127.0.0.1:'+await app.listen(0),measurements=[];
try{for(const width of [700,600,480,360,320]){
 const page=await browser.newPage({viewport:{width,height:800}});await page.goto(base+'/?debug');await page.setViewportSize({width,height:800});await page.locator('.cm-editor').waitFor();await page.evaluate(()=>document.fonts.ready);
 const rects=await page.locator('.topbar').evaluate(el=>{const box=e=>e.getBoundingClientRect().toJSON();return {header:box(el),tabs:box(el.querySelector('.tabs')),tab:box(el.querySelector('.tab')),buttons:[...el.querySelectorAll('button,select')].filter(e=>e.getClientRects().length&&!e.closest('.tabs')).map(e=>({name:e.getAttribute('aria-label')??e.textContent,rect:box(e)})),overflow:document.documentElement.scrollWidth>innerWidth};});
 assert.equal(rects.overflow,false,`${width}: no sideways overflow`);
 if(width>=480){assert(rects.tab.right<=rects.tabs.right+1,`${width}: short note tab must not be clipped (${rects.tab.right} > ${rects.tabs.right})`);for(const b of rects.buttons)assert(b.rect.left>=0&&b.rect.right<=width,`${width}: ${b.name} stays inside header`);}
 const row={width,...rects};measurements.push(row);
 if(width>=480){
  await page.screenshot({path:path.join(out,`header-${width}.png`)});
  await page.getByRole('button',{name:/^Open AI thought thread:/}).click();const sheet=page.locator('.thought-chat');await sheet.waitFor();
  row.thread=await sheet.evaluate(e=>e.getBoundingClientRect().toJSON());row.footer=await page.locator('.statusbar').evaluate(e=>e.getBoundingClientRect().toJSON());
  await page.screenshot({path:path.join(out,`thread-${width}.png`)});
  assert(row.thread.bottom<=row.footer.top,`${width}: thread bottom ${row.thread.bottom} must stay above footer ${row.footer.top}`);
 }
 await page.close();
 }assert.equal(calls,0);assert.deepEqual(await readFile(path.join(root,'notebook.md')),bytes);await writeFile(path.join(out,'rects.json'),JSON.stringify(measurements,null,2));console.log('PASS: 700/600/480 header visibility and thread/footer clearance; 320/360 no overflow; byte identity; no calls');
}finally{await browser.close();watcher.stop();await app.close();console.log('Synthetic fixture retained: '+root);}
