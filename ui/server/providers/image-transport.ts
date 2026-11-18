import {createHash} from 'node:crypto';
import {mkdtemp,realpath} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {IMAGE_MAX_BYTES,IMAGE_SEND_MAX_BYTES,IMAGE_SEND_MAX_COUNT} from '../../shared/image-attachments.ts';
import type {ModelEffort} from '../../shared/setup.ts';
import type {confirmImageManifest} from '../chat/image-review.ts';
import {killTree,spawnImageFixture} from './launcher.ts';
import {cleanupProviderTemp} from './temp-cleanup.ts';
import type {ImageStore} from '../image-store.ts';

type FixtureInput={
 provider:'claude'|'codex';command:string;prefixArgs:readonly string[];input:string;
 selection:Readonly<ModelEffort>;approved:Awaited<ReturnType<typeof confirmImageManifest>>;
 storage:Pick<ImageStore,'copyForTransport'>;signal?:AbortSignal;
};

/** Transport proof for synthetic fixtures. Receives confirmed buffers, never client paths.
 * The regular launchers gain no image permissions and do not use this proof to enable vision. */
export async function runFakeImageTransport<T>(options:FixtureInput,consume:(child:ReturnType<typeof spawnImageFixture>,stdin:string)=>Promise<T>):Promise<T>{
 const {provider,approved,selection,storage,signal}=options;
 signal?.throwIfAborted();
 const fail=()=>Error('Confirmed image bytes or model no longer match the reviewed send.');
 if(options.command!==process.execPath||!options.prefixArgs.length)throw Error('Isolated image delivery has not been verified for this provider.');
 const model=selection.model;
 if(!model||approved.manifest.provider!==provider||approved.manifest.model!==model||
    !approved.images.length||approved.images.length>IMAGE_SEND_MAX_COUNT||approved.images.length!==approved.manifest.images.length)throw fail();
 const buffers=approved.images.map((image,index)=>{
  const expected=approved.manifest.images[index];
  if(image.id!==expected.id||image.mime!=='image/png'||expected.mime!==image.mime||image.bytes.length!==expected.byteLength||
     image.bytes.length>IMAGE_MAX_BYTES||createHash('sha256').update(image.bytes).digest('hex')!==expected.sha256)throw fail();
  return Buffer.from(image.bytes);
 });
 if(buffers.reduce((sum,bytes)=>sum+bytes.length,0)>IMAGE_SEND_MAX_BYTES)throw fail();

 const root=await realpath(os.tmpdir());
 const cwd=await mkdtemp(path.join(root,'aitiarch-headless-'));
 const copies:Awaited<ReturnType<ImageStore['copyForTransport']>>[]=[];
 try{
  const images:string[]=[];
  let stdin=options.input;
  if(provider==='codex'){
   for(const bytes of buffers){
    signal?.throwIfAborted();
    const copy=await storage.copyForTransport(bytes);
    copies.push(copy);
    images.push(copy.file);
   }
  }else{
   stdin=JSON.stringify({type:'user',message:{role:'user',content:[
    {type:'text',text:stdin},
    ...buffers.map(bytes=>({type:'image',source:{type:'base64',media_type:'image/png',data:bytes.toString('base64')}})),
   ]},parent_tool_use_id:null})+'\n';
  }
  signal?.throwIfAborted();
  const child=spawnImageFixture(options,{cwd,images});
  const closed=new Promise<void>(resolve=>child.once('close',()=>resolve()));
  let killing:Promise<void>|undefined;
  const abort=()=>{if(child.pid&&child.exitCode===null&&child.signalCode===null)killing??=killTree(child.pid);};
  signal?.addEventListener('abort',abort,{once:true});
  if(signal?.aborted)abort();
  try{const result=await consume(child,stdin);signal?.throwIfAborted();return result;}
  finally{
   signal?.removeEventListener('abort',abort);
   abort();
   await killing;
   await closed;
  }
 }finally{
  for(const copy of copies)await copy.discard().catch(()=>{console.warn('An interrupted image delivery copy remains in private storage.');});
  console.info('Provider cleanup target:',cwd);await cleanupProviderTemp(cwd);
 }
}
