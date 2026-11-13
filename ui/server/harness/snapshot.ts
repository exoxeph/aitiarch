// The folder an investigation reads: a copy of the user's repo that the app makes and re-syncs (by hash) before every turn. Only files git
// knows about (tracked, plus untracked files that are not ignored), never what a repo must not give out (secrets, keys, tooling folders, state: deny.ts), never a
// link or a file reached through a linked folder, never a very large file. The copy holds the files and nothing else; its manifest lives beside it.
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {lstat,mkdir,readdir,readFile,realpath,rm,rmdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';
import {repoDeny} from './deny.ts';
import {safeTarget,safeWrite} from './tripwire.ts';
const exec=promisify(execFile);
export const SNAPSHOT_LIMITS=Object.freeze({fileBytes:262144,files:5000,totalBytes:50*1024*1024});
export interface SnapshotResult {files:number;bytes:number;changed:number;hash:string;skipped:{denied:number;links:number;tooLarge:number;overCap:number;notFile:number}}
export interface Drift {changed:string[];added:string[];removed:string[]}
const sha=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
// The repo's own git config must not be able to run anything while the app lists files: no system or global config, no fsmonitor hook.
const gitEnv=()=>({...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null',GIT_OPTIONAL_LOCKS:'0',GIT_TERMINAL_PROMPT:'0'});

/** Tracked files plus untracked files that are not ignored, as forward-slash paths relative to the repo. */
export async function repoFiles(repo:string):Promise<string[]>{
 const list=async(args:string[])=>(await exec('git',['-c','core.quotepath=false','-c','core.fsmonitor=false','-c','core.untrackedCache=false','-c','core.hooksPath=','ls-files','-z',...args],{cwd:repo,windowsHide:true,timeout:20000,maxBuffer:32*1024*1024,env:gitEnv()})).stdout.split('\0').filter(Boolean);
 return [...new Set([...await list(['--cached']),...await list(['--others','--exclude-standard'])])].sort();
}
async function walk(root:string,rel=''):Promise<string[]>{
 const out:string[]=[];let entries;try{entries=await readdir(path.join(root,rel),{withFileTypes:true});}catch{return out;}
 for(const e of entries){const r=rel?rel+'/'+e.name:e.name;if(e.isDirectory()&&!e.isSymbolicLink())out.push(...await walk(root,r));else out.push(r);}return out;
}
async function readManifest(file:string):Promise<Record<string,string>>{try{const d=JSON.parse(await readFile(file,'utf8'));return d&&d.v===1&&d.files&&typeof d.files==='object'?d.files:{};}catch{return {};}}
async function pruneEmpty(root:string,rel=''):Promise<boolean>{
 let empty=true;for(const e of await readdir(path.join(root,rel),{withFileTypes:true})){if(e.isDirectory()){const r=rel?rel+'/'+e.name:e.name;if(await pruneEmpty(root,r))await rmdir(path.join(root,r));else empty=false;}else empty=false;}return empty;
}

/** 
otebook is the notebook folder when it is the repo, inside it, or the repo is inside it: those paths are kept out by the notebook's own rules (deny.ts). */
export async function syncSnapshot(repo:string,dest:string,manifestFile:string,limits=SNAPSHOT_LIMITS,notebook?:string):Promise<SnapshotResult>{
 const root=await realpath(repo),denied=repoDeny(root,notebook?await realpath(notebook).catch(()=>path.resolve(notebook)):undefined),skipped={denied:0,links:0,tooLarge:0,overCap:0,notFile:0},files:Record<string,string>={},data=new Map<string,Buffer>();
 const linkedDir=new Map<string,boolean>();
 const throughLink=async(rel:string)=>{ // any folder on the way that is a link or junction: never followed
  let cur='';
  for(const p of rel.split('/').slice(0,-1)){cur=cur?cur+'/'+p:p;let known=linkedDir.get(cur);if(known===undefined){try{const s=await lstat(path.join(root,cur));known=s.isSymbolicLink()||!s.isDirectory();}catch{known=true;}linkedDir.set(cur,known);}if(known)return true;}
  return false;
 };
 let bytes=0;
 for(const rel of await repoFiles(root)){
  if(denied(rel)||rel.split('/').some(p=>p==='..'||p===''||/[<>:"|?*\u0000-\u001f]/.test(p))){skipped.denied++;continue;}
  if(await throughLink(rel)){skipped.links++;continue;}
  let s;try{s=await lstat(path.join(root,rel));}catch{skipped.notFile++;continue;}
  if(s.isSymbolicLink()){skipped.links++;continue;}
  if(!s.isFile()||s.nlink!==1){skipped.notFile++;continue;}
  if(s.size>limits.fileBytes){skipped.tooLarge++;continue;}
  if(Object.keys(files).length>=limits.files||bytes+s.size>limits.totalBytes){skipped.overCap++;continue;}
  const b=await readFile(path.join(root,rel));files[rel]=sha(b);data.set(rel,b);bytes+=b.length;
 }
 // Bring the copy in line. First remove everything the manifest does not list (anything written into the copy, and any link: rm never follows
 // one), then write what changed, and only through real folders inside the copy.
 await mkdir(dest,{recursive:true});const old=await readManifest(manifestFile);let changed=0;
 for(const rel of await walk(dest))if(!(rel in files)){await rm(path.join(dest,...rel.split('/')),{force:true,recursive:true});changed++;}
 await pruneEmpty(dest);
 for(const [rel,h] of Object.entries(files)){
  const target=path.join(dest,...rel.split('/'));
  if(!await safeTarget(dest,rel)){await rm(target,{force:true});if(!await safeTarget(dest,rel))throw new Error('The snapshot folder contains a link.');}
  let same=old[rel]===h;
  if(same){try{same=sha(await readFile(target))===h;}catch{same=false;}}
  if(!same){if(!await safeWrite(dest,rel,data.get(rel)!))throw new Error('The snapshot folder contains a link.');changed++;}
 }
 await writeFile(manifestFile,JSON.stringify({v:1,files}));
 return {files:Object.keys(files).length,bytes,changed,hash:sha(JSON.stringify(Object.entries(files).sort())),skipped};
}

/** What changed in the copy since the last sync (the agent has no write tools; this checks that it stayed that way). */
export async function snapshotDrift(dest:string,manifestFile:string):Promise<Drift>{
 const files=await readManifest(manifestFile),now=await walk(dest),out:Drift={changed:[],added:[],removed:[]};
 for(const rel of now){if(!(rel in files)){out.added.push(rel);continue;}try{if(sha(await readFile(path.join(dest,...rel.split('/'))))!==files[rel])out.changed.push(rel);}catch{out.changed.push(rel);}}
 for(const rel of Object.keys(files))if(!now.includes(rel))out.removed.push(rel);
 for(const k of ['changed','added','removed'] as const)out[k].sort();return out;
}
