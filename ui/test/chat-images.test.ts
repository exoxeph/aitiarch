import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {finishReply,type ReplySources} from '../server/chat/reply.ts';
import {hash} from '../server/chat/context.ts';
import {ImageConfirmation,ImageInterpretationNotice,clipboardImages,imageSupportText} from '../src/chat/ImageAttachments.tsx';
import {inspectImageSource} from '../src/chat/image-source.ts';
import {ChatRuntime} from '../server/chat/runtime.ts';
import {ChatStore} from '../server/chat/store.ts';
import {Store} from '../server/store.ts';
import {InkStore} from '../server/ink-store.ts';
import type {ChatEvent} from '../shared/chat.ts';
import {reviewImageManifest,confirmImageManifest,type ChatImageDelivery} from '../server/chat/image-review.ts';
import {once} from 'node:events';
import {mkdtemp,readFile,readdir,realpath,writeFile} from 'node:fs/promises';
import {claudeArguments} from '../server/providers/claude-arguments.ts';
import {CODEX_FLAGS} from '../server/providers/tool-less-arguments.ts';
import {spawnIsolated,spawnToolless} from '../server/providers/launcher.ts';
import {createProvider,prepareRequest} from '../server/providers/index.ts';
import {createCliAdapter} from '../server/providers/tool-less.ts';
import {normalChatTurn} from '../server/chat/normal-answerer.ts';
import {CHAT_HARD_RULES} from '../server/chat/request.ts';
import {DEFAULT_PIPELINE_CONFIG} from '../shared/pipeline-config.ts';
import {imageDeliveryStatus,runFakeImageTransport} from '../server/providers/image-transport.ts';
import {resolveProjectStorage} from '../server/project-storage.ts';
import {ImageStore} from '../server/image-store.ts';
import {NoteWatcher} from '../server/watch.ts';
import {createApp} from '../server/http.ts';
import {defaultMachineSetup} from '../shared/setup.ts';
import {descriptorFromAdapter,ProviderRegistry} from '../server/providers/registry.ts';
import {saveMachineSetup} from '../server/setup-store.ts';
import {SessionIndex} from '../server/harness/session-index.ts';
import {LedgerStore} from '../server/ledger-store.ts';
import {readCatalog} from '../server/providers/model-catalog.ts';
import type {TurnAdapter} from '../server/providers/turn.ts';

const source={note:'The attached file has no matching quote in this note.',selection:'',decisions:[],diagrams:['D1']};
const id='a'.repeat(32),sha256='b'.repeat(64);
const send={sendId:'review-current',provider:'claude' as const,model:'sonnet',images:[{id,sha256}]};
const imageTurn={confirmed:send,sendId:send.sendId,provider:send.provider,model:send.model};
const reference={kind:'image',id,sha256,sendId:send.sendId,provider:send.provider,model:send.model};
const textClaim={source:'N1',quote:'matching quote in this note'};
const answer=(claims:unknown)=>'A synthetic interpretation.\n<claims>'+JSON.stringify(claims)+'</claims>';
const finish=(claims:unknown,sources:ReplySources={...source,imageTurn})=>finishReply({legacy:false,text:answer(claims)},sources,hash);

beforeEach(()=>vi.stubEnv('AITIARCH_CONFIG_DIR',mkdtempSync(path.join(tmpdir(),'aitiarch-image-claims-'))));
afterEach(()=>vi.unstubAllEnvs());

