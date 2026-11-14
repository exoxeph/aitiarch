import {mkdir,mkdtemp,readdir,rm,stat,utimes,writeFile} from 'node:fs/promises';
import {readFileSync,existsSync} from 'node:fs';
import {spawn} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {LedgerStore,judgeLock,processAlive,type LedgerEvent} from '../server/ledger-store.ts';

// The ledger's lock file, on the platform's own terms. Root cause of the flaky "two stores append at once" test (observed under load, on Windows): the lock was only waited for on EEXIST. A file operation on the
// lock, the ledger or its temp file can fail for a moment with EPERM / EBUSY / EACCES (a scanner or another handle holds it; a file just removed is still "delete pending") and that threw straight out of
// append(). The file system is made to fail on purpose here instead of waiting for load to do it.
const hooks=vi.hoisted(()=>({lockOpens:0,failLockOpen:[] as string[],failLockUnlink:[] as string[],failRename:[] as string[],failRead:[] as string[],failLink:[] as string[],
 /** Stale-lock tests: runs before the nth read of a lock file (1-based), before a lock is moved away to be broken, and when the temp file is created. */
 lockReads:0,lockRenames:0,onLockRead:null as null|((n:number)=>Promise<void>),onLockRename:null as null|(()=>Promise<void>),onTempOpen:null as null|(()=>Promise<void>),inside:0,maxInside:0}));
