import {createHash,randomBytes} from 'node:crypto';
import {constants,type Stats} from 'node:fs';
import {lstat,mkdir,open,unlink} from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';
import {crc32,deflate,inflate} from 'node:zlib';
import {IMAGE_MAX_BYTES,IMAGE_MAX_PIXELS,IMAGE_SEND_MAX_BYTES,IMAGE_SEND_MAX_COUNT,type StagedImage} from '../shared/image-attachments.ts';
import {assertStoragePath,resolveProjectStorage,storageErrorCode} from './project-storage.ts';

const SIGNATURE=Buffer.from('89504e470d0a1a0a','hex');
const ID=/^[a-f0-9]{32}$/;
const LIFETIME_MS=15*60*1000;
const MAX_STAGED=IMAGE_SEND_MAX_COUNT*2;
const inflateRows=promisify(inflate);
const deflateRows=promisify(deflate);
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const invalid=()=>new Error('Invalid processed image. A single-frame RGB or RGBA PNG is required.');

function pngChunk(type:string,data:Buffer){
 const bytes=Buffer.alloc(data.length+12);
 bytes.writeUInt32BE(data.length);
 bytes.write(type,4);
 data.copy(bytes,8);
 bytes.writeUInt32BE(crc32(bytes.subarray(4,-4)),bytes.length-4);
 return bytes;
}

/** The browser will submit its decoded, re-encoded pixels as PNG. Validate the
 * scanline shape independently and persist only a fresh canonical container. */
async function canonicalPng(input:Buffer){
 if(input.length>IMAGE_MAX_BYTES)throw Error('Image exceeds 5 MiB.');
 if(input.length<45||!input.subarray(0,8).equals(SIGNATURE))throw invalid();
 let header:Buffer|undefined;
 let width=0,height=0,stride=0,ended=false,dataEnded=false,chunkCount=0;
 const parts:Buffer[]=[];
 for(let at=8;at<input.length;){
  if(ended||at+12>input.length||++chunkCount>4096)throw invalid();
  const size=input.readUInt32BE(at),end=at+12+size;
  const type=input.toString('latin1',at+4,at+8),data=input.subarray(at+8,end-4);
  if(end>input.length||!/^[A-Za-z]{2}[A-Z][A-Za-z]$/.test(type)||
     crc32(input.subarray(at+4,end-4))!==input.readUInt32BE(end-4))throw invalid();
  if(!header){
   if(type!=='IHDR'||size!==13)throw invalid();
   width=data.readUInt32BE(0);height=data.readUInt32BE(4);
   if(!width||!height||width*height>IMAGE_MAX_PIXELS)throw Error('Image exceeds the allowed pixel dimensions.');
   if(data[8]!==8||(data[9]!==2&&data[9]!==6)||data[10]||data[11]||data[12])throw invalid();
   stride=1+width*(data[9]===6?4:3);
   header=data;
  }else if(type==='IDAT'){
   if(dataEnded)throw invalid();
   parts.push(data);
  }else{
   if(parts.length)dataEnded=true;
   if(type==='IEND'){
    if(size||!parts.length)throw invalid();
    ended=true;
   }else if(/^[A-Z]/.test(type)||['acTL','fcTL','fdAT','tRNS'].includes(type))throw invalid();
  }
  at=end;
 }
 if(!header||!ended)throw invalid();
 const expected=stride*height;
 const payload=Buffer.concat(parts);
 let inflated:{buffer:Buffer;engine:{bytesWritten:number}};
 try{
  // Node's types describe only the default buffer result, even with info enabled.
  inflated=await inflateRows(payload,{maxOutputLength:expected,info:true}) as unknown as typeof inflated;
 }catch{throw invalid();}
 const rows=inflated.buffer;
 if(inflated.engine.bytesWritten!==payload.length||rows.length!==expected)throw invalid();
 for(let row=0;row<expected;row+=stride)if(rows[row]>4)throw invalid();
 const compressed=await deflateRows(rows);
 const bytes=Buffer.concat([SIGNATURE,pngChunk('IHDR',header),pngChunk('IDAT',compressed),pngChunk('IEND',Buffer.alloc(0))]);
 if(bytes.length>IMAGE_MAX_BYTES)throw Error('Processed image exceeds 5 MiB.');
 return {width,height,bytes};
}

