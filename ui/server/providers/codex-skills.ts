import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {repoDenied} from '../../shared/harness.ts';
import {redact} from '../../shared/redact.ts';
import {privateWriteTemp} from '../private-write-temp.ts';
import {SETUP_ROLES, type SetupRole} from '../../shared/setup.ts';
import {assertStoragePath, resolveProjectStorage, storageEntry} from '../project-storage.ts';

const MAX_SKILL_BYTES=32*1024;
const MAX_CONSENT_BYTES=128*1024;
const MAX_CANDIDATES=256;
const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const isHash=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const safeName=(name:string)=>/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(name)&&
 !/^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(name)&&!repoDenied(name);

export const NATIVE_SKILL_UNAVAILABLE='Native skill and plugin execution is unavailable. Only separately reviewed instruction text can be approved.';
type Classification='read-only'|'writes'|'network'|'shell'|'needs review';
export interface CodexSkillMetadata {
 readonly name:string;
 readonly description:string;
 readonly pathHash:string;
 readonly contentHash:string|null;
 readonly classification:Classification;
 readonly reason:string;
}
const reasons:Record<Classification,string>={
 'read-only':'Instruction text only. The skill cannot run tools or read files.',
 writes:'This skill declares writes. Write access is unavailable.',
 network:'This skill declares network access. Network access is unavailable.',
 shell:'This skill declares shell access. Shell access is unavailable.',
 'needs review':'The skill must declare a recognized classification before it can be reviewed.',
};