vi.mock('node:fs/promises',async(original)=>{
 const real=await original<typeof import('node:fs/promises')>(),boom=(code:string,syscall:string,p:string)=>Object.assign(new Error(`${code}: injected, ${syscall} '${p}'`),{code,syscall,path:p});
 return {...real,
  link:async(a:string,b:string)=>{const c=hooks.failLink.shift();if(c)throw boom(c,'link',b);return real.link(a,b);},
  open:async(p:unknown,flags?:unknown,mode?:unknown)=>{if(typeof p==='string'&&p.endsWith('.lock')&&flags==='wx'){hooks.lockOpens++;const c=hooks.failLockOpen.shift();if(c)throw boom(c,'open',p);}
   if(typeof p==='string'&&p.endsWith('.tmp')&&flags==='wx'){hooks.inside++;hooks.maxInside=Math.max(hooks.maxInside,hooks.inside);await hooks.onTempOpen?.();}
   return (real.open as (...a:unknown[])=>Promise<unknown>)(p,flags,mode);},
  unlink:async(p:unknown)=>{if(typeof p==='string'&&p.endsWith('.lock')){const c=hooks.failLockUnlink.shift();if(c)throw boom(c,'unlink',p);}return real.unlink(p as string);},
  readFile:async(p:unknown,...rest:unknown[])=>{if(typeof p==='string'&&p.endsWith('.lock')){const n=++hooks.lockReads;await hooks.onLockRead?.(n);}
   if(typeof p==='string'&&p.endsWith('ledger.json')){const c=hooks.failRead.shift();if(c)throw boom(c,'open',p);}return (real.readFile as (...a:unknown[])=>Promise<unknown>)(p,...rest);},
  rename:async(a:unknown,b:unknown)=>{if(typeof a==='string'&&a.endsWith('.lock')){hooks.lockRenames++;await hooks.onLockRename?.();}
   if(typeof b==='string'&&b.endsWith('ledger.json')){try{const c=hooks.failRename.shift();if(c)throw boom(c,'rename',b);const r=await real.rename(a as string,b as string);hooks.inside--;return r;}catch(e){throw e;}}
   return real.rename(a as string,b as string);},
 };
});
beforeEach(()=>{hooks.lockOpens=hooks.lockReads=hooks.lockRenames=hooks.inside=hooks.maxInside=0;hooks.onLockRead=hooks.onLockRename=hooks.onTempOpen=null;hooks.failLink.length=hooks.failLockOpen.length=hooks.failLockUnlink.length=hooks.failRename.length=hooks.failRead.length=0;});
const dirs:string[]=[];afterEach(async()=>{for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
const temp=async()=>{const d=await mkdtemp(path.join(os.tmpdir(),'aitiarch-ll-'));dirs.push(d);return d;};
const turn={session:'e50d1e40-4aaa-47b0-923c-3a17de41469d',mode:'investigate' as const,inputTokens:1,cachedTokens:0,outputTokens:1,costUsd:0.01,outcome:'completed'};
const event=(i:number):LedgerEvent=>({id:'e'+i,inkId:'investigate-x',requestId:'r'+i,note:'',event:'investigate_turn',at:new Date().toISOString(),turn});
const ids=async(s:LedgerStore)=>(await s.read()).events.map(e=>e.id).sort();
const clean=async(root:string)=>expect(await readdir(root)).toEqual(['ledger.json']); // no lock file and no temp file left behind

describe('a moment when the file system says no',()=>{
 it.each(['EPERM','EBUSY','EACCES'])('opening the lock fails with %s a few times: the append waits and then goes through',async code=>{
  const root=await temp(),store=new LedgerStore(root);hooks.failLockOpen.push(code,code,code);
  await expect(store.append(event(1))).resolves.toBeUndefined();expect(await ids(store)).toEqual(['e1']);expect(hooks.lockOpens).toBe(4);await clean(root);
 });
 it('an error that is not a passing one is not waited for: it fails at once, and the next append works',async()=>{
  const root=await temp(),store=new LedgerStore(root);hooks.failLockOpen.push('ENOSPC');
  await expect(store.append(event(1))).rejects.toMatchObject({code:'ENOSPC'});expect(hooks.lockOpens).toBe(1);
  await expect(store.append(event(2))).resolves.toBeUndefined();expect(await ids(store)).toEqual(['e2']);
 });
 it('removing the lock fails for a moment: the event is kept, the lock is removed on a later try, and the next append is not blocked',async()=>{
  const root=await temp(),store=new LedgerStore(root);hooks.failLockUnlink.push('EPERM','EBUSY');
  await expect(store.append(event(1))).resolves.toBeUndefined();await clean(root);
  await expect(store.append(event(2))).resolves.toBeUndefined();expect(await ids(store)).toEqual(['e1','e2']);
 });
 it('reading the ledger fails for a moment (EPERM, a scanner has it): the read is tried again, for an append and for a reader',async()=>{
  const root=await temp(),store=new LedgerStore(root);await store.append(event(1));
  hooks.failRead.push('EPERM','EBUSY');await expect(store.append(event(2))).resolves.toBeUndefined();
  hooks.failRead.push('EACCES');expect(await ids(store)).toEqual(['e1','e2']);
 });
 it('replacing the ledger file fails for a moment (a reader has it): the swap is tried again and nothing is lost',async()=>{
  const root=await temp(),store=new LedgerStore(root);hooks.failRename.push('EPERM','EBUSY');
  await expect(store.append(event(1))).resolves.toBeUndefined();expect(await ids(store)).toEqual(['e1']);await clean(root);
 });
});

describe('the lock between processes',()=>{
 it('waits for a lock another process holds and goes ahead when it is released, without losing an event',async()=>{
  const root=await temp(),a=new LedgerStore(root),b=new LedgerStore(root),lockPath=path.join(root,'ledger.json.lock');
  await writeFile(lockPath,'');const work=Promise.all(Array.from({length:6},(_,i)=>(i%2?a:b).append(event(i))));
  await new Promise(r=>setTimeout(r,300));await rm(lockPath);await work;expect(await ids(a)).toEqual(['e0','e1','e2','e3','e4','e5']);
 });
 it('an old empty lock is broken using its modification time',async()=>{
  const root=await temp(),store=new LedgerStore(root),lockPath=path.join(root,'ledger.json.lock');
  await writeFile(lockPath,'');const old=new Date(Date.now()-120_000);await utimes(lockPath,old,old);
  await store.append(event(1));expect(await ids(store)).toEqual(['e1']);await clean(root);
 });});

describe('stores of one process',()=>{
 it('two stores on one file append at the same moment without losing either, also while the file system says no for a moment',async()=>{
  const root=await temp(),a=new LedgerStore(root),b=new LedgerStore(root);hooks.failLockOpen.push('EPERM','EBUSY','EPERM');hooks.failLockUnlink.push('EPERM');hooks.failRename.push('EBUSY');
  await Promise.all(Array.from({length:12},(_,i)=>(i%2?a:b).append(event(i))));
  expect(await ids(a)).toEqual(Array.from({length:12},(_,i)=>'e'+i).sort());await clean(root);
 });
 it('a failed append does not stop the ones queued behind it, in the same store or in another',async()=>{
  const root=await temp(),a=new LedgerStore(root),b=new LedgerStore(root);
  const bad=a.append({...event(0),turn:{...turn,session:'nope'}} as LedgerEvent),good=[a.append(event(1)),b.append(event(2))];
  await expect(bad).rejects.toThrow();await Promise.all(good);expect(await ids(a)).toEqual(['e1','e2']);
 });
});

// Stale-lock recovery. A lock file holds {pid, startedAt, id}. It may be broken only when its pid is not running or it is older than 60 s; a live fresh lock, or one that cannot be read or parsed, is waited for as before.
const lockPath=(root:string)=>path.join(root,'ledger.json.lock');
const lockText=(pid:number,startedAt:number,id='other')=>JSON.stringify({pid,startedAt,id});
const deadPid=()=>new Promise<number>((res,rej)=>{const c=spawn(process.execPath,['-e','0'],{stdio:'ignore'}),pid=c.pid!;c.once('error',rej);c.once('exit',()=>res(pid));});
const settle=(p:Promise<unknown>)=>{const s={done:false};void p.then(()=>{s.done=true;},()=>{s.done=true;});return s;};
const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));

