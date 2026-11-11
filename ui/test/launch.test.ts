import {afterEach,describe,expect,it} from 'vitest';
import http from 'node:http';import type {AddressInfo} from 'node:net';
import {mkdtemp,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {DEFAULT_PORT,listenOrReuse,probeHealth,readInstance,writeInstance,clearInstance} from '../server/launch.ts';

// Fixed port 4317: reuse a running Aitiarch, say plainly when something else holds the port.
const servers:http.Server[]=[],temps:string[]=[];
afterEach(async()=>{for(const s of servers.splice(0)){s.closeAllConnections();await new Promise(r=>s.close(r));}for(const t of temps.splice(0))await rm(t,{recursive:true,force:true});});
const occupy=(handler:http.RequestListener)=>new Promise<number>(resolve=>{const s=http.createServer(handler);servers.push(s);s.listen(0,'127.0.0.1',()=>resolve((s.address() as AddressInfo).port));});
const inUse=()=>Object.assign(new Error('in use'),{code:'EADDRINUSE'});

describe('choosing the port',()=>{
 it('defaults to 4317',()=>{expect(DEFAULT_PORT).toBe(4317);});
 it('listens when the port is free',async()=>{expect(await listenOrReuse(async p=>p,4317)).toEqual({kind:'listening',port:4317});});
 it('reuses the port when Aitiarch already answers on it',async()=>{
  const port=await occupy((req,res)=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(req.url==='/api/health'?JSON.stringify({app:'aitiarch',v:1}):'{}');});
  expect(await listenOrReuse(async()=>{throw inUse();},port)).toEqual({kind:'reuse',port});
 });
 it('says plainly when another program holds the port',async()=>{
  const port=await occupy((_req,res)=>{res.writeHead(200);res.end('hello');});
  await expect(listenOrReuse(async()=>{throw inUse();},port)).rejects.toThrow(`Port ${port} is in use by another program. Close it, or start Aitiarch with --port <number>.`);
 });
 it('passes other listen errors through unchanged',async()=>{await expect(listenOrReuse(async()=>{throw Object.assign(new Error('denied'),{code:'EACCES'});},4317)).rejects.toThrow('denied');});
 it('a silent port is not Aitiarch',async()=>{const port=await occupy(()=>{/* never answers */});expect(await probeHealth(port,200)).toBe(false);});
});

describe('the running-instance file',()=>{
 it('round-trips and is only cleared by the process that wrote it',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'aitiarch-inst-'));temps.push(dir);
  const info={v:1 as const,port:4317,pid:4242,token:'a'.repeat(48)};
  await writeInstance(dir,info);expect(await readInstance(dir)).toEqual(info);
  await clearInstance(dir,9999);expect(await readInstance(dir)).toEqual(info);
  await clearInstance(dir,4242);expect(await readInstance(dir)).toBeNull();
 });
 it('treats a malformed file as no instance',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'aitiarch-inst-'));temps.push(dir);
  const {writeFile}=await import('node:fs/promises');await writeFile(path.join(dir,'server.json'),'{"v":1,"port":"x"}');
  expect(await readInstance(dir)).toBeNull();
 });
});