const fixture=path.resolve('test/fixtures/image-transport-cli.mjs');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==','base64');
async function readFixtureOutput(child:Parameters<Parameters<typeof runFakeImageTransport>[1]>[0],stdin:string){
 let stdout='';child.stdout.setEncoding('utf8').on('data',data=>stdout+=data);
 child.stdin.on('error',()=>{});
 child.stdin.end(stdin);
 expect(await once(child,'close')).toEqual([0,null]);
 return JSON.parse(stdout);
}
async function runImageFixture(provider:'claude'|'codex',change?:'bytes'|'model'|'executable'|'error'|'cancel'){
 const project=await mkdtemp(path.join(await realpath(process.env.AITIARCH_CONFIG_DIR!),'project-'));
 const root=path.join(project,'.aitiarch');
 expect(await resolveProjectStorage(root,{create:true})).toMatchObject({ok:true});
 const store=new ImageStore(root);
 const staged=await store.stage(png);
 const model='synthetic-vision';
 const binding={sendId:'synthetic-review',provider,model};
 const review=await reviewImageManifest(store,[staged.id],binding);
 const approved=await confirmImageManifest(store,review,binding,{confirmImages:true,imageIds:[staged.id]});
 if(change==='bytes')approved.images[0].bytes[0]^=0xff;
 const cancel=new AbortController();
 try{
  return await runFakeImageTransport({
   provider,command:change==='executable'?'unverified-cli':process.execPath,prefixArgs:[fixture,provider],
   input:'Synthetic reviewed prompt',selection:{model:change==='model'?'other-model':model,effort:null},approved,storage:store,signal:cancel.signal,
  },async(child,stdin)=>{
   if(change==='error'||change==='cancel'){
    expect(await readFile(child.spawnargs.at(-2)!)).toEqual(approved.images[0].bytes);
    if(change==='error')throw Error('Synthetic fixture failure.');
    const closed=once(child,'close');
    cancel.abort(Error('Synthetic fixture cancellation.'));
    await closed;
   }else return {processed:approved.images[0].bytes.toString('base64'),...await readFixtureOutput(child,stdin)};
  });
 }finally{
  await store.discard(staged.id);
  expect(await readdir(path.join(root,'local','images'))).toEqual([]);
 }
}

it('Claude sends exact reviewed bytes in user blocks with only the stream input flag added',async()=>{
 const result=await runImageFixture('claude');
 expect(result.argv).toEqual([...claudeArguments({stream:true,selection:{model:'synthetic-vision',effort:null}}),'--input-format','stream-json']);
 expect(result.body).toEqual({type:'user',message:{role:'user',content:[
  {type:'text',text:'Synthetic reviewed prompt'},
  {type:'image',source:{type:'base64',media_type:'image/png',data:result.processed}},
 ]},parent_tool_use_id:null});
});

it('adds only the image input arguments at the production process boundary',async()=>{
 const parent=await realpath(tmpdir());
 const cwd=await mkdtemp(path.join(parent,'aitiarch-image-argv-'));
 const selection={model:'synthetic-vision',effort:null};
 const claude={provider:'claude' as const,command:process.execPath,prefixArgs:[fixture,'claude'],selection};
 const codex={id:'codex' as const,command:process.execPath,prefixArgs:[fixture,'codex'],selection};
 const args=claudeArguments({stream:true,partial:true,hardening:['--max-turns','1'],selection});
 const compare=async(child:ReturnType<typeof spawnIsolated>,expected:string[])=>{
  child.stdout.resume();child.stderr.resume();child.stdin.on('error',()=>{});
  const closed=once(child,'close');child.stdin.end();
  await closed;
  expect(child.spawnargs.slice(3)).toEqual(expected);
 };
 await compare(spawnIsolated(claude,args,{cwd}),args);
 await compare(spawnIsolated(claude,args,{cwd},true),[...args,'--input-format','stream-json']);
 const codexArgs=[...CODEX_FLAGS,'--model',selection.model,'-C',cwd];
 const privateCopy=path.join(process.env.AITIARCH_CONFIG_DIR!,'synthetic.png');
 await writeFile(privateCopy,png);
 await compare(spawnToolless(codex,'isolated',{cwd}),[...codexArgs,'-']);
 await compare(spawnToolless(codex,'isolated',{cwd},undefined,[privateCopy]),[...codexArgs,'--image',privateCopy,'-']);
});

