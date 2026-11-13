// Every harness turn writes its instruction to a short-lived folder (turn-XXXXXX) under the project's harness folder: it holds the notes pasted for that turn.
// The turn removes it when it ends. A crash, a power cut or a killed process can leave one behind, so the harness sweeps them when it opens.
// Destructive, so deliberately narrow: only a real directory (never a link) directly inside the harness folder, named exactly like one of ours, older than a
// few minutes, not used by a turn running in this process, and holding nothing but the one file a turn writes (system.md). Anything else is left alone and reported.
import {lstat,readdir,rm} from 'node:fs/promises';
import path from 'node:path';

/** Folders of turns running right now in this process; the sweep never touches them. A turn adds its folder when it makes it and removes it when it ends. */
export const activeTurnDirs=new Set<string>();
/** A turn is over within 5 minutes (the longest time limit), so a folder untouched for 10 is not in use. */
export const STALE_TURN_MS=10*60*1000;
const OURS=/^turn-[A-Za-z0-9]{6}$/;

export interface SweepResult {removed:string[];kept:{name:string;why:string}[]}
export async function sweepStaleTurnFolders(dir:string,options:{now?:number;maxAgeMs?:number}={}):Promise<SweepResult>{
 const now=options.now??Date.now(),maxAge=options.maxAgeMs??STALE_TURN_MS,out:SweepResult={removed:[],kept:[]};
 let names:string[];try{names=await readdir(dir);}catch{return out;} // no harness folder yet: nothing to sweep
 for(const name of names.sort()){
  if(!OURS.test(name))continue;
  const full=path.join(dir,name),keep=(why:string)=>{out.kept.push({name,why});};
  const s=await lstat(full).catch(()=>null);if(!s)continue;
  if(s.isSymbolicLink()||!s.isDirectory()){keep('not a plain folder');continue;} // a link, junction or file: never followed, never removed
  if(activeTurnDirs.has(path.resolve(full))){keep('in use');continue;}
  if(now-s.mtimeMs<maxAge){keep('recent');continue;}
  const inside=await readdir(full,{withFileTypes:true}).catch(()=>null);
  if(!inside||inside.some(e=>e.name!=='system.md'||!e.isFile())){keep('holds something a turn does not write');continue;}
  await rm(full,{recursive:true,force:true});out.removed.push(name);
 }
 return out;
}
