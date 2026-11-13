// Real-browser check: two projects open in ONE server run must not leak into each other. Same note name in both (the most sensitive way to catch a leak),
// two pages in the same browser, a synthetic Claude Code CLI (no model, no network), temp folders and a temp registry. Checks:
//   - every /api call a page makes goes to its own project (/api/p/<its id>/...), apart from the host's own routes: nothing the page does is unscoped;
//   - a conversation made in project A is not in B's list, B cannot send in it, and a message in A shows in A's chat only;
//   - the persona chosen for A's chat is not B's; B keeps the default;
//   - each project's CLI files (the notes, the instruction, the sessions folder) are its own.
// Never touches the real %APPDATA%\aitiarch or any real notebook.   Run (after `vite build`): BATCH2A_OUTPUT=<folder outside the repo> node check/two-projects.mjs
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';
import {createHost} from '../server/host.ts';
import {Registry} from '../server/registry.ts';
import {createSecurity} from '../server/security.ts';
import {createApp} from '../server/http.ts';
import {Store} from '../server/store.ts';
import {NoteWatcher} from '../server/watch.ts';
const here=path.dirname(fileURLToPath(import.meta.url));
const output=process.env.BATCH2A_OUTPUT||process.env.GROVE_OUTPUT;
if(!output||path.resolve(output).toLowerCase().startsWith(path.resolve(here,'..','..').toLowerCase()))throw new Error('Set BATCH2A_OUTPUT to a folder outside the repository.');
await mkdir(output,{recursive:true});
const base=await mkdtemp(path.join(os.tmpdir(),'aitiarch-two-projects-'));
const cli=path.join(here,'..','test','fixtures','harness-cli.mjs');
const NOTE={alpha:'# Shared name\n\nALPHA-ONLY-SENTENCE lives in the first project.\n',beta:'# Shared name\n\nBETA-ONLY-SENTENCE lives in the second project.\n'};
const projects={};
for(const name of ['alpha','beta']){
 const dir=path.join(base,name);await mkdir(path.join(dir,'.aitiarch'),{recursive:true});execFileSync('git',['init','-q'],{cwd:path.join(dir,'.aitiarch')});
 await writeFile(path.join(dir,'.aitiarch','.gitignore'),'/chat/\n/ui-state.json*\n');await writeFile(path.join(dir,'.aitiarch','fixture.md'),NOTE[name]);
 projects[name]={dir,record:path.join(base,name+'-calls.jsonl'),harness:path.join(base,name+'-harness')};
}
await mkdir(path.join(base,'config'),{recursive:true});
const registry=await Registry.open(path.join(base,'config'));
const entries={alpha:await registry.add(projects.alpha.dir),beta:await registry.add(projects.beta.dir)};
let port=0;const security=createSecurity({port:()=>port});
const provider={name:'claude',async checkAvailability(){return {available:true,textStreaming:true};},async invoke(){throw new Error('the one-off chat is not used here');}};
const byId=Object.fromEntries(Object.entries(entries).map(([name,e])=>[e.id,name]));
const host=createHost({registry,security,distDir:path.join(here,'../dist'),
 openProject:async entry=>{const name=byId[entry.id],p=projects[name],store=await Store.open(entry.notes),watcher=new NoteWatcher(store);
  const app=createApp({store,watcher,distDir:path.join(here,'../dist'),security,provider,harness:{command:process.execPath,prefixArgs:[cli,'ok',p.record],dir:p.harness}});
  return {handle:app.handle,close:async()=>{watcher.stop();await app.close();}};}});