it.each(['claude','codex'] as const)('delivers a confirmed manifest through the production %s driver and keeps its accounting',async provider=>{
 const config=await realpath(process.env.AITIARCH_CONFIG_DIR!);
 const root=path.join(await mkdtemp(path.join(config,'project-')),'.aitiarch');
 expect(await resolveProjectStorage(root,{create:true})).toMatchObject({ok:true});
 const storage=new ImageStore(root),staged=await storage.stage(png);
 const selection={model:'synthetic-vision',effort:null};
 const binding={sendId:'synthetic-review',provider,model:selection.model};
 const review=await reviewImageManifest(storage,[staged.id],binding);
 const approved=await confirmImageManifest(storage,review,binding,{confirmImages:true,imageIds:[staged.id]});
 const request={id:'synthetic-image',chat:true as const,action:'ask' as const,question:'What is shown?',selection:'',note:'',decisions:[],turns:[]};
 const record=path.join(config,'record.json');
 const cli={command:process.execPath,prefixArgs:[fixture,provider,'record',record],selection};
 const read=async()=>JSON.parse(await readFile(record,'utf8'));
 const reviewedPrompt=prepareRequest(request,review).instruction;
 expect(reviewedPrompt).toContain('<claims>'+JSON.stringify(review.images.map(({id,sha256})=>({kind:'image',id,sha256,sendId:review.sendId,provider:review.provider,model:review.model})))+'</claims>');
 expect(reviewedPrompt.endsWith(CHAT_HARD_RULES)).toBe(true);
 const version=provider==='claude'?'2.1.205':'0.167.0',images={approved,storage,version};
 if(provider==='claude'){
  const adapter=createProvider({...cli,provider,contract:'claude-canary-2.1.205'});
  await adapter.invoke(request,{onTextDelta:()=>{}});
  const plain=await read();
  const result=await adapter.invoke(request,{onTextDelta:()=>{},imageInput:images});
  const image=await read(),blocks=image.body.message.content;
  expect(image.argv).toEqual([...plain.argv,'--input-format','stream-json']);
  expect(JSON.parse(blocks[0].text).instruction).toBe(reviewedPrompt);
  expect(blocks[1].source.data).toBe(approved.images[0].bytes.toString('base64'));
  expect(result).toMatchObject({rawReply:true,costUsd:0.001,usage:{inputTokens:30,outputTokens:5}});
 }else{
  const adapter=createCliAdapter({...cli,id:provider,selection:undefined});
  const registry=new ProviderRegistry([descriptorFromAdapter(adapter,{detect:async()=>({available:true,reason:null,version})})]);
  const setup=defaultMachineSetup();
  setup.roles['normal-chat']='codex';setup.providers.codex.enabled=true;setup.providers.codex.model=selection.model;
  await saveMachineSetup(config,setup);
  const snapshot=await registry.snapshot(config);
  const options={answerer:provider,cap:DEFAULT_PIPELINE_CONFIG.council.caps.codex,snapshot};
  expect(await normalChatTurn(request,[adapter],undefined,options)).toMatchObject({status:'ok'});
  const plain=await read();
  const result=await normalChatTurn(request,[adapter],undefined,{...options,images});
  const image=await read();
  const normalized=(args:string[])=>args.map((v,i)=>args[i-1]==='-C'?'<scratch>':v);
  expect(normalized(image.argv)).toEqual([...normalized(plain.argv).slice(0,-1),'--image',image.image,'-']);
  expect(image.body.endsWith(reviewedPrompt)).toBe(true);
  expect(image.contents).toBe(approved.images[0].bytes.toString('base64'));
  await expect(readFile(image.image)).rejects.toMatchObject({code:'ENOENT'});
  expect(result).toMatchObject({status:'ok',usage:[{unit:'tokens',amount:35,afterTurn:true}]});
 }
});