describe('judging a lock file',()=>{
 const now=1_000_000_000,alive=(live:number[])=>(pid:number)=>live.includes(pid);
 it('a live holder, fresh: held',()=>expect(judgeLock(lockText(7,now-1000),now,alive([7]))).toBe('held'));
 it('a pid that is not running: stale',()=>expect(judgeLock(lockText(7,now-1000),now,alive([]))).toBe('stale'));
 it('older than 60 s: stale even when the pid is running (the pid may have been reused)',()=>expect(judgeLock(lockText(7,now-61_000),now,alive([7]))).toBe('stale'));
 it('exactly 60 s old and live: still held',()=>expect(judgeLock(lockText(7,now-60_000),now,alive([7]))).toBe('held'));
 it('a start time in the future is not old',()=>expect(judgeLock(lockText(7,now+600_000),now,alive([7]))).toBe('held'));
 it.each(['','not json','{}','[]','null','{"pid":"7","startedAt":1}','{"pid":-3,"startedAt":1}','{"pid":0,"startedAt":1}','{"pid":1.5,"startedAt":1}','{"pid":7}','{"pid":7,"startedAt":"x"}','{"pid":7,"startedAt":null}'])('cannot be parsed or has no usable pid and time (%j): unreadable, never stale',raw=>expect(judgeLock(raw,now,alive([]))).toBe('unreadable'));
 it('this process is running; a process that ended is not',async()=>{expect(processAlive(process.pid)).toBe(true);expect(processAlive(await deadPid())).toBe(false);});
 it('an unsupported process liveness check conservatively treats the holder as alive',()=>{
  const kill=vi.spyOn(process,'kill').mockImplementation(()=>{throw Object.assign(new Error('unsupported'),{code:'ENOSYS'});});
  try{expect(processAlive(123)).toBe(true);}finally{kill.mockRestore();}
 });
});

