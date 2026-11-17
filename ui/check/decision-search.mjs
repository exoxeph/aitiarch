import './config-isolation.mjs';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,utimes,rm} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';
import {Store} from '../server/store.ts';import {NoteWatcher} from '../server/watch.ts';import {createApp} from '../server/http.ts';
const root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-decision-search-'));
const output=process.env.BATCH2A_OUTPUT;assert(output&&!path.resolve(output).startsWith(path.resolve(fileURLToPath(new URL('../../',import.meta.url)))));await mkdir(output,{recursive:true});
const sources={'a.md':'\ufeff# Older\r\nDecision: Use polling\r\nWhy: Small load\r\nRejected: Queue\r\n',
 'b.md':'# Newer\nA unique cobalt phrase in ordinary prose.\nDecision: Use a queue\nWhy: Handle bursts\nRejected: Blocking\n',
 'empty.md':'# Quiet\nNo decisions here.\n',
 'search.md':Array.from({length:30},(_,i)=>`Queue prose ${i}`).join('\n')};
for(const [name,text] of Object.entries(sources))await writeFile(path.join(root,name),text);
await utimes(path.join(root,'a.md'),new Date(100000),new Date(100000));await utimes(path.join(root,'b.md'),new Date(200000),new Date(200000));
const store=await Store.open(root),watcher=new NoteWatcher(store,50,10);await watcher.start();let providerCalls=0;
const app=createApp({store,watcher,distDir:fileURLToPath(new URL('../dist',import.meta.url)),provider:{name:'claude',checkAvailability:async()=>({available:true}),invoke:async()=>{providerCalls++;throw Error('No provider call allowed');}}});
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage();await page.goto(`http://127.0.0.1:${await app.listen(0)}/?debug=1`);await page.getByRole('button',{name:'Commands',exact:true}).waitFor();
 const palette=async query=>{await page.getByRole('button',{name:'Commands',exact:true}).click();await page.getByPlaceholder('Type a command…').fill(query);};
 await page.getByRole('button',{name:'Notes menu',exact:true}).click();
 await page.locator('#note-tree').getByRole('button',{name:'Decisions',exact:true}).click();
 await page.getByRole('heading',{name:'Decisions across all notes',exact:true}).waitFor();
 await page.getByRole('button',{name:'Close the constellation'}).click();
 await palette('Show decisions');await page.keyboard.press('Enter');const section=page.getByRole('region',{name:'Decisions',exact:true});
 await section.getByRole('button').first().waitFor();assert.match(await section.getByRole('button').first().textContent(),/Use a queue/);
 assert.match(await section.textContent(),/Why: Handle bursts/);assert.match(await section.textContent(),/Rejected: Blocking/);
 assert.equal(await page.locator(':focus').textContent(),'Decisions across all notes');await page.keyboard.press('Tab');assert.match(await page.locator(':focus').textContent(),/Use a queue/);
 await page.keyboard.press('ArrowDown');assert.match(await page.locator(':focus').textContent(),/Use polling/);await page.keyboard.press('Enter');
 await page.waitForFunction(()=>window.__aitiarch?.['a.md']?.view.state.doc.lineAt(window.__aitiarch['a.md'].view.state.selection.main.head).number===2);
 await page.setViewportSize({width:360,height:780});await palette('Show decisions');await page.keyboard.press('Enter');await section.getByRole('button').first().click();
 await page.waitForFunction(()=>window.__aitiarch?.['b.md']?.view.state.doc.lineAt(window.__aitiarch['b.md'].view.state.selection.main.head).number===3);
 await palette('COBALT');const options=page.getByRole('dialog',{name:'Command palette'}).getByRole('option');await options.first().waitFor();assert.match(await options.first().textContent(),/cobalt phrase/);assert.match(await options.first().textContent(),/Newer/);await page.keyboard.press('Enter');
 await page.waitForFunction(()=>window.__aitiarch?.['b.md']?.view.state.doc.lineAt(window.__aitiarch['b.md'].view.state.selection.main.head).number===2);
 await palette('queue');await page.waitForFunction(()=>document.querySelectorAll('.overlay-box [role="option"]').length===20);
 assert.match(await options.nth(0).textContent(),/^Decisions/);assert.match(await options.nth(2).textContent(),/^Note text/);
 await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');await page.waitForFunction(()=>window.__aitiarch?.['a.md']?.view.state.doc.lineAt(window.__aitiarch['a.md'].view.state.selection.main.head).number===2);
 await palette('no-possible-match-731');await page.getByText('No matches',{exact:true}).waitFor();await page.keyboard.press('Escape');await page.getByRole('dialog',{name:'Command palette'}).waitFor({state:'hidden'});
 for(const [name,text] of Object.entries(sources))assert.deepEqual(await readFile(path.join(root,name)),Buffer.from(text));
 assert.equal(providerCalls,0);console.log('PASS: decision list and text search, ranking, 20-result cap, keyboard and pointer navigation, exact source lines, Markdown byte identity; no provider calls');
}finally{
 await browser.close();watcher.stop();await app.close();
 console.log('CLEANUP TARGET (synthetic decision/search fixture): '+root);await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
