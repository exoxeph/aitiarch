// The projects registry: which project folders this user has opened. It lives in the user's config folder, never in a repository,
// and removing a project only forgets it: nothing on disk is deleted.
import {createHash,randomBytes} from 'node:crypto';
import {lstat,mkdir,readFile,realpath,rename,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export type RegistryCode='not_absolute'|'missing'|'not_initialized'|'unknown'|'corrupt';
export class RegistryError extends Error {code:RegistryCode;constructor(code:RegistryCode,message:string){super(message);this.code=code;}}
export interface ProjectEntry {id:string;name:string;root:string;notes:string;addedAt:string;lastOpened:string|null;pinned:boolean}

/** %APPDATA%\aitiarch on Windows, ~/Library/Application Support/aitiarch on macOS, $XDG_CONFIG_HOME (or ~/.config)/aitiarch elsewhere. */
export function configDir(env:NodeJS.ProcessEnv=process.env,platform:NodeJS.Platform=process.platform,home=os.homedir()):string{
 if(platform==='win32')return path.win32.join(env.APPDATA||path.win32.join(home,'AppData','Roaming'),'aitiarch');
 if(platform==='darwin')return path.posix.join(home,'Library','Application Support','aitiarch');
 return path.posix.join(env.XDG_CONFIG_HOME||path.posix.join(home,'.config'),'aitiarch');
}
/** Stable per folder: the same project gets the same id on every machine start. Windows paths compare case-insensitively. */
export const projectId=(rootReal:string)=>createHash('sha256').update(process.platform==='win32'?rootReal.toLowerCase():rootReal).digest('hex').slice(0,12);

const KEYS=['addedAt','id','lastOpened','name','notes','pinned','root'];
const isEntry=(e:any):e is ProjectEntry=>!!e&&typeof e==='object'&&!Array.isArray(e)&&Object.keys(e).sort().join()===KEYS.join()
 &&/^[0-9a-f]{12}$/.test(e.id)&&typeof e.name==='string'&&typeof e.root==='string'&&path.isAbsolute(e.root)&&typeof e.notes==='string'
 &&typeof e.addedAt==='string'&&(e.lastOpened===null||typeof e.lastOpened==='string')&&typeof e.pinned==='boolean';

export class Registry {
 private constructor(private readonly dir:string,private projects:ProjectEntry[]){}
 static async open(dir:string):Promise<Registry>{
  let raw:string;
  try{raw=await readFile(path.join(dir,'projects.json'),'utf8');}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return new Registry(dir,[]);throw e;}
  let d:any;try{d=JSON.parse(raw);}catch{throw new RegistryError('corrupt','The project list could not be read. It was left unchanged.');}
  if(!d||typeof d!=='object'||Object.keys(d).sort().join()!=='projects,v'||d.v!==1||!Array.isArray(d.projects)||d.projects.length>500||!d.projects.every(isEntry))
   throw new RegistryError('corrupt','The project list has an unexpected shape. It was left unchanged.');
  return new Registry(dir,d.projects);
 }
 list(sort:'recent'|'name'='recent'):ProjectEntry[]{
  const byName=(a:ProjectEntry,b:ProjectEntry)=>a.name.localeCompare(b.name)||a.root.localeCompare(b.root);
  return this.projects.map(p=>({...p})).sort((a,b)=>sort==='name'?byName(a,b):Number(b.pinned)-Number(a.pinned)||(b.lastOpened??'').localeCompare(a.lastOpened??'')||byName(a,b));
 }
 get(id:string):ProjectEntry|undefined{const p=this.projects.find(x=>x.id===id);return p&&{...p};}
 /** Registers a project folder that already has a .aitiarch folder. Adding the same folder twice returns the existing entry. */
 async add(folder:string):Promise<ProjectEntry>{
  if(!path.isAbsolute(folder))throw new RegistryError('not_absolute','Enter an absolute folder path.');
  let root:string;try{root=await realpath(folder);if(!(await lstat(root)).isDirectory())throw new Error();}catch{throw new RegistryError('missing','That folder does not exist.');}
  const notes=path.join(root,'.aitiarch');
  try{const s=await lstat(notes);if(!s.isDirectory()||s.isSymbolicLink())throw new Error();}catch{throw new RegistryError('not_initialized','This folder has no .aitiarch notebook yet.');}
  const id=projectId(root),existing=this.get(id);if(existing)return existing;
  const entry:ProjectEntry={id,name:path.basename(root)||root,root,notes,addedAt:new Date().toISOString(),lastOpened:null,pinned:false};
  this.projects.push(entry);await this.save();return {...entry};
 }
 async remove(id:string){this.need(id);this.projects=this.projects.filter(p=>p.id!==id);await this.save();}
 async pin(id:string,pinned:boolean){this.need(id).pinned=pinned;await this.save();}
 async touch(id:string,at=new Date()){this.need(id).lastOpened=at.toISOString();await this.save();}
 private need(id:string){const p=this.projects.find(x=>x.id===id);if(!p)throw new RegistryError('unknown','That project is not in the list.');return p;}
 private async save(){
  await mkdir(this.dir,{recursive:true});
  const file=path.join(this.dir,'projects.json'),temp=`${file}.${process.pid}-${randomBytes(4).toString('hex')}.tmp`;
  try{await writeFile(temp,JSON.stringify({v:1,projects:this.projects},null,1)+'\n',{mode:0o600});await rename(temp,file);}
  catch(e){await rm(temp,{force:true});throw e;}
 }
}