describe('breaking a stale lock',()=>{
 it('a lock whose pid is not running is broken at once and the event is saved',async()=>{
  const root=await temp(),store=new LedgerStore(root);await writeFile(lockPath(root),lockText(await deadPid(),Date.now()));
  const t=Date.now();await store.append(event(1));expect(Date.now()-t).toBeLessThan(2000);expect(await ids(store)).toEqual(['e1']);expect(hooks.lockRenames).toBe(1);await clean(root);
 });
 it('a lock older than 60 s is broken even when its pid is running',async()=>{
  const root=await temp(),store=new LedgerStore(root);await writeFile(lockPath(root),lockText(process.pid,Date.now()-61_000));
  const t=Date.now();await store.append(event(1));expect(Date.now()-t).toBeLessThan(2000);expect(await ids(store)).toEqual(['e1']);expect(hooks.lockRenames).toBe(1);await clean(root);
 });
 it.each([0,1000,30_000,59_000])('a live holder\'s lock, %i ms old, is respected until it is released',async age=>{
  const root=await temp(),store=new LedgerStore(root),mine=lockText(process.pid,Date.now()-age,'live');await writeFile(lockPath(root),mine);
  const pending=store.append(event(1)),s=settle(pending);await wait(400);
  expect(s.done).toBe(false);expect(readFileSync(lockPath(root),'utf8')).toBe(mine);expect(hooks.lockRenames).toBe(0);
  await rm(lockPath(root));await pending;expect(await ids(store)).toEqual(['e1']);await clean(root);
 });
 it.each(['','not json','{}','{"pid":"x"}','{"pid":-5,"startedAt":1}','{"pid":7,"startedAt":"yesterday"}','[1,2]'])('old unparseable lock (%j) is broken only after 60 seconds',async raw=>{
  const root=await temp(),store=new LedgerStore(root);await writeFile(lockPath(root),raw);const old=new Date(Date.now()-600_000);await utimes(lockPath(root),old,old);
  await store.append(event(1));expect(hooks.lockRenames).toBe(1);expect(await ids(store)).toEqual(['e1']);await clean(root);
 });
 it.each(['','not json','{}'])('fresh unparseable lock (%j) is respected',async raw=>{
  const root=await temp(),store=new LedgerStore(root);await writeFile(lockPath(root),raw);
  const pending=store.append(event(1)),s=settle(pending);await wait(400);
  expect(s.done).toBe(false);expect(readFileSync(lockPath(root),'utf8')).toBe(raw);expect(hooks.lockRenames).toBe(0);
  console.log('CLEANUP TARGET',lockPath(root));await rm(lockPath(root));await pending;
 });
 it('identical garbage refreshed before rename is put back and respected',async()=>{
  const root=await temp(),store=new LedgerStore(root),raw='garbage';await writeFile(lockPath(root),raw);const old=new Date(Date.now()-120_000);await utimes(lockPath(root),old,old);
  let swapped=false;hooks.onLockRename=async()=>{if(!swapped){swapped=true;await writeFile(lockPath(root),raw);}};
  const pending=store.append(event(1)),s=settle(pending);await wait(400);
  expect(swapped).toBe(true);expect(s.done).toBe(false);expect(readFileSync(lockPath(root),'utf8')).toBe(raw);
  console.log('CLEANUP TARGET',lockPath(root));await rm(lockPath(root));await pending;
 });
 it('garbage exactly 60 seconds old is still respected',async()=>{
  const root=await temp(),store=new LedgerStore(root),now=1_900_000_000_000;await writeFile(lockPath(root),'garbage');await utimes(lockPath(root),(now-60_000)/1000,(now-60_000)/1000);
  const clock=vi.spyOn(Date,'now').mockReturnValue(now),pending=store.append(event(1)),s=settle(pending);
  try{await wait(100);expect(s.done).toBe(false);expect(hooks.lockRenames).toBe(0);}finally{clock.mockRestore();console.log('CLEANUP TARGET',lockPath(root));await rm(lockPath(root));await pending;}
 });
 it('restores a replacement lock without overwriting when hard links are unsupported',async()=>{
  const root=await temp(),store=new LedgerStore(root),fresh=lockText(process.pid,Date.now(),'fresh');await writeFile(lockPath(root),lockText(process.pid,Date.now()-120_000));
  let swapped=false;hooks.onLockRename=async()=>{if(!swapped){swapped=true;await writeFile(lockPath(root),fresh);}};hooks.failLink.push('ENOSYS');
  const pending=store.append(event(1)),s=settle(pending);
  try{await wait(400);expect(s.done).toBe(false);expect(readFileSync(lockPath(root),'utf8')).toBe(fresh);}finally{console.log('CLEANUP TARGET',lockPath(root));await rm(lockPath(root),{force:true});await pending;}
 });
 it('a lock that cannot be read (a directory in its place) is waited for, not broken',async()=>{
  const root=await temp(),store=new LedgerStore(root);await mkdir(lockPath(root));const old=new Date(Date.now()-600_000);await utimes(lockPath(root),old,old);
  const pending=store.append(event(1)),s=settle(pending);await wait(400);
  expect(s.done).toBe(false);expect(hooks.lockRenames).toBe(0);expect(existsSync(lockPath(root))).toBe(true);
  await rm(lockPath(root),{recursive:true});await pending;expect(await ids(store)).toEqual(['e1']);
 });
 it.each([2,3,4])('%i stores racing to break one dead lock: only one at a time is inside, and no event is lost',async n=>{
  const root=await temp(),stores=Array.from({length:n},()=>new LedgerStore(root));await writeFile(lockPath(root),lockText(await deadPid(),Date.now()));
  hooks.onTempOpen=async()=>{await wait(10);};
  await Promise.all(Array.from({length:12},(_,i)=>stores[i%n].append(event(i))));
  expect(hooks.maxInside).toBe(1);expect(hooks.lockRenames).toBeGreaterThanOrEqual(1);expect(await ids(stores[0])).toEqual(Array.from({length:12},(_,i)=>'e'+i).sort());await clean(root);
 });
 it('the lock is replaced by a live one after it was judged stale and before it is read again: it is not touched',async()=>{
  const root=await temp(),store=new LedgerStore(root),fresh=lockText(process.pid,Date.now(),'fresh');await writeFile(lockPath(root),lockText(await deadPid(),Date.now()));
  hooks.onLockRead=async n=>{if(n===2)await writeFile(lockPath(root),fresh);};
  const pending=store.append(event(1)),s=settle(pending);await wait(400);
  expect(s.done).toBe(false);expect(hooks.lockRenames).toBe(0);expect(readFileSync(lockPath(root),'utf8')).toBe(fresh);
  await rm(lockPath(root));await pending;expect(await ids(store)).toEqual(['e1']);await clean(root);
 });
 it('the lock is replaced by a live one just before it is moved away: it is put back whole and respected',async()=>{
  const root=await temp(),store=new LedgerStore(root),fresh=lockText(process.pid,Date.now(),'fresh');await writeFile(lockPath(root),lockText(await deadPid(),Date.now()));
  let swapped=false;hooks.onLockRename=async()=>{if(!swapped){swapped=true;await writeFile(lockPath(root),fresh);}};
  const pending=store.append(event(1)),s=settle(pending);await wait(500);
  expect(swapped).toBe(true);expect(s.done).toBe(false);expect(readFileSync(lockPath(root),'utf8')).toBe(fresh);
  expect((await readdir(root)).filter(f=>f.includes('.broken.'))).toEqual([]);
  await rm(lockPath(root));await pending;expect(await ids(store)).toEqual(['e1']);await clean(root);
 });
 it('a holder whose lock was taken over (it ran past 60 s) writes nothing and does not remove the new holder\'s lock',async()=>{
  const root=await temp(),store=new LedgerStore(root),theirs=lockText(process.pid,Date.now(),'theirs');
  hooks.onTempOpen=async()=>{await writeFile(lockPath(root),theirs);};
  await expect(store.append(event(1))).rejects.toThrow(/taken over/);
  expect(readFileSync(lockPath(root),'utf8')).toBe(theirs);expect(existsSync(path.join(root,'ledger.json'))).toBe(false);
  expect((await readdir(root)).filter(f=>f.endsWith('.tmp'))).toEqual([]);
 });
 it('while it holds the lock an append records its own pid and start time',async()=>{
  const root=await temp(),store=new LedgerStore(root);let seen:unknown=null;
  hooks.onTempOpen=async()=>{seen=JSON.parse(readFileSync(lockPath(root),'utf8'));};
  const t=Date.now();await store.append(event(1));
  expect(seen).toMatchObject({pid:process.pid});const s=seen as {pid:number;startedAt:number;id:string};
  expect(Number.isSafeInteger(s.pid)).toBe(true);expect(s.startedAt).toBeGreaterThanOrEqual(t-50);expect(s.startedAt).toBeLessThanOrEqual(Date.now());expect(typeof s.id).toBe('string');await clean(root);
 });
});
