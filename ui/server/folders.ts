// The server-side folder browser behind "Add project": directories only, starting at the user's home folder.
// It lists names; it never reads file contents. Dot folders and links are left out.
import {lstat,readdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {RegistryError} from './registry.ts';
import {canonicalPath,isLocalAbsolute,isLocalRelative} from './paths.ts';

export interface FolderListing {path:string;parent:string|null;initialized:boolean;entries:{name:string;path:string;initialized:boolean}[]}
const isDir=async(p:string)=>{try{const s=await lstat(p);return s.isDirectory()&&!s.isSymbolicLink();}catch{return false;}};

export async function listFolders(input:string=os.homedir()):Promise<FolderListing>{
 if(typeof input!=='string'||!path.isAbsolute(input))throw new RegistryError('not_absolute','Enter an absolute folder path.');
 if(isLocalAbsolute(input))throw new RegistryError('missing','That folder does not exist.');
 let dir:string;try{dir=await canonicalPath(input);if(isLocalAbsolute(dir))throw new Error();if(!(await lstat(dir)).isDirectory())throw new Error();}catch{throw new RegistryError('missing','That folder does not exist.');}
 let names:string[]=[];
 try{
  const inNotebook=path.basename(dir).toLowerCase()==='.aitiarch';
  names=(await readdir(dir,{withFileTypes:true}))
   .filter(e=>e.isDirectory()&&!e.isSymbolicLink()&&!e.name.startsWith('.')&&!e.name.startsWith('$')&&!(inNotebook&&isLocalRelative(e.name)))
   .map(e=>e.name);
 }catch{/* unreadable: an empty listing */}
 names.sort((a,b)=>a.localeCompare(b,undefined,{sensitivity:'base'}));
 const entries=await Promise.all(names.slice(0,500).map(async name=>({name,path:path.join(dir,name),initialized:await isDir(path.join(dir,name,'.aitiarch'))})));
 const parent=path.dirname(dir);
 return {path:dir,parent:parent===dir?null:parent,initialized:await isDir(path.join(dir,'.aitiarch')),entries};
}
