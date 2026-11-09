// Browser integration: synthetic fixtures and in-process fake providers only.
import assert from 'node:assert/strict';import {mkdtemp,readFile,writeFile,rm,mkdir} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';import {chromium} from 'playwright-core';
import {Store} from '../server/store.ts';import {NoteWatcher} from '../server/watch.ts';import {createApp} from '../server/http.ts';
import {InkStore} from '../server/ink-store.ts';import {captureAnchor} from '../shared/anchors.ts';import {newThread} from '../shared/threads.ts';
const here=path.dirname(fileURLToPath(import.meta.url)),root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-thread-browser-')),screens=await mkdtemp(path.join(os.tmpdir(),'aitiarch-thread-screens-'));
execFileSync('git',['init','-q'],{cwd:root,stdio:'pipe'});await writeFile(path.join(root,'.gitignore'),'/.cache/\n');
const note='# Synthetic thread check\n\nA unique selected sentence.\n\nA removable selected sentence.\n\nThe ending.\n';
await writeFile(path.join(root,'fixture.md'),'\uFEFF'+note.replace(/\n/g,'\r\n'));
const ink=await InkStore.open(root),seed=await ink.read('fixture.md'),anchor=captureAnchor(note,note.indexOf('A unique'),note.indexOf('A unique')+27);
// Stored summary exercises hidden-before-Skip without a provider call.
const item={id:'seed',kind:'answer',body:'Synthetic existing AI answer.',anchor,originalAnchor:anchor,attachment:{status:'attached',...anchor.position},generation:{requestId:'seed',action:'think',provider:'claude',model:null,status:'complete',createdAt:new Date().toISOString(),evidence:[],dismissed:false}};
item.thread=newThread(item);item.thread.summary.reply={id:'seed-summary',parentId:'seed',body:'Synthetic hidden summary.',generation:{...item.generation,requestId:'seed-summary'}};seed.document.items.push(item);
// Fixed failures for each provider use the exact stored data shape, without inference.
for(const provider of ['claude','chatgpt-plan'])for(const code of ['disabled','unavailable','hourly_cap','usage_limit','validation','interrupted','protocol']){
 const id=provider+'-'+code,failed=structuredClone(item);failed.id=id;failed.generation={...failed.generation,requestId:id,provider};failed.thread=newThread(failed);failed.thread.followups=[{id:id+'-reply',parentId:id,body:'',generation:{...failed.generation,requestId:id+'-reply',status:'error'},failure:{code}}];seed.document.items.push(failed);
}
await ink.write('fixture.md',seed.document,null);
const calls=[],pending=[];
async function waitPending(){for(let n=0;!pending.length;n++){if(n>=500)throw new Error('Fake provider did not receive the reviewed request');await new Promise(r=>setTimeout(r,20));}}
const store=await Store.open(root),watcher=new NoteWatcher(store,50,10);await watcher.start();
const app=createApp({store,watcher,distDir:path.join(here,'../dist'),provider:{name:'claude',checkAvailability:async()=>({available:true}),invoke:r=>new Promise(resolve=>{calls.push(r);pending.push(()=>resolve({id:r.id,provider:'claude',model:null,answer:'Synthetic accepted answer '+calls.length+'.',claims:[],usage:null}));})}});
let browser;
try{
 browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(8000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${await app.listen(0)}/?debug=1`);await page.waitForSelector('.cm-editor');await page.getByRole('button',{name:/^Activity/}).click();
 const panel=page.getByRole('region',{name:'Threads',exact:true});await panel.waitFor();
 const choose=async(id)=>{await panel.locator('nav button').filter({hasText:id}).click();};
 await panel.locator('nav button').first().click();
 await page.getByLabel('Your takeaway',{exact:true}).waitFor();assert.equal(await page.getByLabel('Your takeaway',{exact:true}).inputValue(),'');
 assert.equal(await page.getByText('Synthetic hidden summary.',{exact:true}).count(),0);
 await page.getByLabel('Your takeaway',{exact:true}).fill('Human half typed');
 await page.getByRole('button',{name:'Dismiss draft notice',exact:true}).click();
 assert.equal((await readFile(path.join(root,'.gitignore'),'utf8')),'/.cache/\n');
 await writeFile(path.join(root,'fixture.md'),'\uFEFFExternal edit.\r\n\r\n'+note.replace(/\n/g,'\r\n'));
 await page.waitForFunction(()=>window.__aitiarch['fixture.md'].view.state.doc.toString().startsWith('External edit.'));
 assert.equal(await page.getByLabel('Your takeaway',{exact:true}).inputValue(),'Human half typed');
 // Reopen another thread and return: memory-only draft survives selection changes.
 await panel.locator('nav button').nth(1).click();await panel.locator('nav button').first().click();
 await page.getByRole('button',{name:'Add /ui-state.json* to root .gitignore',exact:true}).click();
 await page.waitForFunction(async()=>{const s=await (await fetch('/api/thread-drafts/status')).json();return s.enabled;});
 await page.getByLabel('Your takeaway',{exact:true}).fill('Human takeaway only.');
 await page.getByRole('button',{name:'Submit my takeaway',exact:true}).click();await page.getByText('Your submitted takeaway',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Preview insertion',exact:true}).click();await page.getByRole('button',{name:'Insert my takeaway',exact:true}).click();
 await page.waitForFunction(()=>window.__aitiarch['fixture.md'].view.state.doc.toString().includes('Human takeaway only.'));
 await page.waitForFunction(()=>window.__aitiarch['fixture.md'].session.status==='saved');
 let expected='External edit.\n\n'+note;expected=expected.replace('A unique selected sentence.\n\n','A unique selected sentence.\n\nHuman takeaway only.\n\n');
 assert.equal((await readFile(path.join(root,'fixture.md'),'utf8')),'\uFEFF'+expected.replace(/\n/g,'\r\n'));
 // Undo affects only the explicit Markdown insertion, not the sidecar takeaway.
 await page.evaluate(()=>{window.__aitiarch['fixture.md'].view.focus();});await page.keyboard.press('Control+z');
 await page.waitForFunction(()=>window.__aitiarch['fixture.md'].session.status==='saved');
 assert.equal((await readFile(path.join(root,'fixture.md'),'utf8')),'\uFEFFExternal edit.\r\n\r\n'+note.replace(/\n/g,'\r\n'));
 await page.getByRole('button',{name:'Reopen takeaway',exact:true}).click();await page.getByRole('button',{name:'Skip takeaway',exact:true}).click();await page.getByText('Synthetic hidden summary.',{exact:true}).waitFor();
 await page.getByText(/^Skipped on /).waitFor();assert.equal(await page.getByLabel('Your takeaway',{exact:true}).count(),0);
 await page.getByRole('button',{name:'Dismiss thread',exact:true}).click();await page.getByRole('button',{name:'Restore thread',exact:true}).click();await page.getByText(/^Skipped on /).waitFor();await page.getByRole('button',{name:'Reopen takeaway',exact:true}).click();await page.getByLabel('Your takeaway',{exact:true}).waitFor();assert.equal(await page.getByLabel('Your takeaway',{exact:true}).inputValue(),'Human takeaway only.');
 await page.getByRole('button',{name:'Delete thread…',exact:true}).click();await page.getByRole('button',{name:'Keep thread',exact:true}).click();
 await page.getByLabel('Your takeaway',{exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:path.join(screens,'thread-wide.png'),fullPage:true});
 // Fresh Think and Ask through the real toolbar, with fake delayed answers.
 const select=async(q)=>page.evaluate(q=>{const {view}=window.__aitiarch['fixture.md'],from=view.state.doc.toString().indexOf(q);view.dispatch({selection:{anchor:from,head:from+q.length},scrollIntoView:true});view.focus();},q);
 await select('A unique selected sentence.');await page.keyboard.press('Control+Enter');await page.getByRole('button',{name:'Send to Claude',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('[data-request-status="pending"]'));pending.shift()();
 await page.getByText('Synthetic accepted answer 1.',{exact:true}).first().waitFor({state:'attached'});
 await select('A removable selected sentence.');await page.getByRole('button',{name:'Ask...',exact:true}).click();await page.getByLabel('Question for Claude').fill('Memory-only test question.');await page.getByRole('button',{name:'Review request',exact:true}).click();await page.getByRole('button',{name:'Send to Claude',exact:true}).click();
 await waitPending();
 await page.evaluate(()=>{const {view}=window.__aitiarch['fixture.md'],q='A removable selected sentence.',from=view.state.doc.toString().indexOf(q);view.dispatch({changes:{from,to:from+q.length,insert:''}});});
 pending.shift()();await page.getByRole('region',{name:'Orphaned ink'}).getByText('Synthetic accepted answer 2.',{exact:true}).waitFor();
 await page.waitForFunction(()=>window.__aitiarch['fixture.md'].session.status==='saved');
 for(let n=0;;n++){const saved=JSON.parse(await readFile(path.join(root,'ink/fixture.ink.json'),'utf8'));if(saved.items.at(-1).attachment.status==='orphaned')break;if(n>=100)throw new Error('Orphan sidecar did not finish saving');await new Promise(r=>setTimeout(r,30));}
 const parsed=JSON.parse(await readFile(path.join(root,'ink/fixture.ink.json'),'utf8'));assert(!JSON.stringify(parsed).includes('Memory-only test question.'));assert.equal(parsed.items.at(-1).attachment.status,'orphaned');
 // Re-attach the orphan to an explicit current selection; only sidecar metadata changes.
 await select('A unique selected sentence.');const candidates=page.getByRole('button',{name:/^Attach here\?/});if(await candidates.count())await candidates.first().click();else await page.getByRole('button',{name:'Re-attach to selected text',exact:true}).click();await page.getByRole('button',{name:'Save re-attachment',exact:true}).click();
 await page.waitForFunction(()=>!document.querySelector('.orphan-choices')&&document.querySelector('.orphan-list')?.textContent.includes('No orphaned ink'));
 const attached=JSON.parse(await readFile(path.join(root,'ink/fixture.ink.json'),'utf8')).items.at(-1);assert.equal(attached.attachment.status,'attached');assert(attached.anchorHistory.length>0);
 // Failure labels for both providers, including interrupted and changed formats.
 const labels=['Provider disabled.','Provider unavailable.','Hourly cap reached.','Plan usage limit reached.','Answer rejected by validation.','Request interrupted.','Provider format changed'];
 for(let n=1;n<=14;n++){await panel.locator('nav button').nth(n).click();await panel.getByText(new RegExp(labels[(n-1)%7].replaceAll('.','\\.'))).waitFor();}
 // A thread from the other provider requires one explicit directed confirmation.
 await panel.locator('nav button').nth(8).click();await page.getByLabel('Follow-up question').fill('Synthetic follow-up question.');await page.getByRole('button',{name:'Review follow-up',exact:true}).click();
 await page.getByRole('region',{name:'Review thread request'}).waitFor();assert(await page.getByRole('button',{name:'Send thread request',exact:true}).isDisabled());
 await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Send thread request',exact:true}).click();await waitPending();pending.shift()();
 await panel.locator('.extra-answers:not([open]) summary').click();await panel.getByText('Synthetic accepted answer 3.',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Skip takeaway',exact:true}).click();await page.getByRole('button',{name:'Request closing summary',exact:true}).click();
 assert.equal(await page.getByRole('checkbox').count(),0,'confirmed provider transition is not repeated');await page.getByRole('button',{name:'Send thread request',exact:true}).click();
 await waitPending();pending.shift()();await panel.getByText('Synthetic accepted answer 4.',{exact:true}).waitFor();
 assert.equal(await page.getByLabel('Your takeaway',{exact:true}).count(),0);await page.getByRole('button',{name:'Reopen takeaway',exact:true}).click();assert.equal(await page.getByLabel('Your takeaway',{exact:true}).inputValue(),'','AI replies never fill the human box');
 // A failed write retains only the validated reply and offers a save-only retry.
 await page.getByLabel('Follow-up question').fill('Synthetic save retry check.');await page.getByRole('button',{name:'Review follow-up',exact:true}).click();await page.getByRole('button',{name:'Send thread request',exact:true}).click();await waitPending();
 const lockFile=path.join(root,'ink/fixture.ink.json.lock');for(let n=0;;n++){try{await writeFile(lockFile,'Synthetic lock',{flag:'wx'});break;}catch(e){if(e.code!=='EEXIST'||n>=100)throw e;await new Promise(r=>setTimeout(r,20));}}
 pending.shift()();await page.getByRole('button',{name:'Retry saving reply (no new call)',exact:true}).waitFor();await rm(lockFile);await page.getByRole('button',{name:'Retry saving reply (no new call)',exact:true}).click();if(await panel.locator('.extra-answers:not([open]) summary').count())await panel.locator('.extra-answers:not([open]) summary').click();await panel.getByText('Synthetic accepted answer 5.',{exact:true}).waitFor();assert.equal(calls.length,5);
 await page.reload();await page.waitForSelector('.cm-editor');await page.getByRole('button',{name:/^Activity/}).click();await panel.locator('nav button').first().click();
 await page.getByText('Question text was kept in memory only and is unavailable after reload.',{exact:true}).first().waitFor();await page.waitForFunction(()=>document.querySelector('textarea[aria-label="Your takeaway"]')?.value==='Human takeaway only.');
 await page.setViewportSize({width:620,height:900});await page.getByLabel('Your takeaway',{exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:path.join(screens,'thread-narrow.png'),fullPage:true});
 await page.getByRole('button',{name:'Delete thread…',exact:true}).click();await page.getByRole('button',{name:'Confirm delete thread',exact:true}).click();
 await page.waitForFunction(()=>!document.querySelector('[data-thread-id="seed"]'));
 assert(!JSON.parse(await readFile(path.join(root,'ink/fixture.ink.json'),'utf8')).items.some(i=>i.id==='seed'));
 assert.equal(errors.length,0,'browser errors');console.log(JSON.stringify({pass:true,calls:calls.length,provider:'fake only',screenshots:screens,checks:['empty box','summary hidden','memory drafts','explicit ignore','external edit during draft','submit','preview insert','BOM/CRLF','undo','Skip reveals','dismiss/restore','delete confirm','Think','Ask','orphan re-attach/history','provider-change confirm once','follow-up','closing summary','save-only retry','14 provider failure states','reload placeholder','draft reload','narrow layout']}));
}catch(e){console.error(JSON.stringify({checkFailure:true,screenshots:screens}));if(browser){for(const context of browser.contexts())for(const page of context.pages()){console.error(await page.locator('[role="alert"]').allTextContents());await page.screenshot({path:path.join(screens,'failure.png'),fullPage:true});}}throw e;
}finally{for(const complete of pending.splice(0))complete();await browser?.close();watcher.stop();await app.close();await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
