import {createHash,randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {repoDenied} from '../../shared/harness.ts';
import {redact} from '../../shared/redact.ts';
import {privateWriteTemp} from '../private-write-temp.ts';
import type {ReviewedCodexSkill} from '../../shared/invocation.ts';
import type {SkillBlock} from '../../shared/instruction.ts';
import {SETUP_ROLES, type SetupRole} from '../../shared/setup.ts';
import {isCodexSkillRole,type CodexSkillClassification,type CodexSkillMetadata,type CodexSkillStatus} from '../../shared/codex-skills.ts';
import {assertStoragePath, resolveProjectStorage, storageEntry} from '../project-storage.ts';

const MAX_SKILL_BYTES=32*1024;
const MAX_CONSENT_BYTES=128*1024;
const MAX_CANDIDATES=256;
const MAX_SKILL_CHARACTERS=2048;
const MAX_ENABLED=8;
export const CONFIRM_CODEX_SKILLS='Confirm the reviewed Codex skills before sending.';
export const codexSkillRoots=(home:string,project:string,codexHome=path.join(home,'.codex'))=>
 [path.join(codexHome,'skills'),path.join(home,'.agents','skills'),path.join(project,'.agents','skills')];
const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const isHash=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const safeName=(name:string)=>/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(name)&&
 !/^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(name)&&!repoDenied(name);

export const NATIVE_SKILL_UNAVAILABLE='Native skill and plugin execution is unavailable. Only separately reviewed instruction text can be approved.';
const reasons:Record<CodexSkillClassification,string>={
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

const frontmatter=/^\uFEFF?---\r?\n([\s\S]{1,4096}?)\r?\n---(?:\r?\n|$)/;
function metadata(text:string){
 const header=frontmatter.exec(text);
 if(!header||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(text))return null;
 const fields=new Map<string,string>();
 for(const line of header[1].split(/\r?\n/)){
  const field=/^(name|description|classification):[ \t]+([^\r\n]+)$/.exec(line);
  if(!field||fields.has(field[1]))return null;
  fields.set(field[1],field[2].trim());
 }
 const name=fields.get('name'),description=fields.get('description'),declared=fields.get('classification');
 if(!name||!safeName(name)||!description||description.length>400)return null;
 const classification:CodexSkillClassification=declared==='read-only'||declared==='writes'||declared==='network'||declared==='shell'
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
async function examine(folder:string,name:string,take?:TakeInstructions):Promise<CodexSkillMetadata>{
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
  const item={...parsed,pathHash,contentHash:hash(JSON.stringify([digest,revision])),reason:reasons[parsed.classification]};
  if(parsed.classification==='read-only')take?.(item,bytes);
  return item;
 }catch{return unavailable('The skill file is missing, inaccessible, linked or oversized.');}
}

/** Explicit local roots only. Callers choose the installed roots, never a client-supplied path. */
type TakeInstructions=(item:CodexSkillMetadata,bytes:Buffer)=>void;
export function discoverCodexSkills(roots:readonly string[]){return scan(roots);}
async function scan(roots:readonly string[],take?:TakeInstructions):Promise<CodexSkillMetadata[]>{
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
    const item=await examine(path.join(folder,entry.name),entry.name,take);
    found.set(item.pathHash,item);
   }
  }catch{/* No installed entries from an inaccessible or unsafe root. */}
  if(visited>MAX_CANDIDATES)break;
 }
 return [...found.values()].sort((a,b)=>a.name.localeCompare(b.name)||a.pathHash.localeCompare(b.pathHash));
}

type SkillRoleKey={role:SetupRole;pathHash:string};
type Approval=SkillRoleKey&{contentHash:string;classification:'read-only';generation?:string};
type Consent=Approval|(SkillRoleKey&{needsReapproval:true});
const isApproval=(item:Consent):item is Approval=>'contentHash' in item;
const isRole=(value:unknown):value is SetupRole=>SETUP_ROLES.some(role=>role===value);
const isConsent=(value:unknown):value is Consent=>{
 if(!value||typeof value!=='object')return false;
 const item=value as Record<string,unknown>,keys=Object.keys(item);
 if(!isRole(item.role)||!isHash(item.pathHash))return false;
 if(item.needsReapproval===true)return keys.every(key=>['role','pathHash','needsReapproval'].includes(key));
 return keys.every(key=>['role','pathHash','contentHash','classification','generation'].includes(key))&&
  isHash(item.contentHash)&&item.classification==='read-only'&&(item.generation===undefined||isHash(item.generation));
};
const writes=new Map<string,Promise<Consent[]>>();

export class CodexSkillConsent {
 private readonly notebook:string;
 private readonly roots:readonly string[];
 constructor(notebook:string,roots:readonly string[]){
  this.notebook=notebook;
  this.roots=[...roots];
 }

 inventory(){return discoverCodexSkills(this.roots);}

