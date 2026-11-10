// Local-only consent and fake-run integration. No real CLI, screenshots or network provider.
import assert from 'node:assert/strict';import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';import {chromium} from 'playwright-core';
import {Store} from '../server/store.ts';import {NoteWatcher} from '../server/watch.ts';import {createApp} from '../server/http.ts';import {FakeInvestigator} from '../server/investigator/fake.ts';
const ui=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),repo=path.dirname(ui);
assert(path.resolve(os.tmpdir()).startsWith(repo+path.sep),'Set TEMP/TMP to a repo-local fixture directory.');
const project=await mkdtemp(path.join(os.tmpdir(),'aitiarch-m4-browser-')),root=path.join(project,'.aitiarch');await mkdir(root);const original='\ufeff# Synthetic plan\r\n\r\nBuild an invented calendar.\r\n';await writeFile(path.join(root,'plan.md'),original);
const fake=new FakeInvestigator([{say:'Synthetic investigator complete.',delegate:[]}]),store=await Store.open(root),watcher=new NoteWatcher(store),app=createApp({store,watcher,distDir:path.join(ui,'dist'),investigator:{claude:fake}});let browser;
try{
 const base='http://127.0.0.1:'+await app.listen(0);browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage();let external=0;
 await page.route('**/*',r=>{if(new URL(r.request().url()).origin!==base){external++;return r.abort();}return r.continue();});
 await page.goto(base);await page.locator('.cm-content').waitFor();await page.getByRole('button',{name:'Chat',exact:true}).click();await page.getByText('Investigator (off by default)',{exact:true}).click();
 const enable=page.getByRole('button',{name:'Enable investigator',exact:true});await enable.waitFor();assert.equal(fake.calls.length,0);await enable.click();await page.getByRole('button',{name:'Disable investigator',exact:true}).waitFor();
 await page.getByRole('textbox',{name:'Investigator question',exact:true}).fill('A synthetic question.');await page.getByRole('button',{name:'Investigate',exact:true}).click();await page.getByText('Synthetic investigator complete.',{exact:false}).last().waitFor();
 assert.equal(fake.calls.length,1);assert.equal(external,0);assert.equal(await readFile(path.join(root,'plan.md'),'utf8'),original);const ledger=JSON.parse(await readFile(path.join(root,'ledger.json'),'utf8'));assert.equal(ledger.events.filter(e=>e.event==='investigation').length,1);
 console.log(JSON.stringify({passed:true,consent:true,disabledBeforeConsent:true,fakeCalls:1,externalRequests:0,markdownByteExact:true,ledger:true}));
}finally{await browser?.close();watcher.stop();await app.close();console.log('CLEANUP TARGET fixture',project);await rm(project,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
