import {afterEach,describe,expect,it} from 'vitest';
import http from 'node:http';
import {mkdtemp,mkdir,readdir,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {createHost} from '../server/host.ts';
import {Registry} from '../server/registry.ts';
import {createSecurity} from '../server/security.ts';
import {createApp} from '../server/http.ts';import {Store} from '../server/store.ts';import {NoteWatcher} from '../server/watch.ts';

// One port, many projects: every project API is /api/p/<id>/..., each project only ever sees its own folder.
const temps:string[]=[],hosts:ReturnType<typeof createHost>[]=[];
afterEach(async()=>{for(const h of hosts.splice(0))await h.close();for(const t of temps.splice(0))await rm(t,{recursive:true,force:true,maxRetries:5});});
async function setup(withDefault=false){
 const base=await mkdtemp(path.join(os.tmpdir(),'aitiarch-host-'));temps.push(base);
 const project=async(name:string,note:string)=>{const p=path.join(base,name);await mkdir(path.join(p,'.aitiarch'),{recursive:true});await writeFile(path.join(p,'.aitiarch',note),`# ${name}\n`);return p;};
 const a=await project('alpha','a.md'),b=await project('beta','b.md'),c=await project('gamma','c.md');
 await mkdir(path.join(base,'dist'));await writeFile(path.join(base,'dist','index.html'),'<!doctype html><title>Aitiarch</title>');
 const registry=await Registry.open(path.join(base,'config')),ea=await registry.add(a),eb=await registry.add(b);
 let port=0;const security=createSecurity({port:()=>port});
 const host=createHost({registry,security,distDir:path.join(base,'dist'),defaultProject:withDefault?()=>ea.id:undefined,
  openProject:async entry=>{const store=await Store.open(entry.notes),watcher=new NoteWatcher(store),app=createApp({store,watcher,distDir:path.join(base,'dist'),security});return {handle:app.handle,close:async()=>{watcher.stop();await app.close();}};}});
 hosts.push(host);port=await host.listen(0);
 return {port,security,ea,eb,c,a};
}
const req=(port:number,p:string,o:{headers?:Record<string,string>;method?:string;body?:unknown}={})=>new Promise<{status:number;body:string;headers:http.IncomingHttpHeaders}>((resolve,reject)=>{
 const r=http.request({host:'127.0.0.1',port,path:p,method:o.method??'GET',headers:{host:`127.0.0.1:${port}`,...o.headers}},res=>{let b='';res.on('data',c=>b+=c);res.on('end',()=>resolve({status:res.statusCode??0,body:b,headers:res.headers}));});
 r.on('error',reject);if(o.body!==undefined)r.write(JSON.stringify(o.body));r.end();
});
const auth=(s:{token:string},port:number,write=false)=>({cookie:`aitiarch=${s.token}`,...(write?{origin:`http://127.0.0.1:${port}`,'x-aitiarch':'1','content-type':'application/json'}:{})});

describe('the session and the project list',()=>{
 it('needs the session cookie',async()=>{
  const {port,security}=await setup();
  expect((await req(port,'/api/projects')).status).toBe(401);
  const s=await req(port,'/api/session');expect(s.status).toBe(200);expect(String(s.headers['set-cookie'])).toContain('HttpOnly');
  const list=JSON.parse((await req(port,'/api/projects',{headers:auth(security,port)})).body);expect(list.projects.map((p:{name:string})=>p.name).sort()).toEqual(['alpha','beta']);
 });
 it('adds, pins, opens and removes projects; removing deletes nothing',async()=>{
  const {port,security,c}=await setup(),w=auth(security,port,true);
  const added=await req(port,'/api/projects/add',{method:'PUT',headers:w,body:{path:c}});expect(added.status).toBe(200);const id=JSON.parse(added.body).id;
  expect((await req(port,'/api/projects/pin',{method:'PUT',headers:w,body:{id,pinned:true}})).status).toBe(200);
  expect(JSON.parse((await req(port,'/api/projects/open',{method:'PUT',headers:w,body:{id}})).body).lastOpened).toEqual(expect.any(String));
  expect(JSON.parse((await req(port,'/api/projects',{headers:w})).body).projects[0].id).toBe(id);
  expect((await req(port,'/api/projects/remove',{method:'PUT',headers:w,body:{id}})).status).toBe(200);
  expect(await readdir(path.join(c,'.aitiarch'))).toEqual(['c.md']);
 });
 it('explains a folder it cannot add',async()=>{
  const {port,security}=await setup(),r=await req(port,'/api/projects/add',{method:'PUT',headers:auth(security,port,true),body:{path:'relative/dir'}});
  expect(r.status).toBe(400);expect(JSON.parse(r.body).error).toBe('not_absolute');
 });
 it('refuses a write from a foreign origin',async()=>{
  const {port,security,c}=await setup(),r=await req(port,'/api/projects/add',{method:'PUT',headers:{...auth(security,port,true),origin:'http://evil.example'},body:{path:c}});
  expect(r.status).toBe(403);
 });
});

describe('each project sees only its own folder',()=>{
 it('routes /api/p/<id>/ to that project',async()=>{
  const {port,security,ea,eb}=await setup(),h=auth(security,port);
  const ta=JSON.parse((await req(port,`/api/p/${ea.id}/tree`,{headers:h})).body),tb=JSON.parse((await req(port,`/api/p/${eb.id}/tree`,{headers:h})).body);
  expect(JSON.stringify(ta)).toContain('a.md');expect(JSON.stringify(ta)).not.toContain('b.md');expect(JSON.stringify(tb)).toContain('b.md');
  expect(JSON.parse((await req(port,`/api/p/${ea.id}/file?path=a.md`,{headers:h})).body).text).toBe('# alpha\n');
 });
 it('blocks every way of climbing into another project',async()=>{
  const {port,security,ea,eb}=await setup(),h=auth(security,port);
  for(const p of [`/api/p/${ea.id}/file?path=../../beta/.aitiarch/b.md`,`/api/p/${ea.id}/file?path=..%2F..%2Fbeta%2F.aitiarch%2Fb.md`,
   `/api/p/${ea.id}/file?path=${encodeURIComponent(path.join(path.dirname(path.dirname(ea.notes)),'beta','.aitiarch','b.md'))}`,`/api/p/${ea.id}/file?path=..%5Cbeta%5Cb.md`]){
   const r=await req(port,p,{headers:h});expect(r.status,p).toBe(400);expect(r.body).not.toContain('# beta');
  }
  for(const p of [`/api/p/${ea.id}/../p/${eb.id}/../../p/zz/tree`,`/api/p/${ea.id}/%2e%2e/%2e%2e/p/nope/tree`,'/api/p/zzz/tree','/api/p/0123456789ab/tree',`/api/p/${ea.id.toUpperCase()}/tree`]){
   const r=await req(port,p,{headers:h});expect([400,404],p).toContain(r.status);expect(r.body).not.toContain('b.md');
  }
 });
 it('a request without the cookie reaches no project',async()=>{const {port,ea}=await setup();expect((await req(port,`/api/p/${ea.id}/tree`)).status).toBe(401);});
 it('a rebinding Host reaches no project',async()=>{const {port,security,ea}=await setup();expect((await req(port,`/api/p/${ea.id}/tree`,{headers:{...auth(security,port),host:`evil.example:${port}`}})).status).toBe(421);});
});

describe('the default project and the app shell',()=>{
 it('serves the old unprefixed API from the project opened with --root',async()=>{
  const {port,security}=await setup(true);expect(JSON.stringify(JSON.parse((await req(port,'/api/tree',{headers:auth(security,port)})).body))).toContain('a.md');
 });
 it('with no default project, the unprefixed API says so',async()=>{
  const {port,security}=await setup(),r=await req(port,'/api/tree',{headers:auth(security,port)});expect(r.status).toBe(404);expect(JSON.parse(r.body).error).toBe('no_project');
 });
 it('serves the app shell and answers the health probe',async()=>{
  const {port}=await setup();expect((await req(port,'/')).body).toContain('<title>Aitiarch</title>');expect(JSON.parse((await req(port,'/api/health')).body)).toEqual({app:'aitiarch',v:1});
 });
});
