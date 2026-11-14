import {it,expect,afterEach,vi} from 'vitest';
import {mkdtemp,writeFile,readFile,rm,mkdir,symlink} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {InsertionStore} from '../server/insertion-store.ts';import {Store} from '../server/store.ts';import {InkStore} from '../server/ink-store.ts';import {LedgerStore} from '../server/ledger-store.ts';import {captureAnchor} from '../shared/anchors.ts';import {decode,encode} from '../server/codec.ts';
import {layoutDiagram} from '../src/diagrams/layout.ts';import {cicd} from './fixtures/diagrams.ts';import {spawn} from 'node:child_process';import {once} from 'node:events';import {EditorState} from '@codemirror/state';import {history,undo} from '@codemirror/commands';
const roots:string[]=[];afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function fixture(){const root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-diagram-test-'));roots.push(root);const bytes=Buffer.from('\ufeff# Invented\r\n\r\nReview the release.\r\n\r\nTail.  \r\n');await writeFile(path.join(root,'fixture.md'),bytes);
 const ink=await InkStore.open(root),s=await ink.read('fixture.md'),note=decode(bytes),anchor=captureAnchor(note.text,note.text.indexOf('Review'),note.text.indexOf('Review')+19);s.document.items.push({id:'d1',kind:'answer',body:'Synthetic answer.',diagram:cicd,anchor,originalAnchor:anchor,attachment:{status:'attached',...anchor.position},generation:{requestId:'d1',action:'think',provider:'claude',model:null,status:'complete',createdAt:'2026-11-09T00:00:00Z',evidence:[],dismissed:false}});await ink.write('fixture.md',s.document,null);const store=await Store.open(root),ledger=new LedgerStore(root),insertions=new InsertionStore(ink,store,ledger);return {root,bytes,note,ink,store,ledger,insertions,input:{path:'fixture.md',id:'d1',noteVersion:note.version,layout:await layoutDiagram(cicd),theme:'light' as const}};}
