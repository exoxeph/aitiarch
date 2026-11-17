import {mkdtemp} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {LedgerStore,appendLedger,type LedgerEvent} from '../server/ledger-store.ts';
import * as native from '../shared/invoked-usage.ts';
let root:string;
beforeEach(async()=>{root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-ledger-invoked-'));vi.stubEnv('AITIARCH_CONFIG_DIR',root);});
afterEach(()=>vi.unstubAllEnvs());
const row=(amount:number|null):LedgerEvent=>({id:'audit-one',inkId:'ink-one',requestId:'request-one',note:'fixture.md',at:'2026-11-17T00:00:00Z',event:'invoked_turn',
 invoked:{provider:'codex',unit:'tokens',amount,budgetCharge:amount??40000,cap:40000,overCap:false,status:'ok',durationMs:12}});
it.each([null,0,35])('round-trips native usage %s without double counting or changing older events',async amount=>{
 const ledger=new LedgerStore(root);await appendLedger(ledger,{id:'old',inkId:'old',requestId:'old',note:'fixture.md',at:'2026-11-17T00:00:00Z',event:'shown'});
 await appendLedger(ledger,row(amount));await appendLedger(ledger,row(amount));
 const read=await ledger.read();expect(read.events).toHaveLength(2);expect(read.events[1]).toEqual(row(amount));
});
it('labels missing usage separately from a measured zero and rejects mixed units',()=>{
 const absent=native.invokedUsage([],40000);expect(absent).toMatchObject({amount:null,budgetCharge:40000});
 expect(native.invokedUsageLabel(absent)).toContain('not reported');
 expect(native.invokedUsageLabel(native.invokedUsage([{unit:'tokens',amount:0,afterTurn:true}],40000))).toContain('0 tokens');
 expect(()=>native.invokedUsage([{unit:'usd',amount:1,afterTurn:true}],40000)).toThrow();
 expect(()=>native.invokedUsage([{unit:'tokens',amount:1,afterTurn:true},{unit:'tokens',amount:1,afterTurn:true}],40000)).toThrow();
});
it('rejects invented zero, wrong units and content-bearing audit fields',async()=>{
 const ledger=new LedgerStore(root);
 for(const patch of [{unit:'usd'},{amount:null,budgetCharge:0},{answer:'must not persist'}]){
  const entry=row(null);Object.assign(entry.invoked!,patch);await expect(ledger.append(entry)).rejects.toThrow();
 }
 expect((await ledger.read()).events).toEqual([]);
});
