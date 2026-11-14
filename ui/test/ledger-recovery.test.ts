import {afterEach,expect,it,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {LedgerStore,appendLedger,LEDGER_PENDING_LIMIT,type LedgerEvent} from '../server/ledger-store.ts';
const dirs:string[]=[];afterEach(async()=>{vi.restoreAllMocks();for(const d of dirs.splice(0)){console.log('CLEANUP TARGET',d);await rm(d,{recursive:true,force:true});}});
const event=(id:string):LedgerEvent=>({id,inkId:id,requestId:id,note:'fixture.md',event:'shown',at:new Date().toISOString()});
const fixture=async()=>{const d=await mkdtemp(path.join(os.tmpdir(),'aitiarch-ledger-recovery-'));dirs.push(d);return new LedgerStore(d);};
it('retries exactly once, logs both failures without exception text, and flushes a queued event through another store on the next success',async()=>{
 const store=await fixture(),other=new LedgerStore(path.dirname(store.auditKey)),log=vi.spyOn(console,'warn').mockImplementation(()=>{}),write=vi.spyOn(store,'append').mockRejectedValue(new Error('The ledger lock was taken over; nothing was written.'));
 expect(await appendLedger(store,event('first'))).toBe(false);expect(write).toHaveBeenCalledTimes(2);expect(log).toHaveBeenCalledTimes(2);
 expect(Object.keys(log.mock.calls[0][1]).sort()).toEqual(['attempt','code','event','kind','pending']);
 expect(JSON.stringify(log.mock.calls)).toContain('lock_taken_over');expect(JSON.stringify(log.mock.calls)).not.toContain('nothing was written');
 expect(await appendLedger(other,event('second'))).toBe(true);expect((await other.read()).events.map(e=>e.id)).toEqual(['second','first']);
});
it('a transient failure is retried once and saved, without duplicating an already committed event',async()=>{
 const store=await fixture(),original=store.append.bind(store);vi.spyOn(console,'warn').mockImplementation(()=>{});
 const write=vi.spyOn(store,'append').mockImplementationOnce(async e=>{await original(e);throw Object.assign(new Error('private error'),{code:'EIO'});}).mockImplementation(original);
 expect(await appendLedger(store,event('one'))).toBe(true);expect(write).toHaveBeenCalledTimes(2);expect((await store.read()).events.map(e=>e.id)).toEqual(['one']);
});
it('bounds pending events, drops the oldest with a logged count, keeps an immutable copy and flushes once',async()=>{
 const store=await fixture(),log=vi.spyOn(console,'warn').mockImplementation(()=>{}),write=vi.spyOn(store,'append').mockRejectedValue(Object.assign(new Error('private'),{code:'ENOSPC'}));
 const first=event('0');await appendLedger(store,first);first.id='mutated';
 for(let i=1;i<=LEDGER_PENDING_LIMIT;i++)await appendLedger(store,event(String(i)));
 expect(write).toHaveBeenCalledTimes((LEDGER_PENDING_LIMIT+1)*2);expect(log.mock.calls.some(c=>JSON.stringify(c).includes('"dropped":1'))).toBe(true);
 write.mockRestore();await appendLedger(store,event('flush'));const ids=(await store.read()).events.map(e=>e.id);expect(ids).toHaveLength(LEDGER_PENDING_LIMIT+1);expect(ids).not.toContain('0');expect(ids).not.toContain('mutated');
 await appendLedger(store,event('again'));expect((await store.read()).events).toHaveLength(LEDGER_PENDING_LIMIT+2);expect(JSON.stringify(log.mock.calls)).not.toContain('private');
});
it('serializes concurrent recovery and retains a queued event if its flush fails',async()=>{
 const store=await fixture();vi.spyOn(console,'warn').mockImplementation(()=>{});const original=store.append.bind(store);
 const write=vi.spyOn(store,'append').mockImplementation(e=>e.id==='old'?Promise.reject(new Error('private')):original(e));
 await appendLedger(store,event('old'));await Promise.all([appendLedger(store,event('a')),appendLedger(store,event('b'))]);expect((await store.read()).events.map(e=>e.id)).toEqual(['a','b']);
 write.mockRestore();await appendLedger(store,event('c'));expect((await store.read()).events.map(e=>e.id)).toEqual(['a','b','c','old']);
});
it('stops a flush at the first failed queued event and retains the remaining events without retrying each of them',async()=>{
 const store=await fixture(),original=store.append.bind(store);vi.spyOn(console,'warn').mockImplementation(()=>{});
 const write=vi.spyOn(store,'append').mockRejectedValue(new Error('disk unavailable'));
 for(const id of ['old1','old2','old3'])await appendLedger(store,event(id));
 write.mockClear();write.mockImplementation(e=>e.id.startsWith('old')?Promise.reject(new Error('disk unavailable')):original(e));
 expect(await appendLedger(store,event('new'))).toBe(true);expect(write.mock.calls.map(c=>c[0].id)).toEqual(['new','old1','old1']);
 write.mockRestore();await appendLedger(store,event('next'));expect((await store.read()).events.map(e=>e.id)).toEqual(['new','next','old1','old2','old3']);
});
