import { chmod, lstat, mkdir, open, readFile, realpath, rename, rm, writeFile, appendFile } from 'node:fs/promises';
import { protectPlanDirectory } from './launcher.ts';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const repository=fileURLToPath(new URL('../../../',import.meta.url));
const inside=(base:string,target:string)=>{const rel=path.relative(base,target);return !rel||(!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel));};
export const planDirectory=()=>path.join(process.platform==='win32'?(process.env.LOCALAPPDATA??path.join(os.homedir(),'AppData','Local')):path.join(os.homedir(),'.config'),'Aitiarch','chatgpt-plan');
// Unix mode and Windows owner ACL are both verified, with no credentials passed
// through the centralized process boundary.
async function protect(directory:string){
  if(process.platform!=='win32'){await chmod(directory,0o700);return;}
  try{await protectPlanDirectory(directory);}catch{throw new Error('Private storage permissions could not be verified.');}
}
export class PlanVault {
  readonly directory:string;
  private notebook?:string;
  private ready?:Promise<void>;
  private readVerified=false;
  constructor(directory=planDirectory(),notebook?:string){this.directory=path.resolve(directory);this.notebook=notebook&&path.resolve(notebook);}
  async check(){
    const reject=(target:string)=>{if(inside(repository,target)||target.split(/[\\/]/).some(p=>p.toLowerCase()==='.aitiarch')||(this.notebook&&inside(this.notebook,target)))throw new Error('Unsafe private storage location.');};
    reject(this.directory);
    for(let ancestor=this.directory;;ancestor=path.dirname(ancestor)){
      try{reject(await realpath(ancestor));break;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
    }
    // Refuse junctions and symlinks in the actual path, including ancestors.
    for(let ancestor=this.directory;;ancestor=path.dirname(ancestor)){
      try{if((await lstat(ancestor)).isSymbolicLink())throw new Error('Linked private storage is unsupported.');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
      if(path.dirname(ancestor)===ancestor)break;
    }
  }
  async initialize(){
    await this.check();
    this.ready??=(async()=>{await mkdir(this.directory,{recursive:true,mode:0o700});await protect(this.directory);})();
    await this.ready;
  }
  private async file(name:string){
    if(!['credentials.json','usage.jsonl','failures.jsonl','cap.json'].includes(name))throw new Error('Invalid private file.');
    await this.initialize();const file=path.join(this.directory,name);
    try{const s=await lstat(file);if(s.isSymbolicLink()||!s.isFile()||s.nlink!==1)throw new Error('Unsafe private file.');if(process.platform!=='win32'&&(s.mode&0o077)!==0)throw new Error('Private file permissions are too broad.');}
    catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
    return file;
  }
  async read(name='credentials.json'):Promise<any>{try{return JSON.parse(await readFile(await this.file(name),'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return {};throw e;}}
  // Authentication preflight and status must not create a directory, lock, or file.
  async peek(name='credentials.json'):Promise<any>{
    if(!['credentials.json','cap.json','usage.jsonl'].includes(name))throw new Error('Invalid private file.');
    await this.check();const file=path.join(this.directory,name);
    try{
      const s=await lstat(file);if(s.isSymbolicLink()||!s.isFile()||s.nlink!==1)throw new Error('Unsafe private file.');
      if(!this.readVerified&&!this.ready){
        if(process.platform==='win32')await protectPlanDirectory(this.directory,true);
        else if(((await lstat(this.directory)).mode&0o077)!==0)throw new Error('Private permissions are too broad.');
        this.readVerified=true;
      }
      if(process.platform!=='win32'&&(s.mode&0o077)!==0)throw new Error('Private permissions are too broad.');
      const text=await readFile(file,'utf8');
      if(name==='usage.jsonl')return text.split(/\r?\n/).filter(Boolean).flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}});
      return JSON.parse(text);
    }catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return {};throw e;}
  }
  async discardCredentials(){await this.check();await rm(path.join(this.directory,'credentials.json'),{force:true});}
  async usageRecords():Promise<Record<string,unknown>[]>{const rows=await this.peek('usage.jsonl');return Array.isArray(rows)?rows:[];}
  async write(value:unknown,name='credentials.json'){
    const target=await this.file(name),temporary=path.join(this.directory,'.write-'+randomBytes(8).toString('hex'));
    try{await writeFile(temporary,JSON.stringify(value)+'\n',{flag:'wx',mode:0o600});await rename(temporary,target);}
    finally{await rm(temporary,{force:true});}
  }
  async append(name:'usage.jsonl'|'failures.jsonl',value:unknown){await appendFile(await this.file(name),JSON.stringify(value)+'\n',{mode:0o600});}
  async locked<T>(run:()=>Promise<T>):Promise<T>{
    await this.initialize();const lock=path.join(this.directory,'.session.lock'),until=Date.now()+15000;let handle;
    for(;;){try{handle=await open(lock,'wx',0o600);break;}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST'||Date.now()>=until)throw new Error('Private session is busy.');await delay(25);}}
    try{return await run();}finally{await handle.close();await rm(lock,{force:true});}
  }
}
