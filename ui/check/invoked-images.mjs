import './config-isolation.mjs';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,realpath,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright-core';
import {createApp} from '../server/http.ts';
import {Store} from '../server/store.ts';
import {NoteWatcher} from '../server/watch.ts';
import {UiStateStore} from '../server/ui-state-store.ts';
import {resolveProjectStorage} from '../server/project-storage.ts';
import {SessionIndex} from '../server/harness/session-index.ts';
import {ProviderRegistry,descriptorFromAdapter} from '../server/providers/registry.ts';
import {defaultMachineSetup} from '../shared/setup.ts';
import {saveMachineSetup} from '../server/setup-store.ts';

const repo=path.resolve(import.meta.dirname,'../..'),output=process.env.BATCH2A_OUTPUT;
const relative=path.relative(repo,path.resolve(output??'.'));
assert(output&&(path.isAbsolute(relative)||relative.startsWith('..'+path.sep)),'Set BATCH2A_OUTPUT outside the repo.');
await mkdir(output,{recursive:true});
const root=path.join(await mkdtemp(path.join(await realpath(os.tmpdir()),'aitiarch-invoked-images-ui-')),'.aitiarch');
assert((await resolveProjectStorage(root,{create:true})).ok);
await new UiStateStore(root).saveTour('skipped');
const quote='A unique synthetic paragraph.';
await writeFile(path.join(root,'fixture.md'),'# Image fixture\n\n'+quote+'\n');
const config=process.env.AITIARCH_CONFIG_DIR,setup=defaultMachineSetup(),model='claude-opus-4-8[1m]';
setup.providers.claude.enabled=true;
setup.providers.claude.roles.invoked={model,effort:null};
setup.providers.claude.roles['thread-reply']={model,effort:null};
setup.roles.invoked='claude';
setup.roles['thread-reply']='claude';
setup.setupSeen=true;
await saveMachineSetup(config,setup);
const adapter={id:'claude',label:'Claude',safetyLabel:'fenced',async *startTurn(){throw Error('Unexpected generic turn.');}};
const registry=new ProviderRegistry([descriptorFromAdapter(adapter,{bridges:{invoked:true,'thread-reply':true},detect:async()=>({available:true,version:'2.1.205',reason:null})})]);
const store=await Store.open(root),watcher=new NoteWatcher(store),calls=[];
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==','base64');
const app=createApp({store,watcher,distDir:path.join(repo,'ui','dist'),
 council:{adapters:[adapter],routing:()=>registry.snapshot(config),index:await SessionIndex.open(path.join(config,'sessions'))},
 provider:{name:'claude',checkAvailability:async()=>({available:true}),async invoke(request,{imageInput}){
  const {manifest,images}=imageInput.approved;
  assert.deepEqual(images.map(i=>[i.width,i.height]),[[1,1]]);
  assert.equal(request.selection,quote);
  calls.push(manifest);
  return {id:request.id,provider:'claude',model:'claude-opus-4-8',answer:'Synthetic interpretation '+calls.length+'.',
   claims:[{kind:'image',id:manifest.images[0].id,sha256:manifest.images[0].sha256,sendId:manifest.sendId,provider:'claude',model}],usage:null,costUsd:0.001};
 }},
});
let browser;
try{
 const url=`http://127.0.0.1:${await app.listen(0)}/?debug=1`;
 for(const channel of ['msedge','chrome']){try{browser=await chromium.launch({channel,headless:true});break;}catch{/* use the next installed browser */}}
 assert(browser,'An installed Edge or Chrome is required.');
 const page=await browser.newPage({viewport:{width:1280,height:900}});
 page.setDefaultTimeout(8000);
 await page.goto(url);
 await page.waitForSelector('.cm-editor');
 await page.waitForFunction(q=>{
  const entry=window.__aitiarch?.['fixture.md'];
  if(!entry)return false;
  const {view}=entry,from=view.state.doc.toString().indexOf(q),r=view.state.selection.main;
  if(r.from!==from||r.to!==from+q.length){view.dispatch({selection:{anchor:from,head:from+q.length}});return false;}
  if(!view.hasFocus){view.focus();return false;}
  return true;
 },quote);
 await page.getByRole('button',{name:'Think on this',exact:true}).click();
 const review=page.locator('.invocation-review'),attach=review.getByRole('button',{name:'Attach images'});
 await review.getByRole('button',{name:'Send to Claude',exact:true}).waitFor();
 await page.waitForFunction(()=>[...document.querySelectorAll('.invocation-review button')].some(b=>b.textContent==='Attach images'&&!b.disabled));
 const chooser=page.waitForEvent('filechooser');
 await attach.click();
 await (await chooser).setFiles({name:'fixture.png',mimeType:'image/png',buffer:png});
 await review.getByRole('img',{name:'Attached image 1'}).waitFor();
 await review.getByRole('button',{name:'Remove image 1'}).click();
 assert.equal(await review.getByRole('img',{name:'Attached image 1'}).count(),0);
 await review.evaluate((panel,data)=>{
  const dataTransfer=new DataTransfer();
  dataTransfer.items.add(new File([Uint8Array.from(atob(data),c=>c.charCodeAt(0))],'dropped.png',{type:'image/png'}));
  panel.dispatchEvent(new DragEvent('drop',{dataTransfer,bubbles:true,cancelable:true}));
 },png.toString('base64'));
 await review.getByRole('img',{name:'Attached image 1'}).waitFor();
 await review.getByRole('button',{name:'Review request'}).click();
 const consent=review.getByRole('checkbox',{name:'Confirm sending these images'}),send=review.getByRole('button',{name:'Send to Claude',exact:true});
 await consent.waitFor();
 assert(await send.isDisabled());
 assert.equal(calls.length,0);
 await review.getByText('images are sent as-is; secret exclusion cannot inspect them',{exact:true}).waitFor();
 await page.screenshot({path:path.join(output,'think-image-review.png')});
 await consent.check();
 await send.click();
 await page.getByText('Synthetic interpretation 1.',{exact:true}).first().waitFor();
 await page.getByText('interpretation of your image, not verified',{exact:true}).first().waitFor();
 await page.evaluate(async()=>{
  const saved=await (await fetch('/api/threads?path=fixture.md')).json(),id=saved.document.items[0].id;
  window.dispatchEvent(new CustomEvent('open-thread',{detail:{id,thought:true}}));
 });
 const composer=page.getByRole('textbox',{name:'Write back'});
 await composer.fill('What do you see?');
 await page.waitForFunction(()=>[...document.querySelectorAll('.thread-card button')].some(b=>b.textContent==='Attach images'&&!b.disabled));
 assert(await composer.evaluate(input=>{
  const clipboardData=new DataTransfer();
  clipboardData.setData('text/plain','Ordinary paste');
  return input.dispatchEvent(new ClipboardEvent('paste',{clipboardData,bubbles:true,cancelable:true}));
 }),'The image handler must preserve the default browser action for ordinary text paste.');
 await composer.evaluate((input,data)=>{
  const clipboardData=new DataTransfer();
  clipboardData.items.add(new File([Uint8Array.from(atob(data),c=>c.charCodeAt(0))],'pasted.png',{type:'image/png'}));
  input.dispatchEvent(new ClipboardEvent('paste',{clipboardData,bubbles:true,cancelable:true}));
 },png.toString('base64'));
 await page.locator('.thread-card').getByRole('img',{name:'Attached image 1'}).waitFor();
 await page.getByRole('button',{name:'Review reply'}).click();
 const threadReview=page.getByRole('region',{name:'Review thread request'}),threadSend=threadReview.getByRole('button',{name:'Send reply'});
 await threadSend.waitFor();
 assert(await threadSend.isDisabled());
 assert.equal(calls.length,1);
 await page.screenshot({path:path.join(output,'thread-image-review.png')});
 await threadReview.getByRole('checkbox',{name:'Confirm sending these images'}).check();
 await threadSend.click();
 await page.getByText('Synthetic interpretation 2.',{exact:true}).first().waitFor();
 assert.equal(calls.length,2);
 assert.notEqual(calls[0].sendId,calls[1].sendId);
 const ink=await readFile(path.join(root,'ink','fixture.ink.json'),'utf8');
 for(const m of calls){
  assert(!ink.includes(m.sendId));
  assert(!ink.includes(m.images[0].id));
  assert(!ink.includes(m.images[0].sha256));
 }
 await page.getByText('AI summary stays locked until you write your takeaway or skip it.').first().waitFor();
 assert.equal(await page.getByRole('textbox',{name:'Your takeaway'}).inputValue(),'');
 console.log('Think and thread image review, per-send consent, interpretation labels, and private ink boundary passed.');
}finally{
 await browser?.close();
 watcher.stop();
 await app.close();
}
