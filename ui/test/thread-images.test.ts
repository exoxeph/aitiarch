import {mkdtemp,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {expect,it,vi} from 'vitest';
import {Store} from '../server/store.ts';
import {InkStore} from '../server/ink-store.ts';
import {ThreadStore} from '../server/thread-store.ts';
import {ThreadRuntime} from '../server/thread-runtime.ts';
import {UiStateStore} from '../server/ui-state-store.ts';
import {ImageStore} from '../server/image-store.ts';
import {resolveProjectStorage} from '../server/project-storage.ts';
import {ProviderRegistry,descriptorFromAdapter} from '../server/providers/registry.ts';
import {createInvokedCodexBridge} from '../server/providers/invoked-bridge.ts';
import type {Provider} from '../server/providers/index.ts';
import type {TurnAdapter} from '../server/providers/turn.ts';
import {captureAnchor} from '../shared/anchors.ts';
import {defaultMachineSetup} from '../shared/setup.ts';
import type {ConfirmedImageSend} from '../shared/image-attachments.ts';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==','base64');
it.each(['claude','codex'] as const)('requires independent consent for each %s follow-up without persisting its image manifest',async id=>{
 const tmp=await mkdtemp(path.join(os.tmpdir(),'aitiarch-thread-images-')),root=path.join(tmp,'.aitiarch'),config=await mkdtemp(path.join(tmp,'config-'));
 expect((await resolveProjectStorage(root,{create:true})).ok).toBe(true);
 const note='The queue is bounded.\n',quote=note.trim(),file='fixture.md';
 await writeFile(path.join(root,file),note);
 const store=await Store.open(root),ink=await InkStore.open(root),threads=new ThreadStore(ink,new UiStateStore(root)),images=new ImageStore(root);
 const staged=await images.stage(png),s=await ink.read(file),anchor=captureAnchor(note,0,quote.length);
 s.document.items.push({id:'t1',kind:'answer',body:'Synthetic initial answer.',anchor,originalAnchor:anchor,attachment:{status:'attached',from:0,to:quote.length},
  generation:{requestId:'t1',action:'think',provider:'claude',model:null,createdAt:new Date().toISOString(),status:'complete',evidence:[],dismissed:false}});
 await ink.write(file,s.document,null);
 const model=id==='claude'?'claude-opus-4-8[1m]':'gpt-6.2-sol',version=id==='claude'?'2.1.205':'0.170.0';
 const ready=async()=>({available:true as const});
 const result=vi.fn((m:ConfirmedImageSend)=>({answer:'Synthetic image interpretation.',claims:[
  {kind:'image',id:staged.id,sha256:m.images[0].sha256,sendId:m.sendId,provider:id,model}
 ]}));
 const adapter:TurnAdapter={id,label:id,safetyLabel:id==='claude'?'fenced':'contained',async *startTurn(){throw Error('Unexpected text-only turn.');},
  async *startImageTurn(_input,_signal,delivery){expect(delivery.approved.images[0].bytes).toEqual(png);yield {type:'complete',answer:JSON.stringify(result(delivery.approved.manifest))};}};
 const descriptor=descriptorFromAdapter(adapter,{detect:async()=>({available:true,reason:null,version}),bridges:{'thread-reply':true},...(id==='codex'?{
  threadReplyBridge:options=>createInvokedCodexBridge({...options,adapter,checkAvailability:ready})
 }:{})});
 const registry=new ProviderRegistry([descriptor]),setup=defaultMachineSetup();
 setup.providers[id].enabled=true;setup.providers[id].model=model;setup.roles['thread-reply']=id;
 const provider:Provider={name:'claude',checkAvailability:ready,invoke:async (request,options)=>{
  if(id!=='claude'||!options?.imageInput)throw Error('Unexpected Claude turn.');
  expect(options.imageInput.approved.images[0].bytes).toEqual(png);
  return {id:request.id,provider:'claude',model:null,usage:null,...result(options.imageInput.approved.manifest)};
 }};
 const runtime=new ThreadRuntime(store,threads,provider,undefined,undefined,()=>registry.snapshot(config,async()=>structuredClone(setup)),images);
 const input={path:file,id:'t1',replyId:'r1',parentId:'t1',inkVersion:(await ink.read(file)).version,purpose:'followup' as const,question:'What is visible?',imageIds:[staged.id],confirmed:true};
 const preview=await runtime.preview(input);
 expect(preview.review).toMatchObject({provider:id,images:{provider:id,images:[{id:staged.id}]}});
 const send={...input,reviewId:preview.review!.id,noteVersion:preview.noteVersion};
 await expect(runtime.start(send)).rejects.toThrow(/Confirm the reviewed images/);
 if(id==='codex')await expect(runtime.start({...send,confirmImages:true,confirmed:false})).rejects.toThrow(/different provider/);
 expect(result).not.toHaveBeenCalled();
 await runtime.start({...send,confirmImages:true});
 await runtime.wait(input.replyId);
 const item=(await (await InkStore.open(root)).read(file)).document.items[0];
 expect(item.thread).toMatchObject({takeaway:{state:'untouched'},summary:{revealedAt:null},followups:[{body:'Synthetic image interpretation.',generation:{status:'complete',provider:id,imageInterpretation:true,evidence:[]}}]});
 expect(JSON.stringify({item,ledger:await threads.ledger.read()})).not.toContain(staged.id);
 const next={...input,replyId:'r2',parentId:'r1',inkVersion:(await ink.read(file)).version};
 const nextPreview=await runtime.preview(next);
 await expect(runtime.start({...next,reviewId:nextPreview.review!.id})).rejects.toThrow(/Confirm the reviewed images/);
 expect(result).toHaveBeenCalledTimes(1);
 await expect(runtime.preview({...next,purpose:'summary'})).rejects.toThrow(/Invalid image attachments/);

 const human=await threads.act(file,'t1',next.inkVersion,{type:'submit',text:'Human-owned conclusion.'});
 await runtime.start({...next,inkVersion:human.version,reviewId:nextPreview.review!.id,confirmImages:true});
 runtime.cancel('r2');
 await runtime.wait('r2');
 const cancelled=await ink.read(file);
 expect(cancelled.document.items[0].thread).toMatchObject({takeaway:{state:'submitted',text:'Human-owned conclusion.'},
  followups:[{}, {body:'',generation:{status:'cancelled'}}]});
 const missing={...next,replyId:'r3',inkVersion:cancelled.version};
 const missingPreview=await runtime.preview(missing);
 await images.discard(staged.id);
 await expect(runtime.start({...missing,reviewId:missingPreview.review!.id,confirmImages:true})).rejects.toThrow(/attach them again/);
 expect((await ink.read(file)).document.items[0].thread).toMatchObject({takeaway:{state:'submitted',text:'Human-owned conclusion.'}});
});
