import {createHash} from 'node:crypto';
import {mkdtemp,realpath,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {IMAGE_MAX_BYTES,IMAGE_SEND_MAX_BYTES,IMAGE_SEND_MAX_COUNT} from '../../shared/image-attachments.ts';
import type {ModelEffort} from '../../shared/setup.ts';
import type {confirmImageManifest} from '../chat/image-review.ts';
import {killTree,spawnImageFixture} from './launcher.ts';
import {cleanupProviderTemp} from './temp-cleanup.ts';

type FixtureInput={
 provider:'claude'|'codex';command:string;prefixArgs:readonly string[];input:string;
 selection:Readonly<ModelEffort>;approved:Awaited<ReturnType<typeof confirmImageManifest>>;
};

/** Transport proof for synthetic fixtures. Receives confirmed buffers, never client paths.
 * The regular launchers gain no image permissions and do not use this proof to enable vision. */
export async function runFakeImageTransport<T>(options:FixtureInput,consume:(child:ReturnType<typeof spawnImageFixture>,stdin:string)=>Promise<T>):Promise<T>{
 const {provider,approved,selection}=options;
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
 let staging:string|undefined;
 try{
  const images:string[]=[];
  let stdin=options.input;
  if(provider==='codex'){
   staging=await mkdtemp(path.join(root,'aitiarch-headless-'));
   for(const [index,bytes] of buffers.entries()){
    const image=path.join(staging,`image-${index}.png`);
    await writeFile(image,bytes,{flag:'wx',mode:0o600});
    images.push(image);
   }
  }else{
   stdin=JSON.stringify({type:'user',message:{role:'user',content:[
    {type:'text',text:stdin},
    ...buffers.map(bytes=>({type:'image',source:{type:'base64',media_type:'image/png',data:bytes.toString('base64')}})),
   ]},parent_tool_use_id:null})+'\n';
  }
  const child=spawnImageFixture(options,{cwd,images});
  const closed=new Promise<void>(resolve=>child.once('close',()=>resolve()));
  try{return await consume(child,stdin);}
  finally{
   if(child.pid&&child.exitCode===null&&child.signalCode===null)await killTree(child.pid);
   await closed;
  }
 }finally{
  if(staging){console.info('Provider image cleanup target:',staging);await cleanupProviderTemp(staging);}
  console.info('Provider cleanup target:',cwd);await cleanupProviderTemp(cwd);
 }
}