/** Read a regular single-link file to a fixed bound, including when it grows during the read. */
async function readBounded(file:string,limit:number){
 await assertStoragePath(fs,file);
 const info=await fs.lstat(file);
 if(!info.isFile()||info.nlink!==1||info.size>limit)throw Error('Unsafe or oversized file.');
 const handle=await fs.open(file,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
 try{
  const opened=await handle.stat();
  if(!opened.isFile()||opened.nlink!==1||opened.ino!==info.ino||opened.dev!==info.dev)throw Error('The file changed.');
  const buffer=Buffer.alloc(limit+1);
  let size=0;
  while(size<buffer.length){
   const {bytesRead}=await handle.read(buffer,size,buffer.length-size,null);
   if(!bytesRead)break;
   size+=bytesRead;
  }
  await assertStoragePath(fs,file);
  const current=await fs.lstat(file);
  if(size>limit||size!==current.size||current.nlink!==1||current.ino!==opened.ino||current.dev!==opened.dev||
   current.mtimeMs!==opened.mtimeMs||current.ctimeMs!==opened.ctimeMs)throw Error('The file changed or exceeded its size limit.');
  return {bytes:buffer.subarray(0,size),revision:[current.dev,current.ino,current.mtimeMs,current.ctimeMs]};
 }finally{await handle.close();}
}

function metadata(text:string){
 const header=/^\uFEFF?---\r?\n([\s\S]{1,4096}?)\r?\n---(?:\r?\n|$)/.exec(text);
 if(!header||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(text))return null;
 const fields=new Map<string,string>();
 for(const line of header[1].split(/\r?\n/)){
  const field=/^(name|description|classification):[ \t]+([^\r\n]+)$/.exec(line);
  if(!field||fields.has(field[1]))return null;
  fields.set(field[1],field[2].trim());
 }
 const name=fields.get('name'),description=fields.get('description'),declared=fields.get('classification');
 if(!name||!safeName(name)||!description||description.length>400)return null;
 const classification:Classification=declared==='read-only'||declared==='writes'||declared==='network'||declared==='shell'
  ?declared:'needs review';
 return {name,description:redact(description),classification};
}

const parsedByDigest=new Map<string,ReturnType<typeof metadata>>();

function cachedMetadata(bytes:Buffer){
 const digest=hash(bytes);
 let parsed=parsedByDigest.get(digest);
 if(parsed===undefined){
  parsed=metadata(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  if(parsedByDigest.size>=MAX_CANDIDATES)parsedByDigest.clear();
  parsedByDigest.set(digest,parsed);
 }
 return {digest,parsed};
}
async function examine(folder:string,name:string):Promise<CodexSkillMetadata>{
 const idPath=process.platform==='win32'?folder.toLowerCase():folder;
 const pathHash=hash(idPath);
 const unavailable=(reason:string):CodexSkillMetadata=>({name,description:'',pathHash,contentHash:null,classification:'needs review',reason});
 try{
  await assertStoragePath(fs,folder);
  if(!(await fs.lstat(folder)).isDirectory())return unavailable('The skill is not a local folder.');
  for await(const entry of await fs.opendir(folder)){
   if(entry.name!=='SKILL.md'||!entry.isFile())return unavailable('Additional files or dependencies need review. Only a standalone SKILL.md is supported.');
  }
  const {bytes,revision}=await readBounded(path.join(folder,'SKILL.md'),MAX_SKILL_BYTES);
  const {parsed,digest}=cachedMetadata(bytes);
  if(!parsed)return unavailable('The skill metadata is malformed or contains unsupported fields.');
  return {...parsed,pathHash,contentHash:hash(JSON.stringify([digest,revision])),reason:reasons[parsed.classification]};
 }catch{return unavailable('The skill file is missing, inaccessible, linked or oversized.');}
}

/** Explicit local roots only. Callers choose the installed roots, never a client-supplied path. */
export async function discoverCodexSkills(roots:readonly string[]):Promise<CodexSkillMetadata[]>{
 const found=new Map<string,CodexSkillMetadata>();
 let visited=0;
 for(const root of roots.slice(0,16)){
  if(!path.isAbsolute(root)||root.startsWith('\\\\')||path.resolve(root)===path.parse(root).root)continue;
  const folder=path.resolve(root);
  try{
   await assertStoragePath(fs,folder);
   for await(const entry of await fs.opendir(folder)){
    if(++visited>MAX_CANDIDATES)break;
    if(!safeName(entry.name)||!entry.isDirectory()&&!entry.isSymbolicLink())continue;
    const item=await examine(path.join(folder,entry.name),entry.name);
    found.set(item.pathHash,item);
   }
  }catch{/* No installed entries from an inaccessible or unsafe root. */}
  if(visited>MAX_CANDIDATES)break;
 }
 return [...found.values()].sort((a,b)=>a.name.localeCompare(b.name)||a.pathHash.localeCompare(b.pathHash));
}

type Consent={role:SetupRole;pathHash:string;contentHash:string;classification:'read-only'};
const isRole=(value:unknown):value is SetupRole=>SETUP_ROLES.some(role=>role===value);
const isConsent=(value:unknown):value is Consent=>{
 if(!value||typeof value!=='object'||Object.keys(value).length!==4)return false;
 const item=value as Partial<Consent>;
 return isRole(item.role)&&isHash(item.pathHash)&&isHash(item.contentHash)&&item.classification==='read-only';
};
const writes=new Map<string,Promise<void>>();

export class CodexSkillConsent {
 private readonly notebook:string;
 private readonly roots:readonly string[];
 constructor(notebook:string,roots:readonly string[]){
  this.notebook=notebook;
  this.roots=[...roots];
 }

 async enabled(role:SetupRole){
  const layout=await resolveProjectStorage(this.notebook);
  if(!layout.ok)return [];
  const [inventory,approvals]=await Promise.all([discoverCodexSkills(this.roots),this.read(layout.privatePaths.codexSkillConsent)]);
  return inventory.filter(skill=>skill.classification==='read-only'&&approvals.some(item=>
   item.role===role&&item.pathHash===skill.pathHash&&item.contentHash===skill.contentHash));
 }

 async approve(role:SetupRole,pathHash:string,contentHash:string){
  if(!isRole(role)||!isHash(pathHash)||!isHash(contentHash))throw Error('Invalid skill consent.');
  await this.update(async approvals=>{
   const skill=(await discoverCodexSkills(this.roots)).find(item=>item.pathHash===pathHash);
   if(!skill||skill.contentHash!==contentHash)throw Error('The installed skill changed. Review it again.');
   if(skill.classification!=='read-only')throw Error(skill.reason);
   return [...approvals.filter(item=>item.role!==role||item.pathHash!==pathHash),{role,pathHash,contentHash,classification:'read-only'}];
  });
 }

 async revoke(role:SetupRole,pathHash:string){
  if(!isRole(role)||!isHash(pathHash))throw Error('Invalid skill consent.');
  await this.update(approvals=>approvals.filter(item=>item.role!==role||item.pathHash!==pathHash));
 }

 private async read(file:string):Promise<Consent[]>{
  try{
   if(!await storageEntry(fs,file))return [];
   const {bytes}=await readBounded(file,MAX_CONSENT_BYTES);
   const value:unknown=JSON.parse(bytes.toString('utf8'));
   if(!Array.isArray(value)||!value.every(isConsent))throw Error('Invalid consent record.');
   return value;
  }catch{throw Error('Private skill consent could not be read.');}
 }

 private async update(change:(items:Consent[])=>Consent[]|Promise<Consent[]>){
  const layout=await resolveProjectStorage(this.notebook);
  if(!layout.ok)throw Error(layout.reason);
  const file=layout.privatePaths.codexSkillConsent;
  const key=process.platform==='win32'?file.toLowerCase():file;
  const pending=(writes.get(key)??Promise.resolve()).catch(()=>{}).then(async()=>{
   const checked=await resolveProjectStorage(this.notebook);
   if(!checked.ok)throw Error(checked.reason);
   const next=JSON.stringify(await change(await this.read(file)))+'\n';
   if(Buffer.byteLength(next)>MAX_CONSENT_BYTES)throw Error('Private skill consent exceeds its size limit.');
   const staging=await privateWriteTemp(file,true);
   let created=false;
   try{
    await assertStoragePath(fs,staging);
    const handle=await fs.open(staging,'wx',0o600);
    created=true;
    try{await handle.writeFile(next);await handle.sync();}finally{await handle.close();}
    const verified=await resolveProjectStorage(this.notebook);
    if(!verified.ok)throw Error(verified.reason);
    await fs.rename(staging,file);
   }finally{
    if(created)await fs.unlink(staging).catch(()=>{});
   }
  });
  writes.set(key,pending);
  try{await pending;}finally{if(writes.get(key)===pending)writes.delete(key);}
 }
}