it('Codex receives only a host-owned copy of the reviewed image and keeps view_image disabled',async()=>{
 const result=await runImageFixture('codex');
 expect(result.argv).toEqual([...CODEX_FLAGS,'--model','synthetic-vision','-C',result.cwd,'--image',result.image,'-']);
 expect(result.body).toBe('Synthetic reviewed prompt');
 expect(result.contents).toBe(result.processed);
 expect(path.dirname(result.image)).not.toBe(result.cwd);
 expect(path.dirname(result.image).endsWith(path.join('.aitiarch','local','images'))).toBe(true);
 await expect(readFile(result.image)).rejects.toMatchObject({code:'ENOENT'});
});

it.each(['error','cancel'] as const)('Codex removes its private argument copy after %s',async failure=>{
 await expect(runImageFixture('codex',failure)).rejects.toThrow(failure==='error'?'Synthetic fixture failure.':'Synthetic fixture cancellation.');
});

it.each(['claude','codex'] as const)('%s refuses transport after a reviewed model or byte change',async provider=>{
 await expect(runImageFixture(provider,'bytes')).rejects.toThrow(/match the reviewed send/);
 await expect(runImageFixture(provider,'model')).rejects.toThrow(/match the reviewed send/);
});

it('does not enable the image transport for an unverified executable',async()=>{
 await expect(runImageFixture('codex','executable')).rejects.toThrow(/not been verified/);
});

it('gates image delivery by the probed versions and the Codex catalog modality',()=>{
 expect(imageDeliveryStatus('codex','0.170.0','gpt-6.2-sol')).toMatchObject({available:true,status:'verified'});
 expect(imageDeliveryStatus('codex','0.171.0','gpt-6.2-sol')).toMatchObject({available:true,status:'untested version'});
 expect(imageDeliveryStatus('codex','0.171.0','another-model',true)).toMatchObject({available:true,status:'untested model'});
 expect(imageDeliveryStatus('codex','0.169.0','another-model',true)).toMatchObject({available:false,reason:expect.stringContaining('0.170.0')});
 expect(imageDeliveryStatus('codex','bad','another-model',true).available).toBe(false);
 expect(imageDeliveryStatus('codex','0.170.0','another-model')).toMatchObject({available:false,reason:'image delivery not verified for this model'});
 expect(imageDeliveryStatus('codex','0.171.0','gpt-6.2-sol',false)).toMatchObject({available:false,status:'unsupported'});
 expect(imageDeliveryStatus('claude','2.1.205','claude-opus-4-8[1m]')).toMatchObject({available:true,status:'verified'});
 expect(imageDeliveryStatus('claude','2.1.205','other')).toMatchObject({available:false,status:'not verified yet'});
 expect(imageDeliveryStatus('kiro','3.3.0','other')).toMatchObject({available:false,status:'unsupported'});
});

it('reads Codex inputModalities and captures the selected model capability for chat',async()=>{
 const catalog=await readCatalog({id:'codex',path:process.execPath,version:'0.170.0',isolation:'metadata-compatible'},{prefixArgs:[fixture,'catalog']});
 expect(catalog.source).toBe('cli');
 expect(catalog.models.map(({id,imageInput})=>[id,imageInput])).toEqual([['vision',true],['text-only',false],['unknown',undefined]]);
 expect(catalog.models[2]).not.toHaveProperty('imageInput');
 const config=await mkdtemp(path.join(process.env.AITIARCH_CONFIG_DIR!,'modality-')),setup=defaultMachineSetup();
 setup.providers.codex.enabled=true;
 setup.providers.codex.model='vision';
 setup.roles['normal-chat']='codex';
 await saveMachineSetup(config,setup);
 const adapter:TurnAdapter={id:'codex',label:'Codex',safetyLabel:'contained',async *startTurn(){throw Error('No inference expected.');}};
 const registry=new ProviderRegistry([descriptorFromAdapter(adapter,{detect:async()=>({available:true,reason:null,version:'0.170.0'})})]);
 const snapshot=await registry.snapshot(config,undefined,()=>catalog);
 expect(snapshot.codexChatImageInput).toBe(true);
 const status=imageDeliveryStatus('codex',snapshot.providerVersions?.codex,'vision',snapshot.codexChatImageInput);
 expect(imageSupportText(status)).toMatch(/^Untested model\. The Codex catalog declares image input\./);
 expect(imageSupportText(imageDeliveryStatus('kiro','3.3.0',null))).toMatch(/^Unsupported\. Kiro/);
 expect(imageSupportText(imageDeliveryStatus('claude','2.1.205','claude-opus-4-8[1m]'))).toMatch(/^Verified\. Claude/);
 expect(imageSupportText(imageDeliveryStatus('claude','2.1.205','other'))).toMatch(/^Not verified yet\. Claude/);
});

