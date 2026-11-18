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
const ROOT_VERSION_FILE='.local-storage-v1';
const VERSION='1\n';
const IGNORE='*\n';
const LEGACY_PRIVATE_PATHS={
 state:'ui-state.json',ledger:'ledger.json',cache:'.cache',chat:'chat',
 insertionJournal:path.join('ink','insertions.json'),skillDiagrams:'assets',
} as const;
const exec=promisify(execFile);
export type StorageFilesystem=Pick<typeof nodeFs,'lstat'|'mkdir'|'readFile'|'writeFile'>;
type PrivatePaths=Record<keyof typeof PRIVATE_PROJECT_PATHS,string>;
type StorageFailure='legacy'|'unverified'|'git-unverified';
type StorageResult={ok:false;code:StorageFailure;reason:string;created:string[]}|{
 ok:true;shared:{notes:string;ink:string;decisions:string};local:string;privatePaths:PrivatePaths;
 protection:'git-ignored'|'filesystem-private';created:string[];
};

export const storageErrorCode=(error:unknown)=>(error as NodeJS.ErrnoException)?.code;
export async function storageEntry(fs:Pick<StorageFilesystem,'lstat'>,file:string):Promise<Stats|null>{
 try{return await fs.lstat(file);}catch(error){if(storageErrorCode(error)==='ENOENT')return null;throw error;}
}

/** Reject links in existing components, including Windows junctions. */
export async function assertStoragePath(fs:Pick<StorageFilesystem,'lstat'>,target:string){
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

function gitAt(root:string,args:string[]){
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^git_/i.test(key)));
 return exec('git',args,{cwd:root,env,windowsHide:true,timeout:3000,maxBuffer:64*1024});
}

export async function notebookIgnored(project:string){
 try{await gitAt(project,['check-ignore','--no-index','-q','--','.aitiarch']);return true;}
 catch(error){if((error as {code?:unknown}).code===1)return false;throw error;}
}

export async function privateFilesTracked(root:string){
 const {stdout}=await gitAt(root,['--literal-pathspecs','ls-files','-z','--',path.join(root,'local')]);
 return stdout.length!==0;
}

/** A managed layout can be shared only after proving it came from exclusive
 * init and checking the publishable tree for aliases and legacy private paths. */
export async function sharedTreeIssue(root:string,fs:StorageFilesystem){
 if(!await exactFile(fs,path.join(root,ROOT_VERSION_FILE),VERSION))return 'This notebook predates verified private storage.';
 const legacyName=/^(?:ui-state\.json(?:\..*)?|ledger\.json(?:\..*)?|usage\.jsonl(?:\..*)?|\.cache|chat|runs|measurements|backups|images)$/i;
 let count=0;
 async function walk(dir:string):Promise<string|null>{
  await assertStoragePath(fs,dir);
  for await(const item of await nodeFs.opendir(dir)){
   if(++count>10000)return 'The shareable tree is too large to verify.';
   const name=item.name.toLowerCase(),file=path.join(dir,item.name);
   if(dir===root&&name==='local')continue;
   if(dir===root&&legacyName.test(name)||path.relative(root,dir).toLowerCase()==='ink'&&/^insertions\.json(?:\..*)?$/i.test(name))
    return 'Legacy private files are present outside local/.';
   const stat=await storageEntry(fs,file);
   if(!stat||stat.isSymbolicLink()||(!stat.isDirectory()&&(!stat.isFile()||stat.nlink!==1)))
    return 'The shareable tree contains an unsafe or linked path.';
   if(stat.isDirectory()){
    const reason=await walk(file);if(reason)return reason;
   }
  }
  return null;
 }
 return walk(root);
}

async function gitProtects(root:string,local:string,names:string[]){
 const git=(args:string[])=>gitAt(root,args);
 // Tracked files are never made private by ignore rules. Also require that
 // each writer's entry is ignored, including the directories writers descend into.
 if(await privateFilesTracked(root))return false;
 await git(['check-ignore','-q','--',path.relative(root,local)]);
 const targets=names.map(name=>path.relative(root,path.join(local,name)));
 const ignored=await git(['check-ignore','--',...targets]);
 return ignored.stdout.trimEnd().split(/\r?\n/).length===targets.length;
}

/** Create mode is for init only. Exclusive root creation is the proof that a legacy layout was never adopted. */
export async function resolveProjectStorage(root:string,{create=false,fs=nodeFs}:{create?:boolean;fs?:StorageFilesystem}={}):Promise<StorageResult>{
 const created:string[]=[];
 const refused=(reason:string,code:StorageFailure='unverified'):StorageResult=>({ok:false,code,reason,created});
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
    const identity=path.join(root,ROOT_VERSION_FILE);
    await fs.writeFile(identity,VERSION,{flag:'wx',mode:0o600});created.push(identity);
    await assertStoragePath(fs,local);
    await fs.mkdir(local,{mode:0o700});created.push(local);
    await fs.writeFile(ignore,IGNORE,{flag:'wx',mode:0o600});created.push(ignore);
    await fs.writeFile(marker,VERSION,{flag:'wx',mode:0o600});created.push(marker);
   }
  }
  await assertStoragePath(fs,local);
  const identity=path.join(root,ROOT_VERSION_FILE);
  if(await storageEntry(fs,identity)&&!await exactFile(fs,identity,VERSION))return refused('Private storage has an invalid layout marker.');
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
   if(!verified)return refused('Git could not verify that local/ is ignored and untracked.','git-unverified');
  }
  const privatePaths=Object.fromEntries(entries.map(([key,name])=>[key,path.join(local,name)])) as PrivatePaths;
  return {ok:true,shared:{notes:root,ink:path.join(root,'ink'),decisions:path.join(root,'decisions')},local,privatePaths,protection:inGit?'git-ignored':'filesystem-private',created};
 }catch{
  if(create&&created.length)throw Error('Could not complete the private storage layout. Existing files were preserved.');
  return refused('Private storage could not be verified because a path was unsafe or inaccessible.');
 }
}

/** Legacy roots keep their original paths. An invalid managed layout must
 * never send a writer back to a legacy destination. */
export async function resolvePrivateProjectPath(root:string,key:keyof typeof LEGACY_PRIVATE_PATHS){
 const local=path.join(root,'local');
 if(path.basename(path.resolve(root)).toLowerCase()==='.aitiarch'){
  await assertStoragePath(nodeFs,local);
  const marked=await storageEntry(nodeFs,path.join(root,ROOT_VERSION_FILE));
  if(marked||await storageEntry(nodeFs,path.join(local,VERSION_FILE))){
   const layout=await resolveProjectStorage(root);
   if(!layout.ok)throw Error(layout.reason);
   return {file:layout.privatePaths[key],managed:true};
  }
 }
 return {file:path.join(root,LEGACY_PRIVATE_PATHS[key]),managed:false};
}

/** Stable queue identity, regardless of which on-disk layout backs this ledger. */
export const projectLedgerIdentity=(root:string)=>path.resolve(root,LEGACY_PRIVATE_PATHS.ledger);
