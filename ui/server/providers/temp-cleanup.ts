import { lstat, readdir, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { privateCleanupLog } from './failure-metrics.ts';

export interface CleanupNote { code:'EBUSY'|'EPERM'|'ENOTEMPTY'|'unsafe_target'|'other'; attempts:number }
export interface CleanupLog {write(record:CleanupNote):Promise<void>}
const owned=/^aitiarch-(?:headless|capabilities)-[a-zA-Z0-9]{6}$/;
const retryable=new Set(['EBUSY','EPERM','ENOTEMPTY']);
const waits=[100,200,400,800];
async function safeTarget(target:string,tempRoot:string):Promise<boolean>{
  const root=await realpath(tempRoot),resolved=path.resolve(target);
  if(path.dirname(resolved)!==root||!owned.test(path.basename(resolved)))return false;
  const stat=await lstat(resolved);
  return stat.isDirectory()&&!stat.isSymbolicLink()&&(await realpath(resolved))===resolved;
}
// Called only once the child has closed and any process-tree termination completed.
// Cleanup and even its private log must never replace an answer or its primary error.
export async function cleanupProviderTemp(target:string,options:{tempRoot?:string;log?:CleanupLog}={}):Promise<void>{
  let attempts=0;
  try{
    if(!await safeTarget(target,options.tempRoot??os.tmpdir()))throw Object.assign(new Error(),{code:'unsafe_target'});
    for(;;){
      attempts++;
      try{await rm(target,{recursive:true,force:true,maxRetries:0});return;}
      catch(error){const code=(error as NodeJS.ErrnoException).code;if(code==='ENOENT')return;
        if(attempts>=5||!retryable.has(code??''))throw error;
        await delay(waits[attempts-1]);}
    }
  }catch(error){
    const raw=(error as NodeJS.ErrnoException).code;
    if(raw==='ENOENT')return;
    const code:CleanupNote['code']=raw==='unsafe_target'?'unsafe_target':retryable.has(raw??'')?raw as 'EBUSY'|'EPERM'|'ENOTEMPTY':'other';
    try{await (options.log??privateCleanupLog()).write({code,attempts});}catch{/* No user-facing failure or sensitive fallback log. */}
  }
}
export async function sweepStaleProviderTemps(options:{tempRoot?:string;now?:number;log?:CleanupLog}={}):Promise<void>{
  try{
    const root=await realpath(options.tempRoot??os.tmpdir()),cutoff=(options.now??Date.now())-86400000;
    for(const name of await readdir(root)){
      if(!owned.test(name))continue;
      const target=path.join(root,name);
      try{if(await safeTarget(target,root)&&(await lstat(target)).mtimeMs<cutoff)await cleanupProviderTemp(target,{...options,tempRoot:root});}
      catch{/* A concurrently removed or changed entry is left alone. */}
    }
  }catch{/* Startup does not depend on access to other temporary entries. */}
}
