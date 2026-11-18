// Launcher helpers: the fixed port, reusing an Aitiarch that already runs there, and the private file that lets a second launch
// hand its project to that running server. The file lives in the user's config folder, readable by the user only.
import http from 'node:http';
import {mkdir,readFile,rename,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import type {SelectedCli} from './platform/cli-selection.ts';

export const DEFAULT_PORT=4317;
export interface ServerIdentity {version:string;appFolder:string;notebookRoot:string;providers?:readonly Pick<SelectedCli,'id'|'path'|'version'|'isolation'>[]}
async function health(port:number,timeoutMs=1500):Promise<any>{
 return new Promise(resolve=>{
  const req=http.get({host:'127.0.0.1',port,path:'/api/health',headers:{host:`127.0.0.1:${port}`},timeout:timeoutMs},res=>{
   let body='';res.setEncoding('utf8');res.on('data',c=>{body+=c;if(body.length>8192)req.destroy();});
   res.on('end',()=>{try{const d=JSON.parse(body);resolve(res.statusCode===200&&d?.app==='aitiarch'?d:null);}catch{resolve(null);}});
   res.on('error',()=>resolve(null));
  });
  req.on('timeout',()=>{req.destroy();resolve(null);});req.on('error',()=>resolve(null));
 });
}
export async function readServerIdentity(port:number):Promise<ServerIdentity|null>{
 const d=await health(port);
 return d&&['version','appFolder','notebookRoot'].every(key=>typeof d[key]==='string'&&d[key].length>0)?
  {version:d.version,appFolder:d.appFolder,notebookRoot:d.notebookRoot,...(Array.isArray(d.providers)&&d.providers.length<=3&&d.providers.every((p:any)=>p&&['claude','codex','kiro'].includes(p.id)&&(p.path===null||typeof p.path==='string')&&(p.version===null||typeof p.version==='string')&&['unverified','metadata-compatible'].includes(p.isolation))?{providers:d.providers.map((p:any)=>({id:p.id,path:p.path,version:p.version,isolation:p.isolation}))}:{})}:null;
}

/** True only when the port answers our health probe. Anything else (another program, silence) is not Aitiarch. */
export function probeHealth(port:number,timeoutMs=1500):Promise<boolean>{
 return health(port,timeoutMs).then(Boolean);
}
export type PortChoice={kind:'listening';port:number}|{kind:'reuse';port:number};
/** Listen on the port; if it is busy and Aitiarch answers there, reuse it; if anything else holds it, say so plainly. */
export async function listenOrReuse(listen:(port:number)=>Promise<number>,port:number,probe=probeHealth,
 identity?:{expected:ServerIdentity;readIdentity?:(port:number)=>Promise<ServerIdentity|null>}):Promise<PortChoice>{
 try{return {kind:'listening',port:await listen(port)};}
 catch(e){
  if((e as NodeJS.ErrnoException).code!=='EADDRINUSE')throw e;
  if(identity){
   const actual=await (identity.readIdentity??readServerIdentity)(port),expected=identity.expected;
   if(!actual)throw new Error(`Port ${port} is occupied; Aitiarch server identity is unavailable. Close it or choose another port; it will not be reused.`);
   const samePath=(a:string,b:string)=>process.platform==='win32'?path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase():path.resolve(a)===path.resolve(b);
   if(actual.version!==expected.version||!samePath(actual.appFolder,expected.appFolder)||!samePath(actual.notebookRoot,expected.notebookRoot))
    throw new Error(`Server identity mismatch on port ${port}: running version ${actual.version}, app folder ${actual.appFolder}, notebook root ${actual.notebookRoot}; requested version ${expected.version}, app folder ${expected.appFolder}, notebook root ${expected.notebookRoot}. Close the running server or use --port <number>.`);
   if(expected.providers){
    const key=(p:NonNullable<ServerIdentity['providers']>)=>JSON.stringify(p.map(({id,path:binary,version,isolation})=>({id,path:binary===null?null:process.platform==='win32'?path.resolve(binary).toLowerCase():path.resolve(binary),version,isolation})).sort((a,b)=>a.id.localeCompare(b.id)));
    if(!actual.providers||key(actual.providers)!==key(expected.providers))throw Error(`Server provider selection differs on port ${port}. Close that server and restart with the requested CLI settings, or choose another port.`);
   }
   return {kind:'reuse',port};
  }
  if(await probe(port))return {kind:'reuse',port};
  throw new Error(`Port ${port} is in use by another program. Close it, or start Aitiarch with --port <number>.`);
 }
}

export interface InstanceInfo {v:1;port:number;pid:number;token:string}
const file=(dir:string)=>path.join(dir,'server.json');
export async function writeInstance(dir:string,info:InstanceInfo){
 await mkdir(dir,{recursive:true});const temp=`${file(dir)}.${process.pid}.tmp`;
 await writeFile(temp,JSON.stringify(info),{mode:0o600});await rename(temp,file(dir));
}
export async function readInstance(dir:string):Promise<InstanceInfo|null>{
 try{const d=JSON.parse(await readFile(file(dir),'utf8'));
  return d&&Object.keys(d).sort().join()==='pid,port,token,v'&&d.v===1&&Number.isSafeInteger(d.port)&&d.port>0&&d.port<65536&&Number.isSafeInteger(d.pid)&&typeof d.token==='string'&&/^[0-9a-f]{48}$/.test(d.token)?d:null;
 }catch{return null;}
}
/** Only the process that wrote the file removes it, so a second launch never erases the running server's entry. */
export async function clearInstance(dir:string,pid:number){const d=await readInstance(dir);if(d?.pid===pid)await rm(file(dir),{force:true});}
