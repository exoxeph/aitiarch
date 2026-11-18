import {afterEach,describe,expect,it} from 'vitest';
import {spawn,type ChildProcess} from 'node:child_process';
import http from 'node:http';import net from 'node:net';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';

// The real CLI, in temp folders: launch link, registry and instance file in the (temp) config folder, and reuse of a running server.
const ui=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const procs:ChildProcess[]=[],temps:string[]=[];
afterEach(async()=>{for(const p of procs.splice(0))p.kill();await new Promise(r=>setTimeout(r,300));for(const t of temps.splice(0))await rm(t,{recursive:true,force:true,maxRetries:8,retryDelay:150});});
const freePort=()=>new Promise<number>(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=(s.address() as net.AddressInfo).port;s.close(()=>resolve(p));});});
async function project(base:string,name:string){const p=path.join(base,name);await mkdir(path.join(p,'.aitiarch'),{recursive:true});await writeFile(path.join(p,'.aitiarch','index.md'),`# ${name}\n`);return p;}
function launch(args:string[],cfg:string){
 const p=spawn(process.execPath,[path.join(ui,'server','main.ts'),...args,'--no-open'],{cwd:ui,env:{...process.env,PATH:'',HOME:cfg,USERPROFILE:cfg,APPDATA:cfg,LOCALAPPDATA:cfg,AITIARCH_CONFIG_DIR:cfg},stdio:['ignore','pipe','pipe']});procs.push(p);
 return new Promise<{ready:any;code:number|null}>((resolve,reject)=>{let out='',err='';p.stdout!.on('data',d=>{out+=d;const m=/AITIARCH_READY (.*)/.exec(out);if(m)resolve({ready:JSON.parse(m[1]),code:null});});p.stderr!.on('data',d=>err+=d);
  p.on('exit',code=>{const m=/AITIARCH_READY (.*)/.exec(out);m?resolve({ready:JSON.parse(m[1]),code}):reject(new Error(`exited ${code}: ${err}`));});setTimeout(()=>reject(new Error('timeout: '+err)),15000);});
}
const get=(port:number,p:string,cookie?:string)=>new Promise<{status:number;headers:http.IncomingHttpHeaders;body:string}>((resolve,reject)=>{
 http.get({host:'127.0.0.1',port,path:p,headers:{host:`127.0.0.1:${port}`,...(cookie?{cookie}:{})}},res=>{let b='';res.on('data',c=>b+=c);res.on('end',()=>resolve({status:res.statusCode??0,headers:res.headers,body:b}));}).on('error',reject);
});

describe('aitiarch start-up',()=>{
 it('prints a launch link, keeps the session behind it, and records the project in the config folder',async()=>{
  const base=await mkdtemp(path.join(os.tmpdir(),'aitiarch-cli-'));temps.push(base);const cfg=path.join(base,'cfg'),a=await project(base,'alpha');
  const {ready}=await launch(['--root',path.join(a,'.aitiarch'),'--port','0'],cfg);
  expect(ready.project).toMatch(/^[0-9a-f]{12}$/);expect(ready.launch).toMatch(new RegExp(`^http://127\\.0\\.0\\.1:${ready.port}/\\?launch=[0-9a-f]{48}&project=${ready.project}$`));
  expect((await get(ready.port,'/api/session')).status).toBe(401);
  const u=new URL(ready.launch),ex=await get(ready.port,u.pathname+u.search);expect(ex.status).toBe(303);
  const cookie=String(ex.headers['set-cookie']).split(';')[0];expect((await get(ready.port,'/api/session',cookie)).status).toBe(200);
  expect(JSON.parse((await get(ready.port,'/api/tree',cookie)).body).children.map((c:{name:string})=>c.name)).toContain('index.md');
  const reg=JSON.parse(await readFile(path.join(cfg,'projects.json'),'utf8'));expect(reg.projects.map((p:{name:string})=>p.name)).toEqual(['alpha']);
  const inst=JSON.parse(await readFile(path.join(cfg,'server.json'),'utf8'));expect(inst).toMatchObject({v:1,port:ready.port,token:u.searchParams.get('launch')});
 },30000);
 it('reuses the same notebook on the same port and refuses a different notebook',async()=>{
  const base=await mkdtemp(path.join(os.tmpdir(),'aitiarch-cli-'));temps.push(base);const cfg=path.join(base,'cfg'),a=await project(base,'alpha'),b=await project(base,'beta'),port=await freePort();
  const first=await launch(['--root',a,'--port',String(port)],cfg);
  const second=await launch(['--root',a,'--port',String(port)],cfg),proc=procs[procs.length-1];
  const code=proc.exitCode??await new Promise<number|null>(r=>proc.on('exit',c=>r(c)));
  expect(code).toBe(0);expect(second.ready).toMatchObject({reused:true,port,project:first.ready.project});
  expect(new URL(second.ready.launch).searchParams.get('launch')).toBe(new URL(first.ready.launch).searchParams.get('launch'));
  const cookie=`aitiarch=${new URL(first.ready.launch).searchParams.get('launch')}`;
  await expect(launch(['--root',b,'--port',String(port)],cfg)).rejects.toThrow(/Server identity mismatch.*notebook root/);
  const list=JSON.parse((await get(port,'/api/projects',cookie)).body).projects.map((p:{name:string})=>p.name).sort();expect(list).toEqual(['alpha']);
  expect(JSON.stringify(JSON.parse((await get(port,`/api/p/${second.ready.project}/tree`,cookie)).body))).toContain('index.md');
 },40000);
 it('says plainly when another program holds the port',async()=>{
  const base=await mkdtemp(path.join(os.tmpdir(),'aitiarch-cli-'));temps.push(base);const a=await project(base,'alpha');
  const other=http.createServer((_q,s)=>{s.end('not aitiarch');});await new Promise<void>(r=>other.listen(0,'127.0.0.1',()=>r()));const port=(other.address() as net.AddressInfo).port;
  try{await expect(launch(['--root',a,'--port',String(port)],path.join(base,'cfg'))).rejects.toThrow(/occupied.*identity is unavailable.*will not be reused/);}finally{other.close();}
 },30000);
});
