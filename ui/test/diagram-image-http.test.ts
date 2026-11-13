import {execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,readdir,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach,describe,expect,it} from 'vitest';
import {Store} from '../server/store.ts';import {NoteWatcher} from '../server/watch.ts';import {createApp} from '../server/http.ts';
import {FakeChatProvider} from '../server/chat/fake.ts';
import {flip,makePng,svgFor} from './fixtures/png.ts';

// The page saves the picture of a diagram through the server, which checks it again as untrusted bytes. Synthetic notebook; nothing real is touched.
const dirs:string[]=[];afterEach(async()=>{for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
async function server(){
 const nb=await mkdtemp(path.join(os.tmpdir(),'aitiarch-dimg-http-'));dirs.push(nb);
 execFileSync('git',['init','-q'],{cwd:nb});await writeFile(path.join(nb,'plan.md'),'# Plan\n');await mkdir(path.join(nb,'assets'));
 const {svg,base}=svgFor('Alpha feeds Bravo');await writeFile(path.join(nb,'assets',base+'.svg'),svg);
 const store=await Store.open(nb),watcher=new NoteWatcher(store),app=createApp({store,watcher,distDir:nb,provider:new FakeChatProvider()});
 const port=await app.listen(0),origin='http://127.0.0.1:'+port,cookie=(await fetch(origin+'/api/session')).headers.get('set-cookie')!.split(';')[0];
 const headers={cookie,origin,'content-type':'application/json','x-aitiarch':'1'};
 const put=(body:unknown)=>fetch(origin+'/api/diagram-image',{method:'PUT',headers,body:JSON.stringify(body)});
 const get=(p:string)=>fetch(origin+p,{headers:{cookie}});
 return {nb,base,put,get,close:async()=>{watcher.stop();await app.close();}};
}
const b64=(b:Buffer)=>b.toString('base64');

describe('saving and serving the picture of a diagram',()=>{
 it('saves a valid picture beside its svg, lists it, and serves its bytes as an image that cannot run anything',async()=>{
  const s=await server();
  try{
   const png=makePng(800,420),name=s.base+'.png';
   expect((await s.get('/api/diagram-image?name='+name)).status).toBe(404);expect(await (await s.get('/api/diagram-images?names='+name)).json()).toEqual({images:[]});
   const saved=await s.put({name,data:b64(png)});expect(saved.status).toBe(200);expect(await saved.json()).toEqual({name,width:800,height:420,bytes:png.length});
   const served=await s.get('/api/diagram-image?name='+name);expect(served.status).toBe(200);expect(served.headers.get('content-type')).toBe('image/png');expect(served.headers.get('x-content-type-options')).toBe('nosniff');
   expect(served.headers.get('content-security-policy')).toContain("default-src 'none'");expect(Buffer.from(await served.arrayBuffer()).equals(png)).toBe(true);
   expect(await (await s.get('/api/diagram-images?names='+name)).json()).toEqual({images:[{name,width:800,height:420,bytes:png.length}]});
   expect((await readdir(path.join(s.nb,'assets'))).sort()).toEqual([name,s.base+'.svg'].sort());
  }finally{await s.close();}
 });
 it('refuses a name that is not a diagram picture name, every way out of the assets folder included, and writes nothing',async()=>{
  const s=await server(),png=b64(makePng(50,50)),hex=s.base.slice(-64);
  try{
   for(const name of ['x.png',`../${s.base}.png`,`..\\${s.base}.png`,`assets/${s.base}.png`,`${s.base}.svg`,`${s.base}.PNG`,`${s.base}.png/..`,'',null,5,{},[`${s.base}.png`],`diagram-${hex.toUpperCase()}.png`]){
    const r=await s.put({name,data:png});expect(r.status,JSON.stringify(name)).toBe(400);expect((await r.json()).error).toBe('invalid_image');
   }
   expect((await s.put({data:png})).status).toBe(400);
   expect(await readdir(path.join(s.nb,'assets'))).toEqual([s.base+'.svg']);expect(await readdir(s.nb)).not.toContain('x.png');
   for(const name of [`../${s.base}.png`,`..%5C${s.base}.png`,'x.png',`${s.base}.svg`])expect((await s.get('/api/diagram-image?name='+encodeURIComponent(name))).status,name).toBe(404);
   expect((await s.get('/api/diagram-images?names=../x.png')).status).toBe(400);expect((await s.get('/api/diagram-images?names='+Array(41).fill(s.base+'.png').join(','))).status).toBe(400);
   expect((await s.get(`/api/diagram-images?names=${s.base}.png,${s.base}.svg`)).status).toBe(400);
  }finally{await s.close();}
 });
 it('refuses bytes that are not a good picture: not a PNG, too big, too wide, damaged, not base64; and a picture for an svg that is not there',async()=>{
  const s=await server(),name=s.base+'.png';
  try{
   const bad:[string,unknown][]=[['not a png',b64(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'.padEnd(120)))],['too big',b64(makePng(450,450,{noise:true}))],['too wide',b64(makePng(1700,20))],['damaged',b64(flip(makePng(60,40),20))],
    ['not base64','!!! not base64 !!!'],['empty',''],['no data',undefined],['a number',12345],['data URL','data:image/png;base64,'+b64(makePng(10,10))],['absurd size','A'.repeat(900000)]];
   for(const [why,data] of bad){const r=await s.put({name,data});expect(r.status,why).toBe(400);expect((await r.json()).error).toBe('invalid_image');}
   expect(await readdir(path.join(s.nb,'assets'))).toEqual([s.base+'.svg']);
   const orphan='diagram-'+'9'.repeat(64)+'.png';const r=await s.put({name:orphan,data:b64(makePng(50,50))});expect(r.status).toBe(400);expect((await r.json()).message).toContain('no svg');
   expect(await readdir(path.join(s.nb,'assets'))).toEqual([s.base+'.svg']);
  }finally{await s.close();}
 });
 it('keeps the first picture: a second one for the same diagram changes nothing',async()=>{
  const s=await server(),name=s.base+'.png';
  try{await s.put({name,data:b64(makePng(300,200,{shade:10}))});const again=await s.put({name,data:b64(makePng(500,100,{shade:99}))});expect(again.status).toBe(200);expect(await again.json()).toMatchObject({width:300,height:200});}finally{await s.close();}
 });
});
