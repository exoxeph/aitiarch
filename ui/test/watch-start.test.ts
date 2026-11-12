import {afterEach,describe,expect,it} from 'vitest';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {Store} from '../server/store.ts';
import {NoteWatcher} from '../server/watch.ts';

// Opening a big notebook must not wait for the watcher to "settle" every existing note one by one (30 ms each: 30 s for 1,000).
const temps:string[]=[],watchers:NoteWatcher[]=[];
afterEach(async()=>{for(const w of watchers.splice(0))w.stop();for(const t of temps.splice(0))await rm(t,{recursive:true,force:true,maxRetries:5});});

describe('starting the watcher on a big notebook',()=>{
 it('takes a baseline of 300 notes without settling each one',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-watch-'));temps.push(root);
  for(let i=0;i<300;i++){await mkdir(path.join(root,`f${i%10}`),{recursive:true});await writeFile(path.join(root,`f${i%10}`,`n${i}.md`),`# ${i}\n`);}
  const w=new NoteWatcher(await Store.open(root),250,30,false);watchers.push(w);
  const t0=Date.now();await w.start();
  expect(Date.now()-t0).toBeLessThan(3000); // settling each would take 300 × 30 ms = 9 s
 });
 it('still reports a note that changes after the baseline',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-watch-'));temps.push(root);
  await writeFile(path.join(root,'a.md'),'one\n');
  const w=new NoteWatcher(await Store.open(root),50,10,false);watchers.push(w);
  const seen:string[]=[];w.on('event',(e:{type:string;path?:string})=>{if(e.type==='changed')seen.push(e.path!);});
  await w.start();
  await writeFile(path.join(root,'a.md'),'two, longer\n');
  const t0=Date.now();while(!seen.length&&Date.now()-t0<3000)await new Promise(r=>setTimeout(r,50));
  expect(seen).toEqual(['a.md']);
 });
});
