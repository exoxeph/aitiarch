import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {expect,it,vi} from 'vitest';
import {Assistance} from '../server/assistance.ts';
import {Store} from '../server/store.ts';
import {InkStore} from '../server/ink-store.ts';
import {ImageStore} from '../server/image-store.ts';
import {CodexSkillConsent} from '../server/providers/codex-skills.ts';
import {resolveProjectStorage} from '../server/project-storage.ts';
import {ProviderRegistry,descriptorFromAdapter,type InvokedBridgeFactory} from '../server/providers/registry.ts';
import {createInvokedCodexBridge} from '../server/providers/invoked-bridge.ts';
import {defaultMachineSetup} from '../shared/setup.ts';
import type {Provider,Request,InvokeOptions} from '../server/providers/index.ts';
import {createProvider} from '../server/providers/index.ts';
import {createCliAdapter,CODEX_FLAGS} from '../server/providers/tool-less.ts';
import type {TurnAdapter} from '../server/providers/turn.ts';
import type {Invocation} from '../shared/invocation.ts';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==','base64');
const note='# Synthetic\n\nThe selected line is frozen.\n\nAnother line.\n';
const quote='The selected line is frozen.';
const ready=async()=>({available:true as const});
async function fixture(id:'claude'|'codex',action:'think'|'ask',mode:'invalid'|'echo'|'refusal'|'cli'|'fake'='fake',withSkill=false){
 const temp=await mkdtemp(path.join(os.tmpdir(),'aitiarch-invoked-images-'));
 const root=path.join(temp,'.aitiarch'),config=await mkdtemp(path.join(temp,'config-'));
 expect((await resolveProjectStorage(root,{create:true})).ok).toBe(true);
 await writeFile(path.join(root,'fixture.md'),note);
 const images=new ImageStore(root),staged=await images.stage(png);
 const setup=defaultMachineSetup();
 const model=id==='claude'?'claude-opus-4-8[1m]':'gpt-6.2-sol';
 setup.roles.invoked=id;
 setup.providers[id].enabled=true;
 setup.providers[id].model=model;
 const calls:string[]=[],record=path.join(temp,'argv.json');
 const cli={command:process.execPath,prefixArgs:[path.resolve('test/fixtures/image-transport-cli.mjs'),id,'record-invoked',record]};
 const result=(manifest:{sendId:string;images:readonly {id:string;sha256:string}[]})=>({
  answer:mode==='echo'?manifest.images[0].id:'Synthetic image interpretation.',
  claims:[{kind:'image',id:manifest.images[0].id,sha256:mode==='invalid'?'0'.repeat(64):manifest.images[0].sha256,sendId:manifest.sendId,provider:id,model},{sourceId:'N1',quote}],
 });
 const adapter:TurnAdapter=mode==='cli'&&id==='codex'?createCliAdapter({...cli,id}):{id,label:id,safetyLabel:id==='claude'?'fenced':'contained',async *startTurn(){throw Error('Text fallback was attempted.');},
  async *startImageTurn(input,_signal,imageInput){
   calls.push(input.question);
   expect(imageInput.approved.images[0].bytes).toEqual(png);
   if(mode==='refusal')yield {type:'refusal',code:'refusal'};
   yield {type:'complete',answer:JSON.stringify(result(imageInput.approved.manifest))};
  }};
 const descriptor=descriptorFromAdapter(adapter,{detect:async()=>({available:true,reason:null,version:id==='claude'?'2.1.205':'0.170.0'}),
  bridges:{invoked:true},...(id==='codex'?{invokedBridge:(options:Parameters<InvokedBridgeFactory>[0])=>createInvokedCodexBridge({...options,adapter,checkAvailability:ready})}:{})});
 const registry=new ProviderRegistry([descriptor]);
 const provider:Provider=mode==='cli'&&id==='claude'?createProvider({...cli,provider:id,contract:'claude-canary-2.1.205'}):{name:'claude',checkAvailability:ready,invoke:vi.fn(async(request:Request,options?:InvokeOptions)=>{
  if(id!=='claude'||!options?.imageInput)throw Error('Unexpected Claude request');
  calls.push(request.selection);
  expect(options.imageInput.approved.images[0].bytes).toEqual(png);
  return {id:request.id,provider:'claude' as const,model:null,usage:null,...result(options.imageInput.approved.manifest)};
 })};
 const store=await Store.open(root),ink=await InkStore.open(root);
 const skillRoot=path.join(temp,'skills'),consent=new CodexSkillConsent(root,[skillRoot]);
 if(withSkill){
  const dir=path.join(skillRoot,'example');
  await mkdir(dir,{recursive:true});
  await writeFile(path.join(dir,'SKILL.md'),'---\nname: example\ndescription: Synthetic skill\nclassification: read-only\n---\nDescribe the image briefly.');
  const [entry]=await consent.inventory();
  await consent.approve('invoked',entry.pathHash,entry.contentHash!);
 }
 const service=new Assistance(store,ink,provider,undefined,{write:async()=>{}},undefined,()=>registry.snapshot(config,async()=>structuredClone(setup)),images,withSkill?consent:undefined);
 const input:Invocation&{imageIds:string[]}={id:'synthetic-invoke',path:'fixture.md',action,question:action==='ask'?'What shape is visible?':'',
  text:note,from:note.indexOf(quote),to:note.indexOf(quote)+quote.length,imageIds:[staged.id]};
 return {root,ink,service,input,staged,calls,setup,record};
}

