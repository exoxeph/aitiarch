import './config-isolation.mjs';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readdir,realpath,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright-core';
import {createApp} from '../server/http.ts';
import {Store} from '../server/store.ts';
import {NoteWatcher} from '../server/watch.ts';
import {UiStateStore} from '../server/ui-state-store.ts';
import {resolveProjectStorage} from '../server/project-storage.ts';
import {SessionIndex} from '../server/harness/session-index.ts';
import {descriptorFromAdapter,ProviderRegistry} from '../server/providers/registry.ts';
import {defaultMachineSetup} from '../shared/setup.ts';
import {saveMachineSetup} from '../server/setup-store.ts';

const repo=path.resolve(import.meta.dirname,'../..');
const output=process.env.BATCH2A_OUTPUT;
const relative=path.relative(repo,path.resolve(output??'.'));
assert(output&&(path.isAbsolute(relative)||relative.startsWith('..'+path.sep)),'Set BATCH2A_OUTPUT outside the repository.');
await mkdir(output,{recursive:true});
const project=await mkdtemp(path.join(await realpath(os.tmpdir()),'aitiarch-chat-images-ui-'));
const root=path.join(project,'.aitiarch');
assert((await resolveProjectStorage(root,{create:true})).ok);
await writeFile(path.join(root,'fixture.md'),'# Synthetic image review\n');
await new UiStateStore(root).saveTour('skipped');
const config=process.env.AITIARCH_CONFIG_DIR,setup=defaultMachineSetup();
setup.providers.claude.model='synthetic-vision';
setup.setupSeen=true;
await saveMachineSetup(config,setup);
const adapter={id:'claude',label:'Claude',safetyLabel:'fenced',async *startTurn(){throw Error('Unexpected generic turn.');}};
const registry=new ProviderRegistry([descriptorFromAdapter(adapter,{detect:async()=>({available:true,reason:null})})]);
const store=await Store.open(root),watcher=new NoteWatcher(store);
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==';
const metadata='SYNTHETIC_EXIF_MARKER';
const result=(request,answer)=>({id:request.id,provider:'claude',model:null,answer,rawReply:true,claims:[],usage:null});
let imageCalls=0,browser;
const app=createApp({store,watcher,distDir:path.join(repo,'ui','dist'),
 council:{adapters:[adapter],routing:()=>registry.snapshot(config),index:await SessionIndex.open(path.join(config,'sessions'))},
 provider:{name:'claude',checkAvailability:async()=>({available:true}),invoke:async request=>result(request,'Synthetic text reply.\n<claims>{"none":"no_context_used"}</claims>')},
 chatImageDelivery:{supports:(id,model)=>id==='claude'&&model==='synthetic-vision',async send({request,approved}){
  imageCalls++;
  assert.equal(approved.images.length,3);
  assert(approved.images.every(image=>image.bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))));
  assert(approved.images.every(image=>!image.bytes.includes(Buffer.from(metadata))));
  assert.deepEqual(approved.images.map(({width,height})=>[width,height]),[[1,1],[3,2],[4,3]]);
  return result(request,'Synthetic image reply.\n<claims>{"none":"no_context_used"}</claims>');
 }},
});
try{
 const url=`http://127.0.0.1:${await app.listen(0)}/`;
 for(const channel of ['msedge','chrome']){try{browser=await chromium.launch({channel,headless:true});break;}catch{/* try the next installed browser */}}
 assert(browser,'Edge or Chrome is required.');
 const page=await browser.newPage({viewport:{width:1280,height:900}});
 page.setDefaultTimeout(8000);
 await page.goto(url);
 await page.waitForSelector('.cm-editor');
 await page.getByRole('button',{name:/^Chat/}).click();
 const panel=page.locator('#chat-panel'),composer=panel.getByRole('textbox',{name:'Message Aitiarch AI'});
 const review=panel.getByRole('region',{name:'What will be sent'});
 const send=review.getByRole('button',{name:'Send to Claude',exact:true});
 const ask=async text=>{await composer.fill(text);await composer.press('Enter');};
 await ask('Enable text review bypass');
 await review.getByLabel(/ask again this session/i).check();
 await send.click();
 await panel.getByText('Synthetic text reply.',{exact:true}).waitFor();

 await page.waitForFunction(()=>document.querySelector('[aria-label="Attach images"]')?.getAttribute('aria-disabled')==='false');
 assert(await composer.evaluate(input=>{
  const data=new DataTransfer();data.setData('text/plain','ordinary text');
  return input.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
 }),'Ordinary text paste must keep its browser default.');
 await composer.evaluate((input,png)=>{
  const bytes=Uint8Array.from(atob(png),char=>char.charCodeAt(0)),data=new DataTransfer();
  data.items.add(new File([bytes],'paste.png',{type:'image/png'}));
  input.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
 },png);
 await panel.getByRole('img',{name:'Attached image 1'}).waitFor();
 const originalJpeg=await composer.evaluate(async (input,metadata)=>{
  const canvas=document.createElement('canvas');canvas.width=3;canvas.height=2;
  canvas.getContext('2d').fillRect(0,0,3,2);
  const jpeg=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg'));
  const bytes=new Uint8Array(await jpeg.arrayBuffer()),exif=new TextEncoder().encode('Exif\0\0'+metadata);
  const tagged=new Uint8Array(bytes.length+4+exif.length);
  tagged.set(bytes.subarray(0,2));tagged.set([0xff,0xe1,0,2+exif.length],2);
  tagged.set(exif,6);tagged.set(bytes.subarray(2),6+exif.length);
  const data=new DataTransfer();data.items.add(new File([tagged],'drop.jpg',{type:'image/jpeg'}));
  input.dispatchEvent(new DragEvent('drop',{dataTransfer:data,bubbles:true,cancelable:true}));
  return Array.from(tagged);
 },metadata);
 await panel.getByRole('img',{name:'Attached image 2'}).waitFor();
 const webp=await page.evaluate(async()=>{
  const canvas=document.createElement('canvas');canvas.width=4;canvas.height=3;
  canvas.getContext('2d').fillRect(0,0,4,3);
  const encoded=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp'));
  return Array.from(new Uint8Array(await encoded.arrayBuffer()));
 });
 await panel.locator('input[type=file][accept*="image/webp"]').setInputFiles({name:'picker.webp',mimeType:'image/webp',buffer:Buffer.from(webp)});
 await panel.getByRole('img',{name:'Attached image 3'}).waitFor();
 for(const original of [originalJpeg,webp]){
  const status=await page.evaluate(async data=>(await fetch('/api/chat/image-stage',{
   method:'PUT',headers:{'content-type':'application/json','x-aitiarch':'1'},body:JSON.stringify({data}),
  })).status,Buffer.from(original).toString('base64'));
  assert.equal(status,409,'Only a processed PNG can be staged by the server.');
 }
 await page.waitForFunction(()=>Array.from(document.querySelectorAll('.chat-image-list img')).every(img=>img.complete&&img.naturalWidth>0));

 for(let turn=1;turn<=2;turn++){
  await ask('Review retained images '+turn);
  const confirm=review.getByRole('checkbox',{name:'Confirm sending these images'});
  await confirm.waitFor();
  await review.getByText('images are sent as-is; secret exclusion cannot inspect them',{exact:true}).waitFor();
  assert.equal(await confirm.isChecked(),false);
  assert.equal(await send.isEnabled(),false);
  assert.equal(imageCalls,turn-1);
  if(turn===1)await page.screenshot({path:path.join(output,'chat-image-review.png')});
  await confirm.check();
  await send.click();
  await panel.getByText('interpretation of your image, not verified',{exact:true}).nth(turn-1).waitFor();
 }
 assert.equal(imageCalls,2);
 for(let index=3;index>=1;index--){
  const remove=panel.getByRole('button',{name:'Remove image '+index,exact:true});
  const deleted=page.waitForResponse(response=>response.url().endsWith('/api/chat/image-remove'));
  await remove.click();
  assert((await deleted).ok());
 }
 assert.deepEqual(await readdir(path.join(root,'local','images')),[]);
 console.log('Chat images passed: paste, drop, file picker, two distinct confirmations, and removal.');
}finally{
 await browser?.close();watcher.stop();await app.close();
}