port=await host.listen(0);
const origin=`http://127.0.0.1:${port}`;
const browser=await (async()=>{for(const channel of ['msedge','chrome']){try{return await chromium.launch({channel,headless:true});}catch{/* next */}}throw new Error('Edge or Chrome is required.');})();
const report={},unscoped=[];
try{
 const context=await browser.newContext({viewport:{width:1440,height:900}});
 await context.addCookies([{name:'aitiarch',value:security.token,url:origin}]);
 const open=async name=>{
  const page=await context.newPage();page.setDefaultTimeout(15000);
  const id=entries[name].id;
  page.on('request',r=>{const u=new URL(r.url());if(u.origin!==origin){if(!r.url().startsWith('data:')&&!r.url().startsWith('blob:'))unscoped.push(`external ${r.url()}`);return;}
   if(!u.pathname.startsWith('/api/'))return;
   const own=u.pathname.startsWith(`/api/p/${id}/`),host=/^\/api\/(projects|health|session)(\/|$)/.test(u.pathname);
   if(!own&&!host)unscoped.push(`${name}: ${r.method()} ${u.pathname}`);});
  await page.goto(`${origin}/?project=${id}&debug=1`);await page.waitForSelector('.cm-editor');
  return page;
 };
 const pageA=await open('alpha'),pageB=await open('beta');
 const openChat=async page=>{await page.getByRole('button',{name:/^Chat/}).click();const panel=page.locator('#chat-panel');await panel.waitFor();return panel;};
 // Both pages edit "fixture.md": open it in each (the first note may already be open)
 for(const page of [pageA,pageB]){await page.waitForFunction(()=>!!window.__aitiarch&&Object.keys(window.__aitiarch).length>0);}
 const noteText=page=>page.evaluate(()=>{const e=Object.values(window.__aitiarch)[0];return e.view.state.doc.toString();});
 assert.match(await noteText(pageA),/ALPHA-ONLY/);assert.match(await noteText(pageB),/BETA-ONLY/);assert.doesNotMatch(await noteText(pageB),/ALPHA-ONLY/);
 const panelA=await openChat(pageA),panelB=await openChat(pageB);
 // ---- conversations: made in A, absent in B
 await panelA.locator('.chat-pick-trigger').click();await panelA.getByRole('button',{name:'New',exact:true}).click();
 await pageA.waitForFunction(()=>!!document.querySelector('#chat-panel .chat-pick-trigger')?.dataset.session);
 const sessionA=await pageA.evaluate(()=>document.querySelector('#chat-panel .chat-pick-trigger').dataset.session);
 await panelB.locator('.chat-pick-trigger').click();
 const optionsB=await panelB.locator('.chat-pick-opt').evaluateAll(list=>list.map(o=>o.dataset.value));
 assert.ok(!optionsB.includes(sessionA),'B does not list A\'s conversation');assert.deepEqual(optionsB.filter(Boolean),[],'B has no conversations at all');
 await pageB.keyboard.press('Escape');
 const apiB=(p,o={})=>pageB.evaluate(async([url,init])=>{const r=await fetch(url,{credentials:'same-origin',...init});return {status:r.status,body:await r.text()};},[`/api/p/${entries.beta.id}/${p}`,{headers:{'Content-Type':'application/json','X-Aitiarch':'1'},...o}]);
 const listB=await apiB('harness/sessions?mode=chat&path=fixture.md');report.sessionListB=JSON.parse(listB.body);
 assert.deepEqual(report.sessionListB.sessions,[],'the API for B lists nothing of A');
 const review=await apiB('chat/review',{method:'PUT',body:JSON.stringify({id:'leak-1',path:'fixture.md',question:'Can I use A\'s conversation?',context:[{moduleId:'this-note',ids:['note']}],session:sessionA})});
 assert.equal(review.status,409,'B refuses a conversation id that belongs to A');report.reviewInBWithAsession=JSON.parse(review.body).error;
 // ---- a message in A reaches A's CLI with A's note; B's CLI is never started
 const composer=panelA.getByRole('textbox',{name:'Message Aitiarch AI'});await composer.fill('What does the note say?');await composer.press('Enter');
 const rv=panelA.getByRole('region',{name:'What will be sent'});await rv.waitFor();await rv.getByRole('button',{name:'Send',exact:true}).click();
 await panelA.locator('.chat-ai:not(.chat-streaming)').first().waitFor();
 const callsA=(await readFile(projects.alpha.record,'utf8')).trim().split('\n').map(l=>JSON.parse(l));
 assert.equal(callsA.length,1);assert.ok(callsA[0].addendum.includes('ALPHA-ONLY-SENTENCE'));assert.ok(!callsA[0].addendum.includes('BETA-ONLY-SENTENCE'),'A\'s CLI never got B\'s note');
 let recordB=null;try{recordB=await readFile(projects.beta.record,'utf8');}catch{/* never started: fine */}
 assert.equal(recordB,null,'B\'s CLI was never started');
 // ---- B's chat (same note name) shows nothing of A's reply, also after a reload
 await pageB.reload();await pageB.waitForSelector('.cm-editor');const panelB2=await openChat(pageB);await pageB.waitForTimeout(600);
 assert.equal(await panelB2.locator('.chat-ai').count(),0,'B shows none of A\'s replies');
 await pageA.reload();await pageA.waitForSelector('.cm-editor');const panelA2=await openChat(pageA);await panelA2.locator('.chat-ai').first().waitFor();
 assert.equal(await panelA2.locator('.chat-ai').count(),1,'A keeps its own reply');
 // ---- the CLI folders are separate
 const harnessA=await readdir(projects.alpha.harness).catch(()=>[]),harnessB=await readdir(projects.beta.harness).catch(()=>[]);
 assert.ok(harnessA.includes('sessions.json'),'A has its session index');assert.ok(!harnessB.includes('chat-cwd')||!(await readdir(path.join(projects.beta.harness,'chat-cwd'))).length,'B has no CLI working files of A');
 report.harness={alpha:harnessA.sort(),beta:harnessB.sort()};
 // ---- node settings: the persona chosen in A is not B's
 const radios=panel=>panel.locator('input[name="persona-chat"]').evaluateAll(list=>list.map(r=>({value:r.value,checked:r.checked})));
 const before=await radios(panelA2),defaultMode=before.find(r=>r.checked)?.value;assert.ok(defaultMode,'a persona is selected by default');
 const chosen=before.find(r=>!r.checked&&r.value==='grill')?.value??before.find(r=>!r.checked).value;
 await panelA2.locator(`input[name="persona-chat"][value="${chosen}"]`).check();
 const nodesOf=async(page,id)=>JSON.parse(await page.evaluate(async u=>(await fetch(u,{credentials:'same-origin'})).text(),`/api/p/${id}/nodes`)).nodes;
 for(let i=0;i<60&&JSON.stringify(await nodesOf(pageA,entries.alpha.id)).indexOf(chosen)<0;i++)await pageA.waitForTimeout(100);
 const nodesA=await nodesOf(pageA,entries.alpha.id),nodesB=await nodesOf(pageB,entries.beta.id);
 report.nodes={alpha:nodesA,beta:nodesB,defaultMode,chosen};
 assert.ok(JSON.stringify(nodesA).includes(chosen),'A saved its persona');assert.ok(!JSON.stringify(nodesB).includes(chosen),'the persona chosen in A is not in B');
 await pageB.reload();await pageB.waitForSelector('.cm-editor');const panelB3=await openChat(pageB);await panelB3.locator('input[name="persona-chat"]').first().waitFor();
 assert.equal((await radios(panelB3)).find(r=>r.checked)?.value,defaultMode,'B still has the default persona');
 await pageA.screenshot({path:path.join(output,'two-projects-a.png')});await pageB.screenshot({path:path.join(output,'two-projects-b.png')});
 // ---- nothing a page did was unscoped
 assert.deepEqual(unscoped,[],'every API call goes to the page\'s own project');
 console.log(JSON.stringify({pass:true,report,output},null,1));
}finally{
 await browser.close().catch(()=>{});await host.close().catch(()=>{});
 const target=path.resolve(base);if(target.startsWith(path.resolve(os.tmpdir()))&&path.basename(target).startsWith('aitiarch-two-projects-')){console.log('CLEANUP TARGET:',target);await rm(target,{recursive:true,force:true,maxRetries:8,retryDelay:250});}
}