it.each([['claude','think'],['codex','ask']] as const)('reviews and sends frozen %s %s images one time, without storing attachment metadata',async(id,action)=>{
 const f=await fixture(id,action);
 const packet=await f.service.preview(f.input);
 expect(packet.data.selection).toBe(quote);
 expect(packet.review).toMatchObject({provider:id,images:{provider:id,images:[{id:f.staged.id}]}});
 const request={...f.input,reviewId:packet.review!.id};
 await expect(f.service.start(request)).rejects.toThrow(/Confirm/);
 await writeFile(path.join(f.root,'fixture.md'),'A rewritten note with no matching anchor.\n');
 await f.service.start({...request,confirmImages:true} as Invocation);
 await f.service.wait(f.input.id);
 const item=(await f.ink.read(f.input.path)).document.items[0];
 expect(item).toMatchObject({body:'Synthetic image interpretation.',originalAnchor:{quote},
  attachment:{status:'orphaned'},generation:{status:'complete',imageInterpretation:true,evidence:[{sourceId:'N1',quote}]}});
 expect(f.calls).toHaveLength(1);
 const saved=JSON.stringify({item,ledger:await f.service.ledger.read()});
 expect(saved).not.toContain(f.staged.id);
 expect(saved).not.toContain(png.toString('base64'));
});

it('sends Codex images and reviewed instructions together only after both confirmations',async()=>{
 const f=await fixture('codex','ask','fake',true);
 const packet=await f.service.preview(f.input);
 expect(packet.review?.codexSkills).toEqual([expect.objectContaining({name:'example',classification:'read-only'})]);
 expect(packet.review?.images?.images).toHaveLength(1);
 const request={...f.input,reviewId:packet.review!.id};
 await expect(f.service.start({...request,confirmSkills:true})).rejects.toThrow(/Confirm the reviewed images/);
 await expect(f.service.start({...request,confirmImages:true})).rejects.toThrow(/Confirm the reviewed Codex skills/);
 await f.service.start({...request,confirmImages:true,confirmSkills:true});
 await f.service.wait(f.input.id);
 expect(f.calls).toHaveLength(1);
 expect(f.calls[0]).toContain('Describe the image briefly.');
 const [item]=(await f.ink.read(f.input.path)).document.items;
 expect(item.generation).toMatchObject({status:'complete',imageInterpretation:true});
 expect(item.generation?.skills).toBeUndefined();
});

it.each(['invalid','echo'] as const)('fails closed on changed settings and an %s image response',async mode=>{
 const f=await fixture('claude','ask',mode);
 const packet=await f.service.preview(f.input);
 const request={...f.input,reviewId:packet.review!.id,confirmImages:true};
 f.setup.providers.claude.model='different';
 await expect(f.service.start(request)).rejects.toThrow(/Review again/);
 expect(f.calls).toHaveLength(0);
 f.setup.providers.claude.model='claude-opus-4-8[1m]';
 await f.service.start(request);
 await f.service.wait(f.input.id);
 expect((await f.ink.read(f.input.path)).document.items[0]).toMatchObject({generation:{status:'error',evidence:[]}});
});

it('rejects a Codex refusal even when a valid image answer follows',async()=>{
 const f=await fixture('codex','think','refusal');
 const packet=await f.service.preview(f.input);
 await f.service.start({...f.input,reviewId:packet.review!.id,confirmImages:true});
 await f.service.wait(f.input.id);
 const [item]=(await f.ink.read(f.input.path)).document.items;
 expect(item.generation).toMatchObject({status:'error',evidence:[]});
 expect(item.body).not.toContain('Synthetic image interpretation.');
});

it.each([['claude','think'],['claude','ask'],['codex','think'],['codex','ask']] as const)('sends %s %s images through the real launcher with a synthetic CLI',async(id,action)=>{
 const f=await fixture(id,action,'cli',id==='codex');
 const packet=await f.service.preview(f.input);
 await f.service.start({...f.input,reviewId:packet.review!.id,confirmImages:true,confirmSkills:id==='codex'});
 await f.service.wait(f.input.id);
 const item=(await f.ink.read(f.input.path)).document.items[0];
 expect(item).toMatchObject({body:'Synthetic image interpretation.',generation:{status:'complete',imageInterpretation:true,evidence:[]}});
 const {argv,bytes}=JSON.parse(await readFile(f.record,'utf8'));
 expect(Buffer.from(bytes,'base64')).toEqual(png);
 if(id==='codex'){
  expect(argv.slice(0,CODEX_FLAGS.length)).toEqual(CODEX_FLAGS);
  expect(argv).toContain('--image');
  expect(argv).toContain('gpt-6.2-sol');
 }else{
  expect(argv[argv.indexOf('--input-format')+1]).toBe('stream-json');
  expect(argv[argv.indexOf('--tools')+1]).toBe('');
 }
});