it('checks JPEG dimensions and refuses animated WebP, GIF, SVG and oversized source images before decoding',()=>{
 const jpeg=Buffer.from('ffd8ffc00011080002000303011100021100031100ffd9','hex');
 expect(inspectImageSource(jpeg)).toEqual({mime:'image/jpeg',width:3,height:2});
 const webp=Buffer.from('524946461600000057454250565038580a00000002000000000000000000','hex');
 expect(()=>inspectImageSource(webp)).toThrow('Animated WebP');
 expect(()=>inspectImageSource(Buffer.from('GIF89a'))).toThrow('GIF');
 expect(()=>inspectImageSource(Buffer.from('<svg/>'))).toThrow('PNG, JPEG or WebP');
 const large=Buffer.from(jpeg);large.writeUInt16BE(4001,7);large.writeUInt16BE(4000,9);
 expect(()=>inspectImageSource(large)).toThrow('16 megapixels');
 expect(()=>inspectImageSource(Buffer.alloc(5*1024*1024+1))).toThrow('5 MiB');
});

it('leaves ordinary text paste alone and only captures file-backed images',()=>{
 const pngFile={type:'image/png'} as File;
 expect(clipboardImages({files:[],items:[{kind:'string',type:'text/plain'}]} as unknown as DataTransfer)).toEqual([]);
 expect(clipboardImages({files:[pngFile]} as unknown as DataTransfer)).toEqual([pngFile]);
});

it('renders an unchecked per-send confirmation and the exact warning for reviewed thumbnails',()=>{
 const html=renderToStaticMarkup(createElement(ImageConfirmation,{
  checked:false,onChange:()=>{},images:[{id,width:1,height:1,byteLength:png.length,mime:'image/png',src:'blob:test'}],
 }));
 expect(html).toContain('images are sent as-is; secret exclusion cannot inspect them');
 expect(html).toContain('Confirm sending these images');
 expect(html).toContain('src="blob:test"');
 expect(html).not.toContain('checked=""');
});

