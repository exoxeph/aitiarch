import * as nodeFs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {assertStoragePath as safePath,hasGitMarker as gitProject,resolveProjectStorage,storageEntry as entry,storageErrorCode as errorCode} from './project-storage.ts';

export interface InitOptions {project:string;sharing:'private'|'shared';confirmIgnore:boolean|((line:string)=>Promise<boolean>);newOnly?:boolean}
export class AlreadyInitialized extends Error {constructor(){super('This folder already has a .aitiarch notebook.');}}
export interface InitResult {root:string;sharing:'private'|'shared';protection:'git-ignored'|'filesystem-private'|'unverified';privatePersistence:boolean;privateLocation:string|null;sharedReady:false;created:string[];messages:string[]}
/** Filesystem operations can be injected. Git checks are read-only and init never discovers a provider. */
export type InitFilesystem=Pick<typeof nodeFs,'lstat'|'readFile'|'mkdir'|'writeFile'|'open'>;
const MAX_IGNORE_BYTES=1024*1024;
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
/** Read-only preview for an already-open project. Never create init targets here. */
export async function privateProtection(project:string,fs:InitFilesystem=nodeFs):Promise<Pick<InitResult,'protection'|'sharedReady'|'messages'>>{
 let protection:InitResult['protection']='unverified';
 try{
  if(!await gitProject(fs,project))protection='filesystem-private';
  else if(hasFinalRule((await readIgnore(fs,path.join(project,'.gitignore'))).data,'/.aitiarch/'))protection='git-ignored';
 }catch{/* A failed check cannot establish protection. */}
 return {protection,sharedReady:false,messages:[protectionMessage(protection)]};
}
function protectionMessage(protection:InitResult['protection']){
 if(protection==='git-ignored')return 'Required ignore rule verified (this does not untrack previously committed files).';
 if(protection==='filesystem-private')return 'filesystem-private: no Git repository detected; no Git protection claimed.';
 return 'No Git ignore protection verified.';
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
 const result:InitResult={root,sharing:options.sharing,protection:inGit?'unverified':'filesystem-private',privatePersistence:false,privateLocation:null,sharedReady:false,created:[],messages:[]};
 let layout=await resolveProjectStorage(root,{create:true,fs});
 if(options.newOnly&&!layout.created.includes(root))throw new AlreadyInitialized();
 result.created.push(...layout.created.map(file=>path.relative(project,file)));
 if(!layout.ok&&layout.code!=='git-unverified'&&!layout.created.includes(root)){
  result.messages.push(layout.reason,protectionMessage(result.protection),'Private persistence is disabled. Existing files were preserved.');
  return result;
 }
 if(options.sharing==='shared')result.messages.push('Shared mode is not ready until all private writers use the local/ layout. Saved threads can contain sensitive text; secret exclusion is not retroactive redaction. Do not publish this folder yet.');
 let ignoreVerified=!inGit;
 if(inGit){
  const line=options.sharing==='private'?'/.aitiarch/':'/.aitiarch/local/';
  try{
   const existing=await readIgnore(fs,ignore);
   const consent=hasFinalRule(existing.data,line)|| (typeof options.confirmIgnore==='function'?await options.confirmIgnore(line):options.confirmIgnore);
   if(consent){
    await mergeIgnore(fs,ignore,line);
    layout=await resolveProjectStorage(root,{fs});
    ignoreVerified=layout.ok;
    if(ignoreVerified)result.protection='git-ignored';
   }
  }catch{result.messages.push('The ignore rule could not be written or verified.');}
 }
 if(layout.ok)result.privateLocation=layout.local;
 else {
  result.protection=inGit?'unverified':'filesystem-private';
  result.messages.push(layout.reason);
 }
 for(const directory of directories.slice(1,-1)){
  await safePath(fs,directory);
  try{await fs.mkdir(directory,{mode:0o700});result.created.push(path.relative(project,directory));}
  catch(e){if(errorCode(e)!=='EEXIST')throw e;if(!(await entry(fs,directory))?.isDirectory())throw Error('Unsafe notebook directory target.');await safePath(fs,directory);}
 }
 const create=async(file:string,data:string)=>{
  await regular(fs,file);
  try{await fs.writeFile(file,data,{flag:'wx',mode:0o600});result.created.push(path.relative(project,file));}
  catch(e){if(errorCode(e)!=='EEXIST')throw e;await regular(fs,file);}
 };
 if(!await entry(fs,welcome)){
  const guide=await fs.readFile(new URL('../../docs/guide.md',import.meta.url),'utf8');
  if(guide.length>16000)throw Error('Welcome guide is too large.');
  const content=guide.split(/^## Welcome\r?\n/m)[1]?.split(/\r?\n## /)[0]?.trim();if(!content)throw Error('Welcome guide is unavailable.');
  await create(welcome,content+'\n');
 }
 result.privatePersistence=ignoreVerified&&layout.ok&&options.sharing==='private';
 result.messages.push(protectionMessage(result.protection));
 if(!result.privatePersistence)result.messages.push('Private persistence is disabled for this init result. No private writer was started.');
 result.messages.push('Existing files were preserved. Git checks are read-only. No provider calls were run.');
 return result;
}
