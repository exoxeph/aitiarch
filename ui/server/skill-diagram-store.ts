// Managed notebooks stage each Skill preview in private storage. Verified note insertions publish the same bytes under assets/.
// Asset names are content hashes. A separate stage id gives each preview its own file, including previews with identical bytes.
import {createHash,randomBytes} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat,mkdir,open,unlink} from 'node:fs/promises';
import path from 'node:path';
import {resolvePrivateProjectPath} from './project-storage.ts';
import {recoverSkillStages} from './skill-stage-recovery.ts';
import {SKILL_STAGE_PATTERN,SKILL_ASSET_PATTERN,SKILL_DIAGRAM_MAX_BYTES,injectCsp,type SkillDiagramRef} from '../shared/skill-diagram.ts';
const sha=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
export class SkillDiagramStore {
 private root:string;
 private recovery?:Promise<void>;
 constructor(root:string){this.root=root;}
 /** `<root>/assets/<name>`, created if asked, refusing links and anything that is not a plain directory or file. */
 private async confined(name:string,create=false){
  if(!SKILL_ASSET_PATTERN.test(name))throw new Error('Invalid diagram asset name.');
  let target=this.root;
  for(const [i,part] of ['assets',name].entries()){
   target=path.join(target,part);let stat;
   try{stat=await lstat(target);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;if(create&&i===0){await mkdir(target).catch(err=>{if(err.code!=='EEXIST')throw err;});stat=await lstat(target);}else continue;}
   if(stat.isSymbolicLink()||(i===0?!stat.isDirectory():!stat.isFile()||stat.nlink!==1))throw new Error('Linked or invalid diagram path.');
  }
  return target;
 }
 private async write(name:string,bytes:Buffer){
  const file=await this.confined(name,true);
  try{const f=await open(file,'wx',0o600);try{await f.writeFile(bytes);await f.sync();}finally{await f.close();}}
  catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST'||!(await this.read(name)).equals(bytes))throw e;} // the same bytes again is fine
 }
 private async stageFile(asset:string,stage:string,create=false){
  if(!SKILL_ASSET_PATTERN.test(asset)||!SKILL_STAGE_PATTERN.test(stage))throw new Error('Invalid staged diagram reference.');
  const {file:dir,managed}=await resolvePrivateProjectPath(this.root,'skillDiagrams');
  if(!managed)throw new Error('Private diagram storage is unavailable.');
  if(create)await mkdir(dir,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});
  const parent=await lstat(dir);
  if(parent.isSymbolicLink()||!parent.isDirectory())throw new Error('Invalid private diagram directory.');
  return path.join(dir,stage+'-'+asset);
 }
 private async save(asset:string,bytes:Buffer):Promise<SkillDiagramRef>{
  if(!(await resolvePrivateProjectPath(this.root,'skillDiagrams')).managed){
   await this.write(asset,bytes);return {asset,bytes:bytes.length};
  }
  const stage=randomBytes(16).toString('hex'),file=await this.stageFile(asset,stage,true);
  // A lease is written before the stage so a later process can distinguish an interrupted write from a human file.
  this.recovery??=recoverSkillStages(this.root,path.dirname(file)).catch(()=>{});
  await this.recovery;
  const owner=file+'.owner',lease=await open(owner,'wx',0o600);
  try{await lease.writeFile(String(process.pid)+'\n');await lease.sync();}finally{await lease.close();}
  const handle=await open(file,'wx',0o600);
  try{try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}}
  catch(error){await unlink(file).catch(()=>{});throw error;}
  // Retire the write lease before returning a reference. A crash after this point can leave a valid
  // preview, but a later process cannot prove it is safe to delete while the reference may move.
  await unlink(owner);
  return {asset,bytes:bytes.length,stage};
 }
 private async verified(file:string,asset:string){
  const info=await lstat(file);
  if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size>SKILL_DIAGRAM_MAX_BYTES+4096)throw new Error('Invalid diagram asset.');
  // O_NOFOLLOW is platform-dependent. Compare the opened file with the checked entry before reading on every platform.
  const handle=await open(file,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try{
   const opened=await handle.stat();
   if(!opened.isFile()||opened.nlink!==1||opened.dev!==info.dev||opened.ino!==info.ino||opened.size!==info.size)throw new Error('Diagram asset changed.');
   const bytes=Buffer.alloc(info.size);
   const {bytesRead}=await handle.read(bytes,0,bytes.length,0);
   if(bytesRead!==info.size||(await handle.stat()).size!==info.size||sha(bytes)!==SKILL_ASSET_PATTERN.exec(asset)![1])throw new Error('Invalid diagram asset.');
   return bytes;
  }finally{await handle.close();}
 }
 async readPreview(asset:string,stage:string){return this.verified(await this.stageFile(asset,stage),asset);}
 async readForInsertion(ref:SkillDiagramRef){
  if(ref.stage){
   try{return await this.readPreview(ref.asset,ref.stage);}
   catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  }
  return this.read(ref.asset);
 }
 async discard(ref:SkillDiagramRef){
  if(!ref.stage)return;
  try{
   const file=await this.stageFile(ref.asset,ref.stage);
   await this.verified(file,ref.asset);
   await unlink(file);
  }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 }
 async publish(ref:SkillDiagramRef){
  if(!ref.stage)return;
  const bytes=await this.readForInsertion(ref);
  await this.write(ref.asset,bytes);
  await this.discard(ref);
 }
 /** The model's document, with the CSP injected first. The hash is of what is saved, so what is served can be verified. */
 async saveHtml(document:string):Promise<SkillDiagramRef>{
  if(Buffer.byteLength(document)>SKILL_DIAGRAM_MAX_BYTES)throw new Error('The diagram is too large.');
  const bytes=Buffer.from(injectCsp(document),'utf8'),asset=`diagram-${sha(bytes)}.html`;return this.save(asset,bytes);
 }
 /** A stand-alone <svg> exactly as the skill wrote it: no change to a single byte. */
 async saveSvg(svg:string):Promise<SkillDiagramRef>{
  if(Buffer.byteLength(svg)>SKILL_DIAGRAM_MAX_BYTES)throw new Error('The diagram is too large.');
  const bytes=Buffer.from(svg,'utf8'),asset=`diagram-${sha(bytes)}.svg`;return this.save(asset,bytes);
 }
 async read(name:string):Promise<Buffer>{
  return this.verified(await this.confined(name),name);
 }
}
