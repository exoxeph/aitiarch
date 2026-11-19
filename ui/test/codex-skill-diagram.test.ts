import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach,expect,it,vi} from 'vitest';
import {Assistance} from '../server/assistance.ts';
import {initProject} from '../server/init.ts';
import {Store} from '../server/store.ts';
import {InkStore} from '../server/ink-store.ts';
import {VISUALIZE_QUESTION} from '../shared/diagram.ts';
import {InsertionStore} from '../server/insertion-store.ts';
import {createInvokedCodexBridge} from '../server/providers/invoked-bridge.ts';
import {compatibleDefaults,descriptorFromAdapter,ProviderRegistry} from '../server/providers/registry.ts';
import type {ModelCatalog} from '../shared/models.ts';
import {createCliAdapter,CODEX_FLAGS} from '../server/providers/tool-less.ts';

afterEach(()=>vi.unstubAllEnvs());
const note='# Synthetic\n\nThe queue is bounded.\n';
const encoded=(text:string)=>Buffer.from('\uFEFF'+text.replaceAll('\n','\r\n'));
const rect='<rect x="1" y="1" width="8" height="8" fill="blue"/>';
const svg=(body=rect)=>'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">'+body+'</svg>';
async function fixture(drawing=svg(),kind='answer'){
 const project=await mkdtemp(path.join(os.tmpdir(),'aitiarch-codex-diagram-'));
 vi.stubEnv('AITIARCH_CONFIG_DIR',await mkdtemp(path.join(os.tmpdir(),'aitiarch-codex-diagram-config-')));
 await initProject({project,sharing:'private',confirmIgnore:false});
 const root=path.join(project,'.aitiarch'),file=path.join(root,'fixture.md');
 await writeFile(file,encoded(note));
 const config=path.join(project,'fixture.json'),record=path.join(project,'turn.json');
 await writeFile(config,JSON.stringify({drawing,kind}));
 const catalog:ModelCatalog={source:'cli',checkedAt:Date.now(),models:[{id:'synthetic-codex',name:'Synthetic Codex',default:true,efforts:['medium']}]};
 const adapter=createCliAdapter({id:'codex',command:process.execPath,prefixArgs:[path.resolve('test/fixtures/skill-codex-cli.mjs'),config,record],codexCatalog:()=>({version:'0.167.0',catalog})});
 const detect=vi.fn(async()=>({available:true,reason:null as string|null,version:'0.167.0'}));
 const descriptor=descriptorFromAdapter(adapter,{detect,skillDiagramBridge:options=>createInvokedCodexBridge({
  ...options,adapter,checkAvailability:async()=>({available:true}),profile:'skill-diagram',
 })});
 const claude=descriptorFromAdapter({...adapter,id:'claude',label:'Claude'},{detect,bridges:{'skill-diagram':true}});
 const kiro=descriptorFromAdapter({...adapter,id:'kiro',label:'Kiro'},{detect});
 const setup=compatibleDefaults([descriptor,claude,kiro]);setup.roles['skill-diagram']='codex';
 const registry=new ProviderRegistry([descriptor,claude,kiro]);
 const fallback=vi.fn(async()=>{throw Error('Unexpected Claude invocation');});
 const store=await Store.open(root),ink=await InkStore.open(root);
 const assistance=new Assistance(store,ink,{name:'claude',checkAvailability:async()=>({available:true}),invoke:fallback},undefined,
  {write:async()=>{}},undefined,()=>registry.snapshot(process.env.AITIARCH_CONFIG_DIR!,async()=>structuredClone(setup),()=>catalog));
 const input={id:'diagram-test',path:'fixture.md',action:'ask' as const,renderer:'skill' as const,text:note,question:VISUALIZE_QUESTION,from:note.indexOf('The queue'),to:note.trimEnd().length};
 const run=async()=>{
  const review=(await assistance.preview(input)).review!;
  await assistance.start({...input,reviewId:review.id});await assistance.wait(input.id);
  return (await ink.read(input.path)).document.items[0]!;
 };
 return {adapter,descriptor,assistance,input,setup,detect,run,file,fallback,store,ink,root,record};
}
it('reviews, stages privately and publishes only on a byte-exact human insertion',async()=>{
 const f=await fixture();
 expect(f.descriptor.capabilities['skill-diagram']).toBe(true);
 expect(descriptorFromAdapter(f.adapter,{detect:f.detect}).capabilities['skill-diagram']).toBe(false);
 await expect(f.assistance.start(f.input)).rejects.toThrow(/review/i);
 const packet=await f.assistance.preview(f.input);
 expect(packet.review).toMatchObject({provider:'codex',cap:{unit:'tokens'}});
 expect(packet.instruction).toContain('"svg"');
 const item=await f.run(),ref=item.skillDiagram!;
 expect(item.generation).toMatchObject({status:'complete',provider:'codex'});
 expect(ref.stage).toMatch(/^[a-f0-9]{32}$/);
 expect(await f.assistance.skillDiagrams.readPreview(ref.asset,ref.stage!)).toEqual(expect.any(Buffer));
 await expect(readFile(path.join(f.root,'assets',ref.asset))).rejects.toMatchObject({code:'ENOENT'});
 expect(await readFile(f.file)).toEqual(encoded(note));
 expect(f.fallback).not.toHaveBeenCalled();
 const sent=JSON.parse(await readFile(f.record,'utf8'));
 expect(sent.args).toEqual([...CODEX_FLAGS,'-C',expect.stringMatching(/aitiarch-headless-/),'-']);
 expect(sent.prompt.endsWith(packet.instruction)).toBe(true);
 expect((await f.assistance.ledger.read()).events.filter(e=>e.event==='invoked_turn')).toHaveLength(1);
 const original=await f.store.read(f.input.path);
 const insertions=new InsertionStore(f.ink,f.store,f.assistance.ledger);
 const target={path:f.input.path,id:f.input.id,noteVersion:original.version};
 const preview=await insertions.preview(target),prepared=await insertions.prepare({...target,preview});
 const {from,to,insert}=preview.changes;
 expect(from).toBe(to);
 const edited=note.slice(0,from)+insert+note.slice(to);
 expect((await f.store.write(target.path,edited,original.version)).ok).toBe(true);
 await insertions.complete(target.path,prepared.operationId);
 expect(await readFile(f.file)).toEqual(encoded(edited));
 expect(await readFile(path.join(f.root,'assets',ref.asset))).toEqual(expect.any(Buffer));
 await expect(f.assistance.skillDiagrams.readPreview(ref.asset,ref.stage!)).rejects.toMatchObject({code:'ENOENT'});
});
it('pins role-specific Codex model and effort and leaves attached skills out of the prompt',async()=>{
 const f=await fixture();
 f.setup.providers.codex.roles['skill-diagram']={model:'synthetic-codex',effort:'medium'};
 await expect(f.assistance.preview({...f.input,skill:'123456789abc'})).rejects.toThrow(/Installed skill opt-in/);
 const packet=await f.assistance.preview(f.input);
 expect(packet.review?.modelSettings).toEqual({model:'synthetic-codex',effort:'medium'});
 await f.run();
 const sent=JSON.parse(await readFile(f.record,'utf8'));
 expect(sent.args).toEqual([...CODEX_FLAGS,'--model','synthetic-codex','-c','model_reasoning_effort="medium"','-C',expect.any(String),'-']);
});
it.each([
 ['script',svg('<script>alert(1)</script>'+rect)],
 ['foreignObject',svg('<foreignObject/>'+rect)],
 ['event handler',svg('<rect width="2" height="2" onload="alert(1)"/>')],
 ['external href',svg('<use href="https://example.invalid/file.svg#id"/>'+rect)],
 ['data URL',svg('<rect fill="url(data:image/png;base64,AAAA)" width="2" height="2"/>')],
 ['multiple roots',svg()+svg()],
 ['missing namespace','<svg>'+rect+'</svg>'],
 ['malformed path',svg('<path d="not a path"/>'+rect)],
 ['element count',svg(rect.repeat(2001))],
 ['oversized',svg('x'.repeat(310000))],
])('fails closed on %s',async(_name,drawing)=>{
 const f=await fixture(drawing),item=await f.run();
 expect(item.generation?.status).toBe('error');expect(item.skillDiagram).toBeUndefined();
 expect(item.body).toMatch(/no diagram was saved/i);
 expect(await readFile(f.record)).toEqual(expect.any(Buffer));
 expect(await readFile(f.file)).toEqual(encoded(note));expect(f.fallback).not.toHaveBeenCalled();
});
it.each(['refusal','tool','overcap','claims'])('rejects %s before staging',async(kind)=>{
 const f=await fixture(svg(),kind),item=await f.run();
 expect(item.generation?.status).toBe('error');expect(item.skillDiagram).toBeUndefined();expect(f.fallback).not.toHaveBeenCalled();
});
it('invalidates an open review on provider change and reports Kiro or a failed Codex gate',async()=>{
 const f=await fixture(),review=(await f.assistance.preview(f.input)).review!;
 f.setup.roles['skill-diagram']='claude';
 await expect(f.assistance.start({...f.input,reviewId:review.id})).rejects.toThrow(/review again/i);
 f.setup.roles['skill-diagram']='kiro';
 expect((await f.assistance.availability('skill')).message).toMatch(/Kiro.*verified/i);
 f.setup.roles['skill-diagram']='codex';
 f.detect.mockResolvedValue({available:false,reason:'Codex is missing a pinned flag.',version:'0.167.0'});
 expect((await f.assistance.availability('skill')).message).toMatch(/missing a pinned flag/i);
 f.detect.mockResolvedValue({available:true,reason:null,version:'0.166.0'});
 expect((await f.assistance.availability('skill')).message).toMatch(/minimum 0.167.0.*0.166.0/i);
 await expect(readFile(f.record)).rejects.toMatchObject({code:'ENOENT'});expect(f.fallback).not.toHaveBeenCalled();
});
