import * as nodeFs from 'node:fs/promises';
import {constants,type Stats} from 'node:fs';
import path from 'node:path';

export interface InitOptions {project:string;sharing:'private'|'shared';confirmIgnore:boolean|((line:string)=>Promise<boolean>)}
export interface InitResult {root:string;sharing:'private'|'shared';protection:'git-ignored'|'filesystem-private'|'unverified';privatePersistence:boolean;sharedReady:false;created:string[];messages:string[]}
/** Only filesystem operations are injectable: init never discovers a provider or executes Git. */
export type InitFilesystem=Pick<typeof nodeFs,'lstat'|'readFile'|'mkdir'|'writeFile'|'open'>;
const MAX_IGNORE_BYTES=1024*1024;
const errorCode=(e:unknown)=>(e as NodeJS.ErrnoException)?.code;
async function entry(fs:InitFilesystem,file:string):Promise<Stats|null>{
 try{return await fs.lstat(file);}catch(e){if(errorCode(e)==='ENOENT')return null;throw e;}
}
/** Reject links in every existing path component, including Windows junctions. */
async function safePath(fs:InitFilesystem,target:string){
 const base=path.parse(target).root;let current=base;
 for(const part of path.relative(base,target).split(path.sep).filter(Boolean)){
  current=path.join(current,part);const s=await entry(fs,current);
  if(s?.isSymbolicLink())throw Error('Unsafe symbolic link target; init did not follow it.');
  if(current!==target&&s&&!s.isDirectory())throw Error('Unsafe parent directory.');
 }
}
async function regular(fs:InitFilesystem,file:string){
 await safePath(fs,file);const s=await entry(fs,file);
 if(s&&(!s.isFile()||s.nlink!==1))throw Error('Unsafe file target.');return s;
}
async function readIgnore(fs:InitFilesystem,file:string){
 const s=await regular(fs,file);if(!s)return {data:Buffer.alloc(0),stat:null};
 if(s.size>MAX_IGNORE_BYTES)throw Error('Ignore file is too large.');
 const data=await fs.readFile(file);if(data.length>MAX_IGNORE_BYTES)throw Error('Ignore file is too large.');
 const text=new TextDecoder('utf-8',{fatal:true}).decode(data);
 return {data,stat:s,text};
}
const rules=(data:Buffer)=>new TextDecoder('utf-8',{fatal:true}).decode(data).split(/\r?\n/).filter(l=>l.trim()&&!l.startsWith('#'));
// Conservative proof of the rule we wrote, not a general Git pattern interpreter.
// A final anchored directory exclusion cannot be undone by a nested ignore file.
const hasFinalRule=(data:Buffer,line:string)=>rules(data).at(-1)===line;
async function gitProject(fs:InitFilesystem,project:string){
 for(let p=project;;p=path.dirname(p)){
  const marker=path.join(p,'.git'),s=await entry(fs,marker);
  if(s){if(s.isSymbolicLink()||!s.isDirectory()&&!s.isFile())throw Error('Unsafe Git marker.');return true;}
  if(path.dirname(p)===p)return false;
 }
}
async function mergeIgnore(fs:InitFilesystem,file:string,line:string){
 const before=await readIgnore(fs,file);if(hasFinalRule(before.data,line))return;
 const newline=before.data.includes(Buffer.from('\r\n'))?'\r\n':'\n';
 const addition=(before.data.length&&before.data.at(-1)!==10?newline:'')+line+newline;
 if(before.data.length+Buffer.byteLength(addition)>MAX_IGNORE_BYTES)throw Error('Ignore file is too large.');
 await safePath(fs,file);
 // O_NOFOLLOW is unavailable on some Windows versions; handle identity + nlink
 // checks still reject a replaced target instead of appending through a link.
 const handle=await fs.open(file,before.stat?constants.O_WRONLY|constants.O_APPEND|(constants.O_NOFOLLOW??0):'wx',0o600);
 try{
  const opened=await handle.stat();if(!opened.isFile()||opened.nlink!==1)throw Error('Unsafe ignore handle.');
  if(before.stat&&(opened.dev!==before.stat.dev||opened.ino!==before.stat.ino||opened.size!==before.stat.size||opened.mtimeMs!==before.stat.mtimeMs))throw Error('Ignore file changed; no append made.');
  await handle.writeFile(addition);await handle.sync();
 }finally{await handle.close();}
 const verified=await readIgnore(fs,file);if(!hasFinalRule(verified.data,line))throw Error('Ignore rule could not be verified.');
}

