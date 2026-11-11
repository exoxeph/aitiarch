// Launcher helpers: the fixed port, reusing an Aitiarch that already runs there, and the private file that lets a second launch
// hand its project to that running server. The file lives in the user's config folder, readable by the user only.
import http from 'node:http';
import {mkdir,readFile,rename,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_PORT=4317;

/** True only when the port answers our health probe. Anything else (another program, silence) is not Aitiarch. */
export function probeHealth(port:number,timeoutMs=1500):Promise<boolean>{
 return new Promise(resolve=>{
  const req=http.get({host:'127.0.0.1',port,path:'/api/health',headers:{host:`127.0.0.1:${port}`},timeout:timeoutMs},res=>{
   let body='';res.setEncoding('utf8');res.on('data',c=>{body+=c;if(body.length>200)req.destroy();});
   res.on('end',()=>{try{const d=JSON.parse(body);resolve(res.statusCode===200&&d?.app==='aitiarch');}catch{resolve(false);}});
  });
  req.on('timeout',()=>{req.destroy();resolve(false);});req.on('error',()=>resolve(false));
 });
}
export type PortChoice={kind:'listening';port:number}|{kind:'reuse';port:number};
/** Listen on the port; if it is busy and Aitiarch answers there, reuse it; if anything else holds it, say so plainly. */
export async function listenOrReuse(listen:(port:number)=>Promise<number>,port:number,probe=probeHealth):Promise<PortChoice>{
 try{return {kind:'listening',port:await listen(port)};}
 catch(e){
  if((e as NodeJS.ErrnoException).code!=='EADDRINUSE')throw e;
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