it('requires fresh image consent at the HTTP boundary even after enabling text bypass',async()=>{
 const config=await realpath(process.env.AITIARCH_CONFIG_DIR!);
 const project=await mkdtemp(path.join(config,'project-')),root=path.join(project,'.aitiarch');
 expect(await resolveProjectStorage(root,{create:true})).toMatchObject({ok:true});
 await writeFile(path.join(root,'fixture.md'),'# Synthetic image chat\n');
 let model='synthetic-vision';
 const unused=async function*(){throw new Error('Image turn must use its own tool-less delivery.');};
 const adapters:TurnAdapter[]=[{id:'claude',label:'Claude',safetyLabel:'fenced',startTurn:unused},
  {id:'codex',label:'Codex',safetyLabel:'contained',startTurn:unused},{id:'kiro',label:'Kiro',safetyLabel:'host-gated',startTurn:unused}];
 const registry=new ProviderRegistry(adapters.map(adapter=>descriptorFromAdapter(adapter,{detect:async()=>({available:true,reason:null})})));
 const setup=defaultMachineSetup();
 setup.providers.claude.model=model;
 setup.providers.codex.enabled=true;
 setup.providers.kiro.enabled=true;
 await saveMachineSetup(config,setup);
 const routing=()=>registry.snapshot(config);
 const write=vi.fn<ChatImageDelivery['send']>(async({request,selection,approved},signal)=>{
  const provider=approved.manifest.provider;
  const report=await runFakeImageTransport({provider,command:process.execPath,prefixArgs:[fixture,provider],input:request.question,selection,approved,storage:new ImageStore(root),signal},readFixtureOutput);
  if(provider==='claude')expect(report).toMatchObject({body:{message:{content:[
   {type:'text',text:'Synthetic question'},
   {type:'image',source:{data:png.toString('base64')}},
  ]}}});
  else expect(report).toMatchObject({body:'Synthetic question',contents:png.toString('base64')});
  return {id:request.id,provider,model:null,answer:answer({none:'no_context_used'}),rawReply:true,claims:[],usage:null};
 });
 const store=await Store.open(root),watcher=new NoteWatcher(store);
 const app=createApp({store,watcher,distDir:root,council:{adapters,routing,index:await SessionIndex.open(path.join(config,'sessions'))},
  provider:{name:'claude',checkAvailability:async()=>({available:true}),invoke:async request=>({id:request.id,provider:'claude',model:null,answer:answer({none:'no_context_used'}),rawReply:true,claims:[],usage:null})},
  chatImageDelivery:{supports:(_provider:string,value:string)=>value==='synthetic-vision',send:write},
 });
 try{
  const base='http://127.0.0.1:'+await app.listen(0),cookie=(await fetch(base+'/api/session')).headers.get('set-cookie')!.split(';')[0];
  const putAt=(endpoint:string,body:unknown)=>fetch(base+'/api/'+endpoint,{method:'PUT',headers:{cookie,origin:base,'content-type':'application/json','x-aitiarch':'1'},body:JSON.stringify(body)});
  const put=(endpoint:string,body:unknown)=>putAt('chat/'+endpoint,body);
  const review=(id:string,imageIds?:string[])=>put('review',{id,path:'fixture.md',question:'Synthetic question',context:[],imageIds}).then(r=>r.json());
  const noImage=await review('text');
  expect(await (await put('send',{reviewId:noImage.reviewId,confirmed:true,dontAskAgain:true})).text()).toContain('event: complete');
  expect((await review('text-bypass')).requiresConfirmation).toBe(false);
  const stage=await put('image-stage',{data:png.toString('base64')});
  expect(stage.status).toBe(200);
  const image=await stage.json(),imageIds=[image.id];
  expect(await fetch(base+'/api/chat/image-stage?id='+image.id,{headers:{cookie}}).then(r=>r.status)).toBe(404);
  const first=await review('image-first',imageIds);
  expect(first).toMatchObject({requiresConfirmation:true,images:{provider:'claude',model,images:[{id:image.id,sha256:expect.stringMatching(/^[a-f0-9]{64}$/)}]}});
  expect((await put('send',{reviewId:first.reviewId,confirmed:true,imageIds})).status).toBe(409);
  expect((await put('send',{reviewId:first.reviewId,confirmed:true,confirmImages:true,imageIds:['f'.repeat(32)]})).status).toBe(409);
  expect(write).not.toHaveBeenCalled();
  expect(await (await put('send',{reviewId:first.reviewId,confirmed:true,confirmImages:true,imageIds})).text()).toContain('"imageInterpretation":true');
  expect(write).toHaveBeenCalledTimes(1);
  expect(write.mock.calls[0][0].approved.images[0].bytes.equals(png)).toBe(true);
  expect((await new ChatStore(root).read('fixture.md')).messages.map(message=>message.id)).not.toContain('image-first');
  const ledger=await new LedgerStore(root).read();
  const imageAudits=ledger.events.filter(event=>event.requestId==='image-first'&&event.event==='chat_started');
  expect(imageAudits).toEqual([expect.objectContaining({images:{count:1,bytes:png.length}})]);
  expect(JSON.stringify(ledger)).not.toMatch(new RegExp(`${image.id}|${first.images.images[0].sha256}`));
  expect(JSON.stringify(ledger)).not.toContain(png.toString('base64'));
  expect((await put('send',{reviewId:first.reviewId,confirmed:true,confirmImages:true,imageIds})).status).toBe(409);
  const retained=await review('image-retained',imageIds);
  expect(retained.requiresConfirmation).toBe(true);
  model='other-model';
  setup.providers.claude.model=model;await saveMachineSetup(config,setup);
  expect((await put('send',{reviewId:retained.reviewId,confirmed:true,confirmImages:true,imageIds})).status).toBe(409);
  expect(write).toHaveBeenCalledTimes(1);
  setup.roles['normal-chat']='kiro';
  await saveMachineSetup(config,setup);
  expect(await review('kiro-image',imageIds)).toMatchObject({message:expect.stringContaining('Kiro does not have a verified isolated image transport')});

  setup.roles['normal-chat']='codex';
  setup.providers.codex.model='synthetic-vision';
  await saveMachineSetup(config,setup);
  const conversation=await (await putAt('harness/sessions/new',{mode:'chat',path:'fixture.md',label:'Synthetic images'})).json();
  const native=await (await put('review',{id:'codex-image',path:'fixture.md',question:'Synthetic question',context:[],session:conversation.id,imageIds})).json();
  expect(native).toMatchObject({provider:'codex',needsPlan:true,images:{provider:'codex',model:'synthetic-vision'}});
  expect((await putAt('council/plan',{...native.normalPlan,approve:true})).status).toBe(200);
  const codexEvents=await (await put('send',{reviewId:native.reviewId,confirmed:true,confirmImages:true,imageIds})).text();
  expect(codexEvents).toContain('"imageInterpretation":true');
  expect(codexEvents).toContain(`"estimated":${native.normalPlan.caps.codex.amount}`);
  expect(codexEvents).toContain('"unreportedCalls":1');
 }finally{watcher.stop();await app.close();}
});