export async function initProject(options:InitOptions,fs:InitFilesystem=nodeFs):Promise<InitResult>{
 if(!options||typeof options.project!=='string'||!options.project.trim()||!['private','shared'].includes(options.sharing)||typeof options.confirmIgnore!=='boolean'&&typeof options.confirmIgnore!=='function')throw Error('Invalid init options.');
 const project=path.resolve(options.project),root=path.join(project,'.aitiarch');
 await safePath(fs,project);if(!(await entry(fs,project))?.isDirectory())throw Error('Project folder must already exist.');
 const directories=[root,...['ink','decisions','local'].map(d=>path.join(root,d))],localIgnore=path.join(root,'local','.gitignore'),welcome=path.join(root,'Welcome.md');
 // Validate all targets before creating anything. Existing notes are never read.
 for(const directory of directories){await safePath(fs,directory);const s=await entry(fs,directory);if(s&&!s.isDirectory())throw Error('Unsafe notebook directory target.');}
 await regular(fs,welcome);await regular(fs,localIgnore);
 const inGit=await gitProject(fs,project),ignore=path.join(project,'.gitignore');if(inGit)await regular(fs,ignore);
 const result:InitResult={root,sharing:options.sharing,protection:inGit?'unverified':'filesystem-private',privatePersistence:false,sharedReady:false,created:[],messages:[]};
 if(options.sharing==='shared')result.messages.push('Shared mode is not ready until slice 9 moves private writers into local/. Saved threads can contain sensitive text; secret exclusion is not retroactive redaction. Do not publish this folder yet.');
 let ignoreVerified=!inGit;
 if(inGit){
  const line=options.sharing==='private'?'/.aitiarch/':'/.aitiarch/local/';
  try{
   const existing=await readIgnore(fs,ignore);
   const consent=hasFinalRule(existing.data,line)|| (typeof options.confirmIgnore==='function'?await options.confirmIgnore(line):options.confirmIgnore);
   if(consent){await mergeIgnore(fs,ignore,line);ignoreVerified=true;result.protection='git-ignored';}
  }catch{result.messages.push('The ignore rule could not be written or verified.');}
 }
 for(const directory of directories){
  await safePath(fs,directory);
  try{await fs.mkdir(directory,{mode:0o700});result.created.push(path.relative(project,directory));}
  catch(e){if(errorCode(e)!=='EEXIST')throw e;if(!(await entry(fs,directory))?.isDirectory())throw Error('Unsafe notebook directory target.');await safePath(fs,directory);}
 }
 const create=async(file:string,data:string)=>{
  await regular(fs,file);
  try{await fs.writeFile(file,data,{flag:'wx',mode:0o600});result.created.push(path.relative(project,file));}
  catch(e){if(errorCode(e)!=='EEXIST')throw e;await regular(fs,file);}
 };
 await create(localIgnore,'*\n');
 const local=await readIgnore(fs,localIgnore),localSafe=rules(local.data).join('\n')==='*';
 if(!localSafe)result.messages.push('Existing local/.gitignore was preserved, but its private ignore rule could not be verified.');
 if(!await entry(fs,welcome)){
  const guide=await fs.readFile(new URL('../../docs/guide.md',import.meta.url),'utf8');
  if(guide.length>16000)throw Error('Welcome guide is too large.');
  const content=guide.split(/^## Welcome\r?\n/m)[1]?.split(/\r?\n## /)[0]?.trim();if(!content)throw Error('Welcome guide is unavailable.');
  await create(welcome,content+'\n');
 }
 result.privatePersistence=ignoreVerified&&localSafe&&options.sharing==='private';
 result.messages.push(inGit?result.protection==='git-ignored'?'Required ignore rule verified (this does not untrack previously committed files).':'No Git ignore protection verified.':'filesystem-private: no Git repository detected; no Git protection claimed.');
 if(!result.privatePersistence)result.messages.push('Private persistence is disabled for this init result. No private writer was started.');
 result.messages.push('Existing files were preserved. No Git commands or provider calls were run.');
 return result;
}
