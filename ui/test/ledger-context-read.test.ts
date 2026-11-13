import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach,describe,expect,it} from 'vitest';
import {LedgerStore,validContextFields,validContextSelection,type LedgerEvent} from '../server/ledger-store.ts';

// A context_read line says which note was read, how many characters were sent and whether a selection went with the request, never any text.
// Lines written before those fields existed stay readable.
const dirs:string[]=[];afterEach(async()=>{for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
const temp=async()=>{const d=await mkdtemp(path.join(os.tmpdir(),'aitiarch-ledger-ctx-'));dirs.push(d);return d;};
const H='a'.repeat(64);
const line=(extra:Record<string,unknown>={},id='e1'):LedgerEvent=>({id,inkId:'chat-x',requestId:'r1',note:'plan.md',event:'context_read',moduleId:'this-note',sourceHash:H,at:'2026-11-14T00:00:00.000Z',...extra} as LedgerEvent);
const OLD=(id:string)=>({id,inkId:'chat-x',requestId:'r0',note:'plan.md',event:'context_read',moduleId:'other-notes',sourceHash:H,at:'2026-11-13T00:00:00.000Z'});
const write=async(root:string,events:unknown[])=>writeFile(path.join(root,'ledger.json'),JSON.stringify({v:1,events},null,2)+'\n');

describe('context_read lines in the ledger',()=>{
 it('reads lines written before the new fields existed, next to new ones, and keeps both when it writes',async()=>{
  const root=await temp();await write(root,[OLD('old-1'),{id:'c1',inkId:'chat-x',requestId:'r0',note:'plan.md',event:'chat_started',at:'2026-11-13T00:00:01.000Z'}]);
  const ledger=new LedgerStore(root);expect((await ledger.read()).events).toHaveLength(2);
  await ledger.append(line({path:'ideas.md',chars:79},'new-1'));
  const events=(await new LedgerStore(root).read()).events;expect(events.map(e=>e.id)).toEqual(['old-1','c1','new-1']);
  expect(events[0]).toEqual(OLD('old-1'));expect(events[2]).toMatchObject({path:'ideas.md',chars:79}); // the old line is untouched, the new one carries the note and its size
 });
 it('takes the note, the size and the selection, each on its own or together',async()=>{
  const root=await temp(),ledger=new LedgerStore(root);
  await ledger.append(line({path:'ideas.md'},'a'));await ledger.append(line({chars:0},'b'));await ledger.append(line({path:'ideas.md',chars:79},'c'));
  await ledger.append(line({path:'ideas.md',selection:{chars:34,fromLine:3,toLine:7}},'d'));await ledger.append(line({path:'ideas.md',selection:{chars:34}},'e'));
  expect((await ledger.read()).events.map(e=>e.id)).toEqual(['a','b','c','d','e']);
 });
 it('refuses a context_read that carries anything else, before it is written',async()=>{
  const root=await temp(),ledger=new LedgerStore(root);await ledger.append(line({},'ok'));const before=await readFile(path.join(root,'ledger.json'),'utf8');
  const bad:Record<string,unknown>[]=[{text:'note text'},{label:'a title'},{path:''},{path:'a\nb.md'},{path:'x'.repeat(401)},{path:7},{chars:-1},{chars:1.5},{chars:'12'},{chars:1e9},
   {selection:{}},{selection:{chars:0}},{selection:{chars:5,text:'quoted'}},{selection:{chars:5,fromLine:3}},{selection:{chars:5,fromLine:7,toLine:3}},{selection:{chars:5,fromLine:0,toLine:1}},{selection:[]},{selection:null},{selection:'3-5'}];
  for(const extra of bad)await expect(ledger.append(line(extra,'bad')),JSON.stringify(extra)).rejects.toThrow();
  await expect(ledger.append({...line({},'no-hash'),sourceHash:undefined} as unknown as LedgerEvent)).rejects.toThrow();
  expect(await readFile(path.join(root,'ledger.json'),'utf8')).toBe(before); // nothing was written
 });
 it('refuses a ledger file that holds such a line, and keeps the file as it is',async()=>{
  const root=await temp();for(const extra of [{text:'note text'},{chars:-3},{path:'a\u0000b'},{selection:{chars:2,fromLine:9,toLine:1}}]){
   await write(root,[OLD('old'),line(extra,'bad')]);await expect(new LedgerStore(root).read(),JSON.stringify(extra)).rejects.toThrow(/Invalid ledger/);
  }
 });
 it('only a context_read may carry them: other lines stay as strict as before',async()=>{
  const root=await temp(),ledger=new LedgerStore(root);
  await expect(ledger.append({id:'x',inkId:'chat-x',requestId:'r',note:'plan.md',event:'chat_started',at:'2026-11-14T00:00:00.000Z',path:'ideas.md'} as unknown as LedgerEvent)).resolves.toBeUndefined(); // append does not look at other lines...
  await expect(ledger.read()).rejects.toThrow(/Invalid ledger/); // ...but reading will not accept a chat line with a path
 });
 it('says what is a valid selection and a valid set of fields',()=>{
  expect(validContextSelection({chars:10,fromLine:2,toLine:2})).toBe(true);expect(validContextSelection({chars:10})).toBe(true);expect(validContextSelection({chars:10,toLine:2})).toBe(false);
  expect(validContextFields(line({path:'a.md',chars:5}))).toBe(true);expect(validContextFields(line())).toBe(true);expect(validContextFields(line({path:' '.repeat(0)}))).toBe(false);
 });
});