it('binds an image reference to the confirmed current send and renders only an unverified notice',()=>{
 const result=finish([reference,textClaim,{source:'D1',visual:true}]);
 expect(result.imageInterpretation).toBe(true);
 expect(result.claims.map(c=>c.status)).toEqual(['found','visual']);
 expect(JSON.stringify(result)).not.toContain(sha256);
 expect(JSON.stringify(result)).not.toContain(id);
 expect(renderToStaticMarkup(createElement(ImageInterpretationNotice,{shown:result.imageInterpretation}))).toContain('interpretation of your image, not verified');
 expect(renderToStaticMarkup(createElement(ImageInterpretationNotice,{}))).toBe('');
});

it.each([
 {id:'c'.repeat(32)}, {sha256:'c'.repeat(64)}, {sendId:'review-old'},
 {provider:'codex'}, {model:'opus'}, {quote:'Fake image quote'},
])('rejects a mismatched or malformed image reference %j',change=>{
 expect(()=>finish([{...reference,...change}])).toThrow(/image reference/i);
});

it('refuses image references without confirmation or when the runtime binding changes',()=>{
 expect(()=>finish([reference],source)).toThrow(/image reference/i);
 expect(()=>finish([reference],{...source,imageTurn:{...imageTurn,model:'opus'}})).toThrow(/image reference/i);
 expect(()=>finish([reference],{...source,imageTurn:{...imageTurn,provider:'codex'}})).toThrow(/image reference/i);
 expect(()=>finish([reference],{...source,imageTurn:{...imageTurn,sendId:'review-new'}})).toThrow(/image reference/i);
});

it('checks bad image references past the cap while retaining the 32-claim limit',()=>{
 const textClaims=Array.from({length:33},()=>textClaim);
 expect(()=>finish([...textClaims,{...reference,sendId:'other-send'}])).toThrow(/image reference/i);
 expect(finish([reference,...textClaims]).claims).toHaveLength(31);
 expect(finish(textClaims,source).claims).toHaveLength(32);
});

