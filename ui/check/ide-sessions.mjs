// Synthetic session files + fake provider only; no external requests or screenshots.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';
import {Store} from '../server/store.ts';import {NoteWatcher} from '../server/watch.ts';import {createApp} from '../server/http.ts';
import {sessionModules} from '../server/chat/ide-sessions.ts';import {FakeChatProvider} from '../server/chat/fake.ts';
const root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-m6-browser-')),sessions=path.join(root,'sessions');await mkdir(sessions);
const bytes=Buffer.from('\ufeff# Synthetic note\r\n\r\nA synthetic plan.\r\n');await writeFile(path.join(root,'fixture.md'),bytes);
await writeFile(path.join(sessions,'synthetic.jsonl'),[{type:'user',cwd:root,message:{role:'user',content:'Synthetic private context token=synthetic-secret'}},{type:'assistant',cwd:root,message:{role:'assistant',stop_reason:'end_turn',content:[{type:'text',text:'Synthetic final answer'}]}}].map(x=>JSON.stringify(x)).join('\n')+'\n');
const provider=new FakeChatProvider(),store=await Store.open(root),watcher=new NoteWatcher(store);
const app=createApp({store,watcher,provider,distDir:fileURLToPath(new URL('../dist',import.meta.url)),sessionModules:sessionModules({project:root,roots:{'claude-sessions':sessions,'codex-sessions':path.join(root,'missing')}})});
let browser;try{
 const base='http://127.0.0.1:'+await app.listen(0);browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage();const external=[];
 await page.route('**/*',route=>{if(!route.request().url().startsWith(base)){external.push(true);return route.abort();}return route.continue();});await page.goto(base);await page.waitForSelector('.cm-editor');await page.getByRole('button',{name:/^Chat/}).click();
 const panel=page.locator('#chat-panel');await panel.getByText('IDE session context (optional)',{exact:true}).click();await panel.getByRole('button',{name:'List sessions for this project'}).click();
 const choice=panel.getByRole('checkbox',{name:'Claude Code sessions 1',exact:true});await choice.waitFor();assert.equal(await choice.isChecked(),false);await choice.check();
 const composer=panel.getByRole('textbox',{name:'Message Aitiarch AI'});await composer.fill('Synthetic question');await composer.press('Enter');const review=panel.getByRole('region',{name:'What will be sent'});await review.waitFor();assert.equal(provider.requests.length,0);assert.equal(await review.getByRole('checkbox').count(),0);
 await review.locator('summary').filter({hasText:'Claude Code sessions'}).click();const preview=await review.innerText();assert.ok(preview.includes('Synthetic private context'));assert.ok(!preview.includes('synthetic-secret'));await review.getByRole('button',{name:'Send',exact:true}).click();await panel.locator('.chat-ai:not(.chat-streaming)').waitFor();assert.equal(provider.requests.length,1);assert.equal(await panel.getByRole('button',{name:'Add to note',exact:true}).isDisabled(),true);
 await composer.fill('Synthetic followup');await composer.press('Enter');await review.waitFor();assert.equal(provider.requests.length,1);await review.getByRole('button',{name:'Cancel',exact:true}).click();await page.reload();await page.waitForSelector('.cm-editor');await page.getByRole('button',{name:/^Chat/}).click();await panel.locator('.chat-ai').waitFor();assert.equal(await panel.getByRole('button',{name:'Add to note',exact:true}).isDisabled(),true);
 assert.deepEqual(external,[]);assert.ok((await readFile(path.join(root,'fixture.md'))).equals(bytes));console.log(JSON.stringify({pass:true,fakeCalls:provider.requests.length,previewRequired:true,insertionBlocked:true,markdownByteExact:true}));
}finally{await browser?.close();watcher.stop();await app.close();console.log('CLEANUP TARGET synthetic session browser fixture',root);await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
