import {mkdtemp,readdir,rm,stat,utimes,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {LedgerStore,type LedgerEvent} from '../server/ledger-store.ts';

// The ledger's lock file, on the platform's own terms. Root cause of the flaky "two stores append at once" test (observed under load, on Windows): the lock was only waited for on EEXIST. A file operation on the
// lock, the ledger or its temp file can fail for a moment with EPERM / EBUSY / EACCES (a scanner or another handle holds it; a file just removed is still "delete pending") and that threw straight out of
// append(). The file system is made to fail on purpose here instead of waiting for load to do it.
const hooks=vi.hoisted(()=>({lockOpens:0,failLockOpen:[] as string[],failLockUnlink:[] as string[],failRename:[] as string[],failRead:[] as string[]}));
vi.mock('node:fs/promises',async(original)=>{
 const real=await original<typeof import('node:fs/promises')>(),boom=(code:string,syscall:string,p:string)=>Object.assign(new Error(`${code}: injected, ${syscall} '${p}'`),{code,syscall,path:p});
 return {...real,
  open:async(p:unknown,flags?:unknown,mode?:unknown)=>{if(typeof p==='string'&&p.endsWith('.lock')&&flags==='wx'){hooks.lockOpens++;const c=hooks.failLockOpen.shift();if(c)throw boom(c,'open',p);}return (real.open as (...a:unknown[])=>Promise<unknown>)(p,flags,mode);},
  unlink:async(p:unknown)=>{if(typeof p==='string'&&p.endsWith('.lock')){const c=hooks.failLockUnlink.shift();if(c)throw boom(c,'unlink',p);}return real.unlink(p as string);},
  readFile:async(p:unknown,...rest:unknown[])=>{if(typeof p==='string'&&p.endsWith('ledger.json')){const c=hooks.failRead.shift();if(c)throw boom(c,'open',p);}return (real.readFile as (...a:unknown[])=>Promise<unknown>)(p,...rest);},
  rename:async(a:unknown,b:unknown)=>{if(typeof b==='string'&&b.endsWith('ledger.json')){const c=hooks.failRename.shift();if(c)throw boom(c,'rename',b);}return real.rename(a as string,b as string);},
 };
});
beforeEach(()=>{hooks.lockOpens=0;hooks.failLockOpen.length=hooks.failLockUnlink.length=hooks.failRename.length=hooks.failRead.length=0;});
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
 it('never takes a lock that is held, however old it looks, and gives up with the lock\'s own error after its wait',async()=>{
  const root=await temp(),store=new LedgerStore(root),lockPath=path.join(root,'ledger.json.lock');
  await writeFile(lockPath,'');const old=new Date(Date.now()-120_000);await utimes(lockPath,old,old);
  const pending=store.append(event(1));let done=false;void pending.then(()=>{done=true;},()=>{done=true;});
  await new Promise(r=>setTimeout(r,400));expect(done).toBe(false);expect((await stat(lockPath)).isFile()).toBe(true); // an old-looking lock is still somebody's: it is waited for, never broken
  await rm(lockPath);await pending;expect(await ids(store)).toEqual(['e1']);await clean(root);
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