it('does not treat text copied from pixels as verified and flags every image answer',()=>{
 const result=finish([{source:'I1',quote:'Text found only in the pixels'}, {source:'N1',quote:'Text found only in the pixels'}]);
 expect(result.claims.map(c=>c.status)).toEqual(['no_valid_source','not_found']);
 expect(result.imageInterpretation).toBe(true);
 expect(finish({none:'no_context_used'}).imageInterpretation).toBe(true);
 expect(()=>finish(reference)).toThrow(/image reference/i);
});

it('rejects and never stores a fake provider reply that invents image consent',async()=>{
 const root=mkdtempSync(path.join(tmpdir(),'aitiarch-claim-reply-')),note='fixture.md';
 writeFileSync(path.join(root,note),'# Synthetic note\n');
 const store=await Store.open(root),chats=new ChatStore(root);
 const runtime=new ChatRuntime(store,await InkStore.open(root),chats,{
  name:'claude',
  async checkAvailability(){return {available:true,textStreaming:true};},
  async invoke(request){return {id:request.id,provider:'claude',model:null,answer:answer([reference]),rawReply:true,claims:[],usage:null};},
 },[]);
 try{
  expect(await runtime.imageAvailability()).toEqual({available:false,status:'not verified yet',reason:'image delivery not verified yet'});
  const review=await runtime.review({id:'request-1',path:note,question:'Summarize this.',context:[]});
  await expect(runtime.review({id:'request-image',path:note,question:'Summarize this.',context:[],imageIds:[id]})).rejects.toMatchObject({code:'disabled'});
  await expect(runtime.send({reviewId:review.reviewId,confirmed:true,confirmImages:true,imageIds:[id]},()=>{})).rejects.toMatchObject({code:'review_required'});
  const events:ChatEvent[]=[];
  await runtime.send({reviewId:review.reviewId,confirmed:true},event=>events.push(event));
  expect(events.at(-1)).toMatchObject({type:'error',code:'validation',detail:expect.stringMatching(/confirmed send/)});
  expect(events.some(event=>event.type==='complete')).toBe(false);
  expect((await chats.read(note)).messages).toEqual([]);
  expect(runtime.memoryMessages(note)).toEqual([]);
 }finally{await runtime.close();}
});

it('binds review thumbnails and every confirmation to current staged bytes and routing',async()=>{
 const bytes=Buffer.from('synthetic processed image');
 const first={id,mime:'image/png' as const,width:1,height:2,byteLength:bytes.length,sha256:hash(bytes.toString()),bytes};
 const reader={readManifest:vi.fn(async()=>[first])};
 const reviewed=await reviewImageManifest(reader,[id],send);
 const binding={sendId:send.sendId,provider:send.provider,model:send.model};
 expect(reviewed.images).toEqual([{id,mime:'image/png',width:1,height:2,byteLength:bytes.length,sha256:first.sha256}]);
 expect(JSON.stringify(reviewed)).not.toContain(bytes.toString());
 for(const changed of [{sendId:'other'}, {provider:'codex' as const},{model:'opus'}]){
  await expect(confirmImageManifest(reader,reviewed,{...binding,...changed},{confirmImages:true,imageIds:[id]})).rejects.toThrow(/review again/i);
 }
 await expect(confirmImageManifest(reader,reviewed,binding,{imageIds:[id]})).rejects.toThrow(/confirm/i);
 await expect(confirmImageManifest(reader,reviewed,binding,{confirmImages:true,imageIds:['other']})).rejects.toThrow(/review again/i);
 expect((await confirmImageManifest(reader,reviewed,binding,{confirmImages:true,imageIds:[id]})).manifest).toEqual(reviewed);
 await expect(confirmImageManifest(reader,reviewed,binding,{imageIds:[id]})).rejects.toThrow(/confirm/i);
 reader.readManifest.mockResolvedValueOnce([{...first,sha256:'c'.repeat(64)}]);
 await expect(confirmImageManifest(reader,reviewed,binding,{confirmImages:true,imageIds:[id]})).rejects.toThrow(/review again/i);
});
