import {execFile} from 'node:child_process';
import type {Stats} from 'node:fs';
import * as nodeFs from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';

export const PRIVATE_PROJECT_PATHS=Object.freeze({
 state:'ui-state.json',ledger:'ledger.json',cache:'.cache',chat:'chat',insertionJournal:'insertions.json',
 skillDiagrams:'skill-diagrams',runs:'runs',measurements:'measurements',backups:'backups',usage:'usage.jsonl',images:'images',
} as const);
const FILE_KEYS=new Set<keyof typeof PRIVATE_PROJECT_PATHS>(['state','ledger','insertionJournal','usage']);
const VERSION_FILE='.storage-v1';
const VERSION='1\n';
const IGNORE='*\n';
const exec=promisify(execFile);
export type StorageFilesystem=Pick<typeof nodeFs,'lstat'|'mkdir'|'readFile'|'writeFile'>;
type PrivatePaths=Record<keyof typeof PRIVATE_PROJECT_PATHS,string>;
type StorageResult={ok:false;code:'legacy'|'unverified';reason:string;created:string[]}|{
 ok:true;shared:{notes:string;ink:string;decisions:string};local:string;privatePaths:PrivatePaths;
 protection:'git-ignored'|'filesystem-private';created:string[];
};

export const storageErrorCode=(error:unknown)=>(error as NodeJS.ErrnoException)?.code;
export async function storageEntry(fs:StorageFilesystem,file:string):Promise<Stats|null>{
 try{return await fs.lstat(file);}catch(error){if(storageErrorCode(error)==='ENOENT')return null;throw error;}
}

/** Reject links in existing components, including Windows junctions. */
export async function assertStoragePath(fs:StorageFilesystem,target:string){
 const base=path.parse(target).root;let current=base;
 for(const part of path.relative(base,target).split(path.sep).filter(Boolean)){
  current=path.join(current,part);const entry=await storageEntry(fs,current);
  if(entry?.isSymbolicLink())throw Error('Unsafe symbolic link target.');
  if(current!==target&&entry&&!entry.isDirectory())throw Error('Unsafe parent directory.');
 }
}

export async function hasGitMarker(fs:StorageFilesystem,project:string){
 for(let current=project;;current=path.dirname(current)){
  const entry=await storageEntry(fs,path.join(current,'.git'));
  if(entry){
   if(entry.isSymbolicLink()||!entry.isDirectory()&&!entry.isFile())throw Error('Unsafe Git marker.');
   return true;
  }
  if(path.dirname(current)===current)return false;
 }
}

async function exactFile(fs:StorageFilesystem,file:string,contents:string){
 const entry=await storageEntry(fs,file);
 return !!entry?.isFile()&&entry.nlink===1&&entry.size===Buffer.byteLength(contents)&&
  (await fs.readFile(file)).equals(Buffer.from(contents));
}

async function gitProtects(root:string,local:string,names:string[]){
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^git_/i.test(key)));
 const git=(args:string[])=>exec('git',args,{cwd:root,env,windowsHide:true,timeout:3000,maxBuffer:64*1024});
 // Tracked files are never made private by ignore rules. Also require that
 // each writer's entry is ignored, including the directories writers descend into.
 const tracked=await git(['--literal-pathspecs','ls-files','-z','--',local]);
 if(tracked.stdout.length)return false;
 const targets=names.map(name=>path.relative(root,path.join(local,name)));
 const ignored=await git(['check-ignore','--',...targets]);
 return ignored.stdout.trimEnd().split(/\r?\n/).length===targets.length;
}

/** Create mode is for init only. Exclusive root creation is the proof that a legacy layout was never adopted. */
export async function resolveProjectStorage(root:string,{create=false,fs=nodeFs}:{create?:boolean;fs?:StorageFilesystem}={}):Promise<StorageResult>{
 const created:string[]=[];
 const refused=(reason:string,code:'legacy'|'unverified'='unverified'):StorageResult=>({ok:false,code,reason,created});
 if(!path.isAbsolute(root)||path.basename(path.resolve(root))!=='.aitiarch')return refused('Private storage is unavailable for this notebook root.');
 root=path.resolve(root);
 const project=path.dirname(root),local=path.join(root,'local');
 const marker=path.join(local,VERSION_FILE),ignore=path.join(local,'.gitignore');
 try{
  await assertStoragePath(fs,root);
  if(create){
   let fresh=false;
   try{await fs.mkdir(root,{mode:0o700});fresh=true;created.push(root);}
   catch(error){if(storageErrorCode(error)!=='EEXIST')throw error;}
   if(fresh){
    await assertStoragePath(fs,local);
    await fs.mkdir(local,{mode:0o700});created.push(local);
    await fs.writeFile(ignore,IGNORE,{flag:'wx',mode:0o600});created.push(ignore);
    await fs.writeFile(marker,VERSION,{flag:'wx',mode:0o600});created.push(marker);
   }
  }
  await assertStoragePath(fs,local);
  if(!await exactFile(fs,marker,VERSION))return refused('Private storage is unavailable for a legacy or unsupported notebook layout.','legacy');
  if(!await exactFile(fs,ignore,IGNORE))return refused('Private storage requires the original local/.gitignore wildcard rule.');
  const entries=Object.entries(PRIVATE_PROJECT_PATHS) as [keyof PrivatePaths,string][];
  for(const [key,name] of entries){
   const entry=await storageEntry(fs,path.join(local,name));
   if(entry&&(FILE_KEYS.has(key)?!entry.isFile()||entry.nlink!==1:!entry.isDirectory()))
    return refused('Private storage has an unsafe or linked destination.');
  }
  const inGit=await hasGitMarker(fs,project);
  if(inGit){
   let verified=false;
   try{verified=await gitProtects(root,local,[VERSION_FILE,'.gitignore',...entries.map(([,name])=>name)]);}
   catch{/* Git unavailable, path tracked or rule ineffective. */ }
   if(!verified)return refused('Git could not verify that local/ is ignored and untracked.');
  }
  const privatePaths=Object.fromEntries(entries.map(([key,name])=>[key,path.join(local,name)])) as PrivatePaths;
  return {ok:true,shared:{notes:root,ink:path.join(root,'ink'),decisions:path.join(root,'decisions')},local,privatePaths,protection:inGit?'git-ignored':'filesystem-private',created};
 }catch{
  if(create&&created.length)throw Error('Could not complete the private storage layout. Existing files were preserved.');
  return refused('Private storage could not be verified because a path was unsafe or inaccessible.');
 }
}
