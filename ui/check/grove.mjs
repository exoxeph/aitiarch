// Product screenshots with synthetic fixtures only. No real providers or credentials.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,readdir} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';import {gzipSync} from 'node:zlib';
import {chromium} from 'playwright-core';
import {Store} from '../server/store.ts';import {NoteWatcher} from '../server/watch.ts';import {createApp} from '../server/http.ts';
import {InkStore} from '../server/ink-store.ts';import {captureAnchor} from '../shared/anchors.ts';import {newThread} from '../shared/threads.ts';
const output=process.env.GROVE_OUTPUT;if(!output)throw Error('Set GROVE_OUTPUT outside the repo.');
const ui=fileURLToPath(new URL('../',import.meta.url)),repo=path.resolve(ui,'..');
const outsideRepo=p=>{const resolved=path.resolve(p).toLowerCase(),base=repo.toLowerCase();assert(resolved!==base&&!resolved.startsWith(base+path.sep),'Artifacts must stay outside the repository');};
outsideRepo(output);
const phase=process.argv[2]??'after';assert(['before','after','interim'].includes(phase),'Unknown screenshot phase');
const screens=path.resolve(output,phase);outsideRepo(screens);await mkdir(screens,{recursive:true});
const baselineCss=phase==='before'?execFileSync('git',['show','dacaaed:ui/src/styles.css'],{cwd:repo,encoding:'utf8'}):null;
const root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-grove-'));
execFileSync('git',['init','-q'],{cwd:root,stdio:'pipe'});await writeFile(path.join(root,'.gitignore'),'/.cache/\n/ui-state.json*\n');
const selection='We will use one shared queue for the first demo.';
const note='# A useful first demo\n\nPocket Queue helps a neighborhood tool library keep track of repairs.\n\n## Start small\n\n'+selection+'\n\nVolunteers can add a request and move it from waiting to fixing to ready. Accounts and notifications can wait.\n\nA trial with two volunteers is planned before wider use.\n';
const bytes=Buffer.from('\uFEFF'+note.replaceAll('\n','\r\n'));const ink=await InkStore.open(root);
const names=['empty','thread','takeaway-pending','takeaway-done','skipped','orphan','provider-failure','settings','usage'];
for(const name of names){
 await writeFile(path.join(root,name+'.md'),name==='empty'?Buffer.from('\uFEFF'):bytes);
 if(['empty','settings','usage'].includes(name))continue;
 const from=note.indexOf(selection),anchor=captureAnchor(note,from,from+selection.length);
 const item={id:name,kind:'answer',body:'The note proposes a shared queue. Test that both volunteers can see the same requests before adding accounts.',anchor,originalAnchor:anchor,attachment:{status:'attached',...anchor.position},generation:{requestId:name,action:'think',provider:'claude',model:null,status:'complete',createdAt:'2026-11-08T10:00:00Z',evidence:[],dismissed:false}};
 item.thread=newThread(item);item.thread.summary.reply={id:name+'-summary',parentId:name,body:'Synthetic AI closing summary after the human action.',generation:{...item.generation,requestId:name+'-summary'}};
 if(name==='takeaway-done'){item.thread.takeaway={events:[{action:'submit',at:'2026-11-08T10:01:00Z',text:'I will test the shared queue with two volunteers.'}],state:'submitted',text:'I will test the shared queue with two volunteers.',updatedAt:'2026-11-08T10:01:00Z'};}
 if(name==='skipped'){item.thread.takeaway={events:[{action:'skip',at:'2026-11-08T10:01:00Z',text:null}],state:'skipped',text:null,updatedAt:'2026-11-08T10:01:00Z'};}
 if(name==='orphan'){const old='A removed paragraph about the obsolete pilot.';const a=captureAnchor(old,0,old.length);item.anchor=a;item.originalAnchor=a;item.attachment={status:'orphaned',reason:'missing'};}
 if(name==='provider-failure'){item.thread.followups=[{id:'failed-reply',parentId:name,body:'',generation:{...item.generation,requestId:'failed-reply',status:'error'},failure:{code:'protocol'}}];}
 const s=await ink.read(name+'.md');s.document.items.push(item);await ink.write(name+'.md',s.document,null);
}
const store=await Store.open(root),watcher=new NoteWatcher(store,50,10);await watcher.start();
let calls=0;const app=createApp({store,watcher,distDir:path.join(ui,'dist'),provider:{name:'claude',checkAvailability:async()=>({available:true}),invoke:async()=>{calls++;throw Error('Screenshots must not invoke a provider');}}});
let browser;const checks=[],external=[],errors=[],contrasts=[];
try{
 const base=`http://127.0.0.1:${await app.listen(0)}`;browser=await chromium.launch({channel:'msedge',headless:true});
 for(const theme of ['ember','moss'])for(const width of [1440,620]){
  const page=await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'});page.setDefaultTimeout(12000);
  page.on('pageerror',e=>errors.push(e.message));
  let state='';await page.route('**/*',async route=>{const url=new URL(route.request().url());if(url.origin!==base){external.push(url.origin);return route.abort();}
   if(baselineCss&&url.pathname.endsWith('.css'))return route.fulfill({contentType:'text/css',body:baselineCss});
   if(url.pathname==='/api/chatgpt-plan')return route.fulfill({json:state==='settings'?{enabled:true,connected:false,hourlyCap:2,welcome:false}:{enabled:false,hourlyCap:2}});
   if(url.pathname==='/api/usage')return route.fulfill({json:{providers:['claude','chatgpt-plan'].map(provider=>({provider,calls:2,callsThisSession:2,input:180,cached:1400,output:210,reasoning:0,wallMs:1400,unreportedCalls:0})),hourlyCap:2}});
   return route.continue();});
  // Thoughts open from their blob; a check opens one by id (the same event the blob's open button sends).
 const openThought=async note=>{const id=await page.evaluate(async n=>{const s=await (await fetch('/api/threads?path='+encodeURIComponent(n))).json();return s.document.items.find(i=>i.generation)?.id;},note+'.md');await page.evaluate(id=>window.dispatchEvent(new CustomEvent('open-thread',{detail:{id,thought:true}})),id);await page.locator('.thread-card').waitFor();};
 const openNote=async name=>{await page.setViewportSize({width:1440,height:1000});state=name;await page.goto(base+'/?debug=1');await page.evaluate(t=>{document.documentElement.dataset.theme=t;},theme); await page.getByRole('button',{name:'Notes menu',exact:true}).click();await page.locator('#note-tree[data-state="open"]').waitFor();await page.locator('[role="treeitem"][data-type="file"]').filter({hasText:new RegExp('^'+name+'$')}).click();await page.waitForFunction(p=>document.querySelector('.editor-col')?.getAttribute('data-note-path')===p&&window.__aitiarch?.[p]?.view.dom.getClientRects().length>0,name+'.md');};
  for(const name of names){await openNote(name);await page.setViewportSize({width,height:1000});
   if(!['empty','settings','usage'].includes(name)){await openThought(name);}
   if(['thread','takeaway-pending','orphan','provider-failure'].includes(name)){assert.equal(await page.getByLabel('Your takeaway',{exact:true}).inputValue(),'');assert.equal(await page.getByText('Synthetic AI closing summary after the human action.',{exact:true}).count(),0);}
   if(name==='usage'){await page.getByRole('button',{name:'Notes menu',exact:true}).click();await page.locator('#note-tree').getByText('My AI calls and tokens',{exact:true}).click();}
   if(name==='settings'){await page.getByRole('button',{name:'Notes menu',exact:true}).click();await page.locator('#note-tree').getByText('Settings',{exact:true}).click();await page.getByRole('region',{name:'ChatGPT plan connection'}).waitFor();}
   if(name==='thread'){
    await page.evaluate(q=>{const d=window.__aitiarch['thread.md'].view,from=d.state.doc.toString().indexOf(q);d.dispatch({selection:{anchor:from,head:from+q.length},scrollIntoView:true});d.focus();},selection);
    const toolbar=page.getByRole('toolbar',{name:'Format selection'});await toolbar.waitFor();await page.waitForTimeout(100);
    const bounds=await toolbar.evaluate(el=>{const r=el.getBoundingClientRect();return {opaque:getComputedStyle(el).backgroundColor!=='rgba(0, 0, 0, 0)',inside:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight};});assert(bounds.opaque&&bounds.inside);
    await page.screenshot({path:path.join(screens,`toolbar-${theme}-${width}.png`)});
   }
   if(phase==='after'){
    const metrics=await page.evaluate(()=>{
     const rgb=s=>s.match(/[\d.]+/g)?.map(Number),hex=c=>'#'+c.slice(0,3).map(v=>Math.round(v).toString(16).padStart(2,'0')).join('');
     const lum=c=>c.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
     const result=[];for(const el of document.querySelectorAll('.cm-content,.cm-ink-body,.cm-ink-label,.ai-answer,.thread-reply>.small,.human-takeaway label,.question-placeholder,.usage-panel p,.usage-panel th,.usage-panel td,.notice,.props,.prop dt,.ex-row[aria-selected="true"],.cm-sel-toolbar button,a,.skipped-takeaway')){
      if(!el.getClientRects().length||el.closest(':disabled'))continue;const fg=rgb(getComputedStyle(el).color);let parent=el,bg;
      while(parent){const c=rgb(getComputedStyle(parent).backgroundColor);if(c&&(c.length<4||c[3]===1)){bg=c;break;}parent=parent.parentElement;}
      if(fg&&bg){const a=lum(fg),b=lum(bg);result.push({selector:el.className||el.tagName,foreground:hex(fg),background:hex(bg),ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)});}
     }
     const editor=document.querySelector('.cm-editor:not(.surface-hidden .cm-editor) .cm-content');
     const human=document.querySelector('.human-takeaway');
     return {contrasts:result,inset:editor?parseFloat(getComputedStyle(editor).paddingLeft):null,humanBorder:human?getComputedStyle(human).borderTopWidth:null};
    });
    for(const c of metrics.contrasts){assert(c.ratio>=4.5,JSON.stringify({theme,width,name,...c}));contrasts.push({theme,...c});}
    assert(metrics.inset>=20,'CodeMirror must preserve the page inset');if(metrics.humanBorder)assert.equal(metrics.humanBorder,'2px');
    const motion=await page.locator('.topbar button').first().evaluate(el=>getComputedStyle(el).transitionDuration);assert.equal(motion,'0s');
    await page.keyboard.press('Escape');await page.locator('.topbar button').first().focus();await page.keyboard.press('Tab');
    const focus=await page.evaluate(()=>{const el=document.activeElement,s=getComputedStyle(el);return !el.matches(':focus-visible')||s.outlineStyle!=='none'||el.classList.contains('cm-content');});assert(focus,'keyboard focus must remain visible');
   }
   await page.waitForTimeout(100);await page.screenshot({path:path.join(screens,`${name}-${theme}-${width}.png`),fullPage:true});
   if(!['empty','settings','usage','thread'].includes(name)){await openThought(name); // the full-page screenshot above resizes the window and can collapse the open conversation
   const target=name==='skipped'?page.locator('.skipped-takeaway'):page.getByLabel('Your takeaway',{exact:true});await target.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(screens,`${name}-detail-${theme}-${width}.png`)});}
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'horizontal page overflow');checks.push({name,theme,width,passed:true});
  }
  // Narrowest phone width also preserves toolbar and page bounds.
  await openNote('thread');await openThought('thread');await page.setViewportSize({width:375,height:812});
  await page.evaluate(q=>{const d=window.__aitiarch['thread.md'].view,from=d.state.doc.toString().indexOf(q);d.dispatch({selection:{anchor:from,head:from+q.length},scrollIntoView:true});d.focus();},selection);
  const phoneToolbar=page.getByRole('toolbar',{name:'Format selection'});await phoneToolbar.waitFor();await page.waitForTimeout(100);
  assert(await phoneToolbar.evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;}),'phone toolbar outside viewport');
  assert.equal(await page.getByLabel('Your takeaway',{exact:true}).inputValue(),'');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(screens,`phone-${theme}-${width}.png`)});
  await page.close();
 }
 assert.equal(calls,0);assert.equal(external.length,0);assert.deepEqual(errors,[]);
 for(const name of names)assert.deepEqual(await readFile(path.join(root,name+'.md')),name==='empty'?Buffer.from('\uFEFF'):bytes);
 const assets=await readdir(path.join(ui,'dist/assets'));const bundle={};for(const ext of ['.js','.css']){const bufs=await Promise.all(assets.filter(f=>f.endsWith(ext)).map(f=>readFile(path.join(ui,'dist/assets',f))));bundle[ext]={files:bufs.length,bytes:bufs.reduce((a,b)=>a+b.length,0),gzipBytes:bufs.reduce((a,b)=>a+gzipSync(b).length,0)};}
 // Preserve the measured original build size when recapturing baseline states with its stylesheet.
 if(phase==='before'){const previous=await readFile(path.join(output,'before-checks.json'),'utf8').catch(e=>{if(e.code==='ENOENT')return null;throw e;});if(previous)Object.assign(bundle,JSON.parse(previous).bundle);}
 const lowest=contrasts.sort((a,b)=>a.ratio-b.ratio)[0]??null;
 await writeFile(path.join(output,`${phase}-checks.json`),JSON.stringify({checks,bundle,contrastPairs:contrasts.length,lowest,providerCalls:calls,externalRequests:external.length,markdownByteExact:true},null,2));console.log(JSON.stringify({passed:true,states:checks.length,bundle,contrastPairs:contrasts.length,lowest,screens}));
}finally{await browser?.close();watcher.stop();await app.close();await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
