import {mkdir,mkdtemp,readFile,readdir,realpath,rename,writeFile,symlink} from 'node:fs/promises';
import {createHash,randomBytes} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {crc32,deflateSync} from 'node:zlib';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {resolveProjectStorage} from '../server/project-storage.ts';
import {ImageStore} from '../server/image-store.ts';
import {createApp} from '../server/http.ts';
import {Store} from '../server/store.ts';
import {NoteWatcher} from '../server/watch.ts';

const signature=Buffer.from('89504e470d0a1a0a','hex');
function chunk(type:string,data:Buffer){
 const buf=Buffer.alloc(data.length+12);
 buf.writeUInt32BE(data.length);
 buf.write(type,4);
 data.copy(buf,8);
 buf.writeUInt32BE(crc32(buf.subarray(4,-4)),buf.length-4);
 return buf;
}
function png({width=1,height=1,pixels=Buffer.from([0,0,0,0,255]),extra=[] as Buffer[],tail=Buffer.alloc(0)}={}){
 const header=Buffer.alloc(13);
 header.writeUInt32BE(width);
 header.writeUInt32BE(height,4);
 header[8]=8;
 header[9]=6;
 return Buffer.concat([signature,chunk('IHDR',header),...extra,chunk('IDAT',Buffer.concat([deflateSync(pixels),tail])),chunk('IEND',Buffer.alloc(0))]);
}

let root:string;
let directory:string;
const stagedName=(id:string)=>`stage-${process.pid}-${id}.png`;
beforeEach(async()=>{
 const work=await mkdtemp(path.join(await realpath(os.tmpdir()),'aitiarch-images-'));
 const config=path.join(work,'config');
 await mkdir(config);
 vi.stubEnv('AITIARCH_CONFIG_DIR',config);
 root=path.join(work,'.aitiarch');
 directory=path.join(root,'local','images');
});
afterEach(()=>vi.unstubAllEnvs());

it('stages only decoded-shape PNG data, strips metadata, and keeps the bytes under local',async()=>{
 expect((await resolveProjectStorage(root,{create:true})).ok).toBe(true);
 const images=new ImageStore(root);
 const sentinel='synthetic-private-exif-sentinel';
 const bytes=png({extra:[chunk('eXIf',Buffer.from(sentinel))]});
 const descriptor=await images.stage(bytes);
 const loaded=await images.read(descriptor.id);
 expect(descriptor).toEqual({id:expect.stringMatching(/^[a-f0-9]{32}$/),mime:'image/png',width:1,height:1,byteLength:loaded.bytes.length});
 expect(loaded.bytes).toEqual(png());
 expect(loaded.sha256).toBe(createHash('sha256').update(png()).digest('hex'));
 expect(await readFile(path.join(directory,stagedName(descriptor.id)))).toEqual(png());
 expect(await readdir(root)).toEqual(['.local-storage-v1','local']);
 await images.discard(descriptor.id);
 expect(await readdir(directory)).toEqual([]);
});

it('rejects spoofing, animation, oversize inputs, pixel bombs, trailing data and invalid scanlines before writing',async()=>{
 await resolveProjectStorage(root,{create:true});
 const images=new ImageStore(root);
 for(const invalid of [
  Buffer.from('not a PNG'),Buffer.alloc(5*1024*1024+1),png({width:4001,height:4000}),
  png({extra:[chunk('acTL',Buffer.alloc(8))]}),png({pixels:Buffer.alloc(6)}),
  png({pixels:Buffer.from([5,0,0,0,0])}),Buffer.concat([png(),Buffer.from('trailer')]),png({tail:Buffer.from('extra zlib input')}),
 ])await expect(images.stage(invalid)).rejects.toThrow();
 expect(await readdir(path.join(root,'local'))).not.toContain('images');
});

