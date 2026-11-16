import './config-isolation.mjs';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';
import {Store} from '../server/store.ts';import {NoteWatcher} from '../server/watch.ts';import {createApp} from '../server/http.ts';
import {InkStore} from '../server/ink-store.ts';import {captureAnchor} from '../shared/anchors.ts';import {newThread} from '../shared/threads.ts';
const ui=fileURLToPath(new URL('../',import.meta.url)),dir=await mkdtemp(path.join(os.tmpdir(),'aitiarch-privacy-notices-'));
const browser=await chromium.launch({channel:'msedge',headless:true});
try{for(const git of [false,true]){
 const root=path.join(dir,git?'git-notes':'plain-notes');await mkdir(root);if(git)execFileSync('git',['init','-q'],{cwd:root,stdio:'pipe'});
 const text='A unique synthetic sentence.\n';await writeFile(path.join(root,'fixture.md'),text);
 const ink=await InkStore.open(root),s=await ink.read('fixture.md'),anchor=captureAnchor(text,0,text.length-1);
 const item={id:'seed',kind:'answer',body:'Synthetic AI reply.',anchor,originalAnchor:anchor,attachment:{status:'attached',...anchor.position},generation:{requestId:'seed',action:'think',provider:'claude',model:null,status:'complete',createdAt:new Date().toISOString(),evidence:[],dismissed:false}};item.thread=newThread(item);s.document.items.push(item);
 const lost=captureAnchor('Removed synthetic sentence.',0,27),orphan={...item,id:'orphan',body:'Preserved orphan reply.',anchor:lost,originalAnchor:lost,attachment:{status:'orphaned',reason:'missing'},generation:{...item.generation,requestId:'orphan'}};orphan.thread=newThread(orphan);s.document.items.push(orphan);const {thread,generation,...legacy}=orphan;s.document.items.push({...legacy,id:'legacy',body:'Legacy orphan without a thread.'});await ink.write('fixture.md',s.document,s.version);
 const store=await Store.open(root),watcher=new NoteWatcher(store),app=createApp({store,watcher,distDir:path.join(ui,'dist')});const page=await browser.newPage({viewport:{width:1500,height:1000}});page.setDefaultTimeout(10000);
 try{
  await page.goto('http://127.0.0.1:'+await app.listen(0)+'/?debug=1');await page.waitForSelector('.cm-editor');
  assert.equal(await page.getByRole('button',{name:'Add /.cache/ to root .gitignore',exact:true}).count(),git?1:0,'cache notice only inside Git');
  await page.getByLabel('Theme',{exact:true}).selectOption('moss');
  if(git)await page.getByRole('button',{name:'Dismiss tree preference notice'}).waitFor();
  else assert.equal(await page.getByRole('button',{name:'Dismiss tree preference notice'}).count(),0,'no UI-state Git notice outside Git');
  const draftLoaded=page.waitForResponse(r=>r.url().includes('/api/thread-drafts?'));
  await page.locator('.thought-open:visible').click();await page.getByLabel('Your takeaway',{exact:true}).waitFor();await (await draftLoaded).finished();
  if(git)await page.getByRole('button',{name:'Dismiss draft notice'}).waitFor();
  else await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  assert.equal(await page.getByRole('button',{name:'Dismiss draft notice'}).count(),git?1:0,'draft Git notice only inside Git');
  await page.getByLabel('Your takeaway',{exact:true}).fill('Human fixture draft.');
  if(git){await page.getByRole('button',{name:'Add /ui-state.json* to root .gitignore',exact:true}).first().click();await page.waitForFunction(async()=>(await(await fetch('/api/thread-drafts/status')).json()).enabled);assert.match(await readFile(path.join(root,'.gitignore'),'utf8'),/\/ui-state\.json\*/);}
  else {const state=await readFile(path.join(root,'ui-state.json'),'utf8').catch(()=> '{}');assert(!state.includes('Human fixture draft.'),'no unverified draft persistence');}
  await page.getByRole('button',{name:'Collapse thought conversation'}).click();
  await page.getByRole('button',{name:/^Note menu/}).click();const orphans=page.getByRole('region',{name:'Orphaned ink'});await orphans.getByText('Preserved orphan reply.',{exact:true}).waitFor();assert.equal(await orphans.getByRole('button',{name:'Open thread',exact:true}).count(),1);
  await orphans.getByRole('button',{name:'Open thread',exact:true}).click();await page.locator('.thought-chat:visible').getByText('Preserved orphan reply.',{exact:true}).waitFor();assert.equal(await page.getByRole('dialog',{name:'Note details'}).isVisible(),false);assert.equal(await readFile(path.join(root,'fixture.md'),'utf8'),text,'opening an orphan never edits Markdown');
 }finally{await page.close();await app.close();watcher.stop();}
}}finally{await browser.close();console.log('CLEANUP TARGET synthetic privacy fixtures:',dir);await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
console.log('PASS: Git-only notices, verified-ignore persistence, and orphan Open thread without Markdown edits');