 async status({clearChanged=true}={}):Promise<CodexSkillStatus>{
  const [inventory,layout]=await Promise.all([this.inventory(),resolveProjectStorage(this.notebook)]);
  let records=layout.ok?await this.read(layout.privatePaths.codexSkillConsent):[];
  const byPath=new Map(inventory.map(skill=>[skill.pathHash,skill]));
  const outdated=(item:Consent)=>{
   const skill=byPath.get(item.pathHash);
   return isApproval(item)&&(!skill||skill.classification!=='read-only'||skill.contentHash!==item.contentHash);
  };
  if(layout.ok&&clearChanged&&records.some(outdated)){
   // Only revoke the records in this scan. A concurrent explicit approval of
   // fresh bytes is a different record and must survive this reconciliation.
   const stale=new Set(records.filter(outdated).map(item=>JSON.stringify(item)));
   records=await this.update(async items=>items.map(item=>stale.has(JSON.stringify(item))
    ?{role:item.role,pathHash:item.pathHash,needsReapproval:true}:item));
  }
  const skills=inventory.map(skill=>{
   const related=records.filter(item=>item.pathHash===skill.pathHash);
   return {...skill,approvedRoles:related.filter(item=>isApproval(item)&&!outdated(item)).map(item=>item.role),
    changedRoles:related.filter(item=>!isApproval(item)||outdated(item)).map(item=>item.role)};
  });
  return {skills,nativeUnavailable:NATIVE_SKILL_UNAVAILABLE,...(layout.ok?{}:{storageReason:'Skill approvals need a notebook with private local storage.'})};
 }

 async reviewed(role:SetupRole){
  const block:SkillBlock={text:'',loaded:[],skipped:[],truncated:false};
  const skills:ReviewedCodexSkill[]=[];
  const layout=await resolveProjectStorage(this.notebook);
  if(!layout.ok)return {block,skills,key:''};
  const approvals=(await this.read(layout.privatePaths.codexSkillConsent)).filter(isApproval).filter(item=>item.role===role);
  if(!approvals.length)return {block,skills,key:''};
  if(approvals.length>MAX_ENABLED)throw Error('Too many approved Codex skills.');
  const sections=new Map<string,{text:string;item:ReviewedCodexSkill;generation:string}>();
  await scan(this.roots,(item,bytes)=>{
   const approved=approvals.find(a=>a.pathHash===item.pathHash&&a.contentHash===item.contentHash);
   if(!approved)return;
   const source=bytes.toString('utf8').replace(frontmatter,'');
   // No linked files are ever read. Also suppress lines naming secret-file paths.
   const safe=source.split(/\r?\n/).map(line=>line.split(/[\s`"'<>()[\]{};,]+/).some(word=>word&&repoDenied(word.replace(/\\/g,'/')))
     ?'[Excluded secret-file reference]':line).join('\n');
   const clean=redact(safe).trim();
   const text=clean.slice(0,MAX_SKILL_CHARACTERS);
   sections.set(item.pathHash,{text,item:{name:item.name,pathHash:item.pathHash,contentHash:approved.contentHash,
    classification:'read-only',truncated:clean.length>text.length},generation:approved.generation??approved.contentHash});
  });
  const ordered=[...sections.values()].sort((a,b)=>a.item.pathHash.localeCompare(b.item.pathHash));
  for(const {text,item} of ordered){
   skills.push(item);
   block.loaded.push({id:item.pathHash,name:item.name,chars:text.length,tokens:Math.ceil(text.length/4),truncated:item.truncated,files:[]});
  }
  block.truncated=skills.some(item=>item.truncated);
  block.text=ordered.map(({text,item})=>'## Codex skill: '+item.name+'\n'+text+(item.truncated?'\n[Skill text truncated]':'')).join('\n\n');
  return {block,skills,key:ordered.length?hash(JSON.stringify(ordered.map(({item,generation})=>[item,generation]))):''};
 }

 async matchReview(role:SetupRole,key:string){
  const current=await this.reviewed(role);
  if(current.key!==key)throw Error('The approved Codex skills changed. Review again before sending.');
  return current;
 }

 async enabled(role:SetupRole){
  const layout=await resolveProjectStorage(this.notebook);
  if(!layout.ok)return [];
  const [inventory,approvals]=await Promise.all([discoverCodexSkills(this.roots),this.read(layout.privatePaths.codexSkillConsent)]);
  return inventory.filter(skill=>skill.classification==='read-only'&&approvals.some(item=>
   isApproval(item)&&item.role===role&&item.pathHash===skill.pathHash&&item.contentHash===skill.contentHash));
 }

 async approve(role:SetupRole,pathHash:string,contentHash:string){
  if(!isCodexSkillRole(role)||!isHash(pathHash)||!isHash(contentHash))throw Error('Invalid skill consent.');
  await this.update(async approvals=>{
   const skill=(await discoverCodexSkills(this.roots)).find(item=>item.pathHash===pathHash);
   if(!skill||skill.contentHash!==contentHash)throw Error('The installed skill changed. Review it again.');
   if(skill.classification!=='read-only')throw Error(skill.reason);
   const next=approvals.filter(item=>item.role!==role||item.pathHash!==pathHash);
   if(next.filter(item=>item.role===role&&isApproval(item)).length>=MAX_ENABLED)throw Error('Approve at most eight skills for one role.');
   return [...next,{role,pathHash,contentHash,classification:'read-only',generation:hash(randomUUID())}];
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
   const updated=await change(await this.read(file));
   const next=JSON.stringify(updated)+'\n';
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
    return updated;
   }finally{
    if(created)await fs.unlink(staging).catch(()=>{});
   }
  });
  writes.set(key,pending);
  try{return await pending;}finally{if(writes.get(key)===pending)writes.delete(key);}
 }
}
