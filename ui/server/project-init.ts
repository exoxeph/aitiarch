// Initialize: what turning a folder into an Aitiarch project creates. The preview and the action share one plan,
// so the home screen shows exactly what a click will write, and nothing is written until that click.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {RegistryError} from './registry.ts';
import {canonicalPath,isLocalAbsolute} from './paths.ts';
import {assertStoragePath,hasGitMarker,storageEntry} from './project-storage.ts';
import {AlreadyInitialized} from './init.ts';
import {setupInit} from './setup-http.ts';

export interface InitPlan {folder:string;name:string;initialized:boolean;creates:string[];ignoreRule:string|null}
export class InitError extends Error {
 readonly code:'already_initialized'|'ignore_consent_required';
 constructor(code:InitError['code'],message:string){super(message);this.code=code;}
}

async function folderOf(input:string):Promise<string>{
 if(typeof input!=='string'||!path.isAbsolute(input))throw new RegistryError('not_absolute','Enter an absolute folder path.');
 try{if(isLocalAbsolute(input))throw new Error();await assertStoragePath(fs,path.resolve(input));const real=await canonicalPath(input);if(isLocalAbsolute(real)||!(await fs.lstat(real)).isDirectory())throw new Error();return real;}
 catch{throw new RegistryError('missing','That folder does not exist.');}
}
export async function initPlan(input:string):Promise<InitPlan>{
 const folder=await folderOf(input),name=path.basename(folder)||folder;
 if(await storageEntry(fs,path.join(folder,'.aitiarch')))return {folder,name,initialized:true,creates:[],ignoreRule:null};
 return {folder,name,initialized:false,ignoreRule:await hasGitMarker(fs,folder)?'/.aitiarch/':null,
  creates:['.aitiarch/Welcome.md','.aitiarch/ink/','.aitiarch/decisions/','.aitiarch/local/','.aitiarch/local/.gitignore','.aitiarch/.local-storage-v1','.aitiarch/local/.storage-v1']};
}

/** Home is outside any mounted project. Use the same handler as project Setup. */
export async function initialize(input:string,confirmIgnore:boolean){
 const plan=await initPlan(input);
 if(plan.initialized)throw new InitError('already_initialized','This folder already has a .aitiarch notebook.');
 if(plan.ignoreRule&&!confirmIgnore)throw new InitError('ignore_consent_required','Confirm the private Git ignore rule before initializing this folder.');
 try{
  return await setupInit(plan.folder,confirmIgnore,true);
 }catch(error){
  if(error instanceof AlreadyInitialized)throw new InitError('already_initialized',error.message);
  throw error;
 }
}