interface Stage {
 descriptor:StagedImage;
 sha256:string;
 entry:Stats;
 until:number;
 timer:ReturnType<typeof setTimeout>;
}

function sameEntry(stat:Stats,expected:Stats){
 return stat.isFile()&&stat.nlink===1&&stat.ino===expected.ino&&stat.dev===expected.dev&&stat.birthtimeMs===expected.birthtimeMs;
}

export class ImageStore {
 private readonly root:string;
 private readonly now:()=>number;
 private readonly stages=new Map<string,Stage>();
 private staging=false;
 constructor(root:string,now=Date.now){this.root=root;this.now=now;}

 private async stagePath(id:string,create=false){
  if(!ID.test(id))throw Error('Invalid staged image ID.');
  const layout=await resolveProjectStorage(this.root);
  if(!layout.ok)throw Error(layout.reason);
  const dir=layout.privatePaths.images;
  await assertStoragePath({lstat},dir);
  if(create)await mkdir(dir,{mode:0o700}).catch(error=>{if(storageErrorCode(error)!=='EEXIST')throw error;});
  const file=path.join(dir,id+'.png');
  await assertStoragePath({lstat},file);
  return file;
 }

 async stage(input:Buffer):Promise<StagedImage>{
  if(this.staging||this.stages.size>=MAX_STAGED)throw Error('Image staging is full or busy.');
  this.staging=true;
  try{
   const {width,height,bytes}=await canonicalPng(input);
   const id=randomBytes(16).toString('hex'),file=await this.stagePath(id,true);
   const handle=await open(file,'wx',0o600);
   let entry:Stats|undefined;
   try{
    try{entry=await handle.stat();await handle.writeFile(bytes);}
    finally{await handle.close();}
   }catch(error){
    if(entry){
     const current=await lstat(file).catch(()=>null);
     if(current&&sameEntry(current,entry))await unlink(file).catch(()=>{});
    }
    throw error;
   }
   const descriptor:StagedImage={id,mime:'image/png',width,height,byteLength:bytes.length};
   const timer=setTimeout(()=>void this.discard(id).catch(()=>{}),LIFETIME_MS);
   timer.unref();
   this.stages.set(id,{descriptor,entry,sha256:hash(bytes),until:this.now()+LIFETIME_MS,timer});
   return {...descriptor};
  }finally{this.staging=false;}
 }

 async read(id:string){
  const record=this.stages.get(id);
  if(!record)throw Error('Unknown staged image.');
  if(record.until<=this.now()){
   await this.discard(id);
   throw Error('Staged image expired.');
  }
  const file=await this.stagePath(id);
  const handle=await open(file,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try{
   const stat=await handle.stat();
   const size=record.descriptor.byteLength;
   if(!sameEntry(stat,record.entry)||stat.size!==size)throw Error('Staged image changed.');
   const bytes=Buffer.alloc(size);
   const {bytesRead}=await handle.read(bytes,0,size,0);
   if(bytesRead!==size)throw Error('Staged image changed.');
   if(hash(bytes)!==record.sha256||(await handle.stat()).size!==size)throw Error('Staged image changed.');
   return {...record.descriptor,sha256:record.sha256,bytes};
  }finally{await handle.close();}
 }

 async readManifest(ids:readonly string[]){
  if(ids.length>IMAGE_SEND_MAX_COUNT||new Set(ids).size!==ids.length)throw Error('Use at most four distinct images per send.');
  const images=[];
  let total=0;
  for(const id of ids){
   const image=await this.read(id);
   total+=image.byteLength;
   if(total>IMAGE_SEND_MAX_BYTES)throw Error('Images exceed 15 MiB for this send.');
   images.push(image);
  }
  return images;
 }

 async discard(id:string){
  const record=this.stages.get(id);
  if(!record)return;
  try{
   const file=await this.stagePath(id);
   if(!sameEntry(await lstat(file),record.entry))throw Error('Staged image changed.');
   await unlink(file);
  }catch(error){if(storageErrorCode(error)!=='ENOENT')throw error;}
  finally{clearTimeout(record.timer);this.stages.delete(id);}
 }
}