it('previews an AI markdown image, saves only a local confined SVG after confirmation, preserves BOM CRLF and one undo',async()=>{
 const f=await fixture(),p=await f.insertions.preview(f.input);expect(p.changes.insert).toMatch(/!\[AI diagram: CI\/CD with a release gate\]\(assets\/ai-diagram-[a-f0-9]{64}\.svg\)/);
 // One AI callout: the explanation first, then the diagram inside the same blockquote, in a single insertion.
 expect(p.changes.insert).toMatch(/\n\n> \[!ai\]\n> Synthetic answer\.\n> !\[AI diagram: /);expect(p.changes.insert.match(/\[!ai\]/g)).toHaveLength(1);
 await expect(readFile(path.join(f.root,'ink/insertions.json'))).rejects.toThrow();const prepared=await f.insertions.prepare({...f.input,preview:p});
 let state=EditorState.create({doc:f.note.text,extensions:[history()]});state=state.update({changes:p.changes}).state;const v={state,dispatch:(tr:any)=>{v.state=tr.state}};const edited=encode(v.state.doc.toString(),f.note);
 expect(edited.subarray(0,3)).toEqual(f.bytes.subarray(0,3));expect(edited.toString().replace(p.changes.insert.replace(/\n/g,'\r\n'),'' )).toBe(f.bytes.toString());
 const saved=await f.store.write('fixture.md',v.state.doc.toString(),f.note.version);expect(saved.ok).toBe(true);expect((await f.insertions.complete('fixture.md',prepared.operationId)).pending).toBe(0);
 const ledger=await f.ledger.read();expect(ledger.events[0]).toMatchObject({event:'inserted',authorship:'ai',insertedBy:'human'});expect(ledger.events).toHaveLength(1);await f.insertions.reconcile('fixture.md');expect((await f.ledger.read()).events).toHaveLength(1);
 expect(undo(v as any)).toBe(true);expect(encode(v.state.doc.toString(),f.note)).toEqual(f.bytes);
});
it('keeps a durable visible pending intent after ledger failure and repairs once on next load without reinserting',async()=>{
 const f=await fixture(),service=f.insertions,p=await service.preview(f.input),prepared=await service.prepare({...f.input,preview:p});const after=f.note.text.slice(0,p.changes.from)+p.changes.insert+f.note.text.slice(p.changes.to);await f.store.write('fixture.md',after,f.note.version);
 const write=vi.spyOn(f.ledger,'append').mockRejectedValue(new Error('Synthetic disk failure')),log=vi.spyOn(console,'warn').mockImplementation(()=>{});
 try{expect((await service.complete('fixture.md',prepared.operationId)).pending).toBe(1);expect(write).toHaveBeenCalledTimes(2);expect(log).toHaveBeenCalledTimes(2);}finally{write.mockRestore();log.mockRestore();}const bytes=await readFile(path.join(f.root,'fixture.md'));
 expect((await new InsertionStore(f.ink,f.store,f.ledger).reconcile('fixture.md')).pending).toBe(0);expect(await readFile(path.join(f.root,'fixture.md'))).toEqual(bytes);expect((await f.ledger.read()).events).toHaveLength(1);
});
it('stale preview and untrusted geometry fail before asset or intent creation',async()=>{
 const f=await fixture(),p=await f.insertions.preview(f.input);await f.store.write('fixture.md',f.note.text+'User edit.',f.note.version);await expect(f.insertions.prepare({...f.input,preview:p})).rejects.toThrow();await expect(readFile(path.join(f.root,'ink/insertions.json'))).rejects.toThrow();
 await expect(f.insertions.preview({...f.input,layout:{...f.input.layout,nodes:f.input.layout.nodes.map((n,i)=>i?n:{...n,labelLines:['Injected']})}})).rejects.toThrow();
});
it('cancelled or never-applied intent produces no ledger event and cannot fabricate provenance',async()=>{
 const f=await fixture(),p=await f.insertions.preview(f.input);const prepared=await f.insertions.prepare({...f.input,preview:p});expect((await f.insertions.reconcile('fixture.md')).unverified).toBe(1);await f.insertions.cancel('fixture.md',prepared.operationId);expect((await f.insertions.reconcile('fixture.md')).pending).toBe(0);expect((await f.ledger.read()).events).toHaveLength(0);
});

it('text-only Bring uses the same repair journal and never modifies human-owned fields',async()=>{
 const f=await fixture(),s=await f.ink.read('fixture.md');delete s.document.items[0].diagram;await f.ink.write('fixture.md',s.document,s.version);const input={path:'fixture.md',id:'d1',noteVersion:f.note.version},p=await f.insertions.preview(input);expect(p.changes.insert).toContain('> [!ai]');const prepared=await f.insertions.prepare({...input,preview:p});await f.store.write('fixture.md',f.note.text.slice(0,p.changes.from)+p.changes.insert+f.note.text.slice(p.changes.to),f.note.version);expect((await f.insertions.complete('fixture.md',prepared.operationId)).pending).toBe(0);expect((await f.ink.read('fixture.md')).document.items[0].thread).toBeUndefined();
});
it('asset path refusal and corrupted recovery records preserve original files',async()=>{
 const f=await fixture(),p=await f.insertions.preview(f.input);await writeFile(path.join(f.root,'assets'),'not a directory');await expect(f.insertions.prepare({...f.input,preview:p})).rejects.toThrow();expect(await readFile(path.join(f.root,'assets'),'utf8')).toBe('not a directory');await writeFile(path.join(f.root,'ink/insertions.json'),'{invalid');await expect(f.insertions.reconcile('fixture.md')).rejects.toThrow();expect(await readFile(path.join(f.root,'ink/insertions.json'),'utf8')).toBe('{invalid');
});

it('reclaims a journal lock only after its recorded owner has exited',async()=>{
 const f=await fixture(),child=spawn(process.execPath,['-e','process.exit(0)']);await once(child,'exit');await writeFile(path.join(f.root,'ink/insertions.json.lock'),JSON.stringify({pid:child.pid,token:'dead-owner'}));expect((await f.insertions.reconcile('fixture.md')).pending).toBe(0);
 await writeFile(path.join(f.root,'ink/insertions.json.lock'),JSON.stringify({pid:process.pid,token:'live-owner'}));await expect(f.insertions.reconcile('fixture.md')).rejects.toThrow();
});
it('does not record a second identical insertion when its prepared edit never happened',async()=>{
 const f=await fixture(),p=await f.insertions.preview(f.input),first=await f.insertions.prepare({...f.input,preview:p});await f.store.write('fixture.md',f.note.text.slice(0,p.changes.from)+p.changes.insert+f.note.text.slice(p.changes.to),f.note.version);await f.insertions.complete('fixture.md',first.operationId);
 const note=await f.store.read('fixture.md'),input={...f.input,noteVersion:note.version},second=await f.insertions.preview(input);await f.insertions.prepare({...input,preview:second});expect((await f.insertions.reconcile('fixture.md')).unverified).toBe(1);expect((await f.ledger.read()).events).toHaveLength(1);
});
