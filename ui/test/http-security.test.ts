import {afterEach,describe,expect,it} from 'vitest';
import http from 'node:http';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {createApp} from '../server/http.ts';import {Store} from '../server/store.ts';import {NoteWatcher} from '../server/watch.ts';

// The security baseline at the HTTP level: Host names, the launch-link exchange, the health probe, foreign Host and Origin.
const open:{app:ReturnType<typeof createApp>;watcher:NoteWatcher;root:string}[]=[];
afterEach(async()=>{for(const o of open.splice(0)){o.watcher.stop();await o.app.close();await rm(o.root,{recursive:true,force:true,maxRetries:5});}});
async function start(requireLaunch=false){
 const root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-sec-'));await writeFile(path.join(root,'note.md'),'# Note\n');
 const store=await Store.open(root),watcher=new NoteWatcher(store),app=createApp({store,watcher,distDir:root,requireLaunch});open.push({app,watcher,root});
 return {app,port:await app.listen(0)};
}
const req=(port:number,p:string,headers:Record<string,string>={},method='GET',body?:string)=>new Promise<{status:number;headers:http.IncomingHttpHeaders;body:string}>((resolve,reject)=>{
 const r=http.request({host:'127.0.0.1',port,path:p,method,headers:{host:`127.0.0.1:${port}`,...headers}},res=>{let b='';res.on('data',c=>b+=c);res.on('end',()=>resolve({status:res.statusCode??0,headers:res.headers,body:b}));});
 r.on('error',reject);if(body)r.write(body);r.end();
});

describe('Host names',()=>{
 it('serves aitiarch.localhost on our port and refuses a rebinding host',async()=>{
  const {port}=await start();
  expect((await req(port,'/api/health',{host:`aitiarch.localhost:${port}`})).status).toBe(200);
  expect((await req(port,'/api/health',{host:`evil.example:${port}`})).status).toBe(421);
 });
});

describe('the health probe',()=>{
 it('says only that this is Aitiarch, without a session and without data',async()=>{
  const {port}=await start(true),r=await req(port,'/api/health');
  expect(r.status).toBe(200);expect(JSON.parse(r.body)).toEqual({app:'aitiarch',v:1});expect(r.headers['set-cookie']).toBeUndefined();
 });
});

describe('launch mode',()=>{
 it('hands out no session without the launch link',async()=>{
  const {port}=await start(true),r=await req(port,'/api/session');
  expect(r.status).toBe(401);expect(JSON.parse(r.body).error).toBe('no_session');expect(r.headers['set-cookie']).toBeUndefined();
 });
 it('exchanges the launch link for the cookie, then drops the token from the address',async()=>{
  const {app,port}=await start(true),r=await req(port,`/?launch=${app.token}&project=abc`);
  expect(r.status).toBe(303);expect(r.headers.location).toBe('/?project=abc');
  const cookie=String(r.headers['set-cookie']);expect(cookie).toContain(`aitiarch=${app.token}`);expect(cookie).toContain('HttpOnly');expect(cookie).toContain('SameSite=Strict');
  expect((await req(port,'/api/session',{cookie:`aitiarch=${app.token}`})).status).toBe(200);
 });
 it('refuses a wrong launch token and sets nothing',async()=>{
  const {port}=await start(true),r=await req(port,'/?launch=deadbeef');
  expect(r.status).toBe(403);expect(r.headers['set-cookie']).toBeUndefined();
 });
});

describe('Origin on writes',()=>{
 it('refuses a write from a foreign origin even with the cookie',async()=>{
  const {app,port}=await start();
  const r=await req(port,'/api/ui-state',{cookie:`aitiarch=${app.token}`,origin:'http://evil.example','x-aitiarch':'1','content-type':'application/json'},'PUT','{}');
  expect(r.status).toBe(403);
  const ok=await req(port,'/api/ui-state',{cookie:`aitiarch=${app.token}`,origin:`http://aitiarch.localhost:${port}`,'x-aitiarch':'1','content-type':'application/json'},'PUT',JSON.stringify({v:1,tabs:[],active:null}));
  expect(ok.status).not.toBe(403);
 });
 it('never sends CORS headers',async()=>{const {port}=await start(),r=await req(port,'/api/health',{origin:'http://evil.example'});expect(r.headers['access-control-allow-origin']).toBeUndefined();});
});
