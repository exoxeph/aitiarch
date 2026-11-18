// Initialize: what turning a folder into an Aitiarch project creates. The preview and the action share one plan,
// so the home screen shows exactly what a click will write, and nothing is written until that click.
import {lstat,mkdir,open,rm} from 'node:fs/promises';
import path from 'node:path';
import {RegistryError} from './registry.ts';
import {canonicalPath,isLocalAbsolute} from './paths.ts';

export const IGNORE_LINES=['/ui-state.json*','/chat/','/pipeline.local.json'] as const;
export interface InitPlan {folder:string;name:string;initialized:boolean;creates:{path:string;lines:string[]}[]}
export class InitError extends Error {code:'already_initialized';constructor(message:string){super(message);this.code='already_initialized';}}

async function folderOf(input:string):Promise<string>{
 if(typeof input!=='string'||!path.isAbsolute(input))throw new RegistryError('not_absolute','Enter an absolute folder path.');
 try{if(isLocalAbsolute(input))throw new Error();const real=await canonicalPath(input);if(isLocalAbsolute(real)||!(await lstat(real)).isDirectory())throw new Error();return real;}
 catch{throw new RegistryError('missing','That folder does not exist.');}
}
const exists=async(p:string)=>{try{await lstat(p);return true;}catch{return false;}};

export async function initPlan(input:string):Promise<InitPlan>{
 const folder=await folderOf(input),name=path.basename(folder)||folder;
 if(await exists(path.join(folder,'.aitiarch')))return {folder,name,initialized:true,creates:[]};
 return {folder,name,initialized:false,creates:[{path:'.aitiarch/index.md',lines:[`# ${name}`]},{path:'.aitiarch/.gitignore',lines:[...IGNORE_LINES]}]};
}

/** Creates the plan's files with exclusive creates: an existing project (or one that appears meanwhile) is never overwritten. */
export async function initialize(input:string):Promise<InitPlan>{
 const plan=await initPlan(input);
 if(plan.initialized)throw new InitError('This folder already has a .aitiarch notebook.');
 const dir=path.join(plan.folder,'.aitiarch');
 try{await mkdir(dir);}catch(e){if((e as NodeJS.ErrnoException).code==='EEXIST')throw new InitError('This folder already has a .aitiarch notebook.');throw e;}
 try{
  for(const c of plan.creates){const f=await open(path.join(plan.folder,...c.path.split('/')),'wx');try{await f.writeFile(c.lines.join('\n')+'\n');}finally{await f.close();}}
 }catch(e){await rm(dir,{recursive:true,force:true});throw e;} // only the folder this call just created
 return plan;
}