it('fails closed for legacy roots, foreign IDs, traversal and tampered stages',async()=>{
 await mkdir(root);
 await expect(new ImageStore(root).stage(png())).rejects.toThrow(/legacy|unsupported/i);
 expect(await readdir(root)).toEqual([]);
 root=path.join(path.dirname(root),'managed','.aitiarch');
 await mkdir(path.dirname(root));
 await resolveProjectStorage(root,{create:true});
 const images=new ImageStore(root);
 const staged=await images.stage(png());
 await expect(new ImageStore(root).read(staged.id)).rejects.toThrow();
 await expect(images.read('../'+staged.id)).rejects.toThrow();
 const file=path.join(root,'local','images',stagedName(staged.id));
 await writeFile(file,png({pixels:Buffer.from([0,255,0,0,255])}));
 await expect(images.read(staged.id)).rejects.toThrow(/changed/i);
});

it('refuses linked destinations and expires only stages that it owns',async()=>{
 await resolveProjectStorage(root,{create:true});
 const elsewhere=path.join(path.dirname(root),'outside');
 await mkdir(elsewhere);
 await symlink(elsewhere,directory,process.platform==='win32'?'junction':'dir');
 await expect(new ImageStore(root).stage(png())).rejects.toThrow();
 expect(await readdir(elsewhere)).toEqual([]);
 await rename(directory,directory+'-fixture-link');
 let now=0;
 const images=new ImageStore(root,()=>now);
 const expired=await images.stage(png());
 const original=path.join(directory,'original.png');
 await writeFile(original,png());
 now=24*60*60*1000;
 await expect(images.read(expired.id)).rejects.toThrow(/expired/i);
 expect(await readdir(directory)).toEqual(['original.png']);
});

it('recovers only owned image files from a dead process on restart',async()=>{
 await resolveProjectStorage(root,{create:true});
 await mkdir(directory);
 const owner=12345;
 const deadStage=`stage-${owner}-${'a'.repeat(32)}.png`;
 const deadCopy=`delivery-${owner}-${'b'.repeat(32)}.png`;
 const kept=[`stage-${process.pid}-${'c'.repeat(32)}.png`,`${'d'.repeat(32)}.png`,'original.png'];
 for(const name of [deadStage,deadCopy,...kept])await writeFile(path.join(directory,name),'Synthetic partial image');
 const store=new ImageStore(root,Date.now,pid=>pid!==owner);
 await store.recoverAbandoned();
 expect((await readdir(directory)).sort()).toEqual(kept.sort());
});

it('bounds the exact manifest by distinct IDs and total processed bytes',async()=>{
 await resolveProjectStorage(root,{create:true});
 const images=new ImageStore(root);
 const width=1024,height=1024,stride=1+4*width;
 const pixels=randomBytes(stride*height);
 for(let i=0;i<pixels.length;i+=stride)pixels[i]=0;
 const input=png({width,height,pixels}),ids=[];
 for(let i=0;i<4;i++)ids.push((await images.stage(input)).id);
 expect((await images.readManifest(ids.slice(0,3))).map(image=>image.id)).toEqual(ids.slice(0,3));
 await expect(images.readManifest(ids)).rejects.toThrow(/15 MiB/);
 await expect(images.readManifest([ids[0],ids[0]])).rejects.toThrow(/distinct/);
 await expect(images.readManifest([...ids,'extra'])).rejects.toThrow(/four/);
 for(const id of ids)await images.discard(id);
});

it('keeps a staged image inaccessible through the generic note and static routes',async()=>{
 await resolveProjectStorage(root,{create:true});
 const distDir=path.join(path.dirname(root),'dist');
 await mkdir(distDir);
 await writeFile(path.join(distDir,'index.html'),'Synthetic UI');
 const images=new ImageStore(root);
 const {id}=await images.stage(png());
 const store=await Store.open(root);
 const app=createApp({store,watcher:new NoteWatcher(store),distDir,pipelineConfigDir:process.env.AITIARCH_CONFIG_DIR,skillRoots:[]});
 try{
  const base='http://127.0.0.1:'+await app.listen(0);
  const cookie=(await fetch(base+'/api/session')).headers.get('set-cookie')!.split(';')[0];
  const privatePath='local/images/'+stagedName(id);
  for(const url of ['/api/file?path='+encodeURIComponent(privatePath),'/'+privatePath]){
   const response=await fetch(base+url,{headers:{cookie}});
   expect(response.status,url).toBe(404);
  }
 }finally{await app.close();await images.discard(id);}
});
