import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {expect,it,vi} from 'vitest';
import {EditorState} from '@codemirror/state';
import {history,isolateHistory,redo,undo} from '@codemirror/commands';
import {previewAiCallout} from '../shared/thoughts.ts';
import {captureAnchor} from '../shared/anchors.ts';
import {encode,decode} from '../server/codec.ts';
import {InkStore} from '../server/ink-store.ts';
import {InsertionStore} from '../server/insertion-store.ts';
import {LedgerStore} from '../server/ledger-store.ts';
import {Store} from '../server/store.ts';

const richLines=['  Keep $a+b$ and trailing spaces  ','> $$','> \\frac{1}{2}','> $$','',
 '```mermaid','flowchart TD','A --> B','```','','```js','const price = "$20";','```'];
const original=Buffer.from('\uFEFF# Fictional\r\n\r\nInsert after here.  \r\n\r\nAnchor remains.\r\n');
const exact=Buffer.from('\uFEFF# Fictional\r\n\r\nInsert after here.  \r\n\r\n> [!ai]\r\n'+
 richLines.map(line=>'> '+line).join('\r\n')+'\r\n\r\nAnchor remains.\r\n');

it('inserts only the reviewed source and preserves BOM, CRLF, anchors, one-step Undo and Redo',()=>{
 const note=decode(original),from=note.text.indexOf('Anchor remains.');
 const anchor=captureAnchor(note.text,from,from+'Anchor remains.'.length);
 const preview=previewAiCallout(note,richLines.join('\r\n'),note.text.indexOf('after'));
 const state=EditorState.create({doc:note.text,extensions:[history()]});
 const transaction=state.update({changes:preview.changes,annotations:isolateHistory.of('full')});
 const v={state:transaction.state,dispatch:(tr:typeof transaction)=>{v.state=tr.state;}};
 expect(encode(v.state.doc.toString(),note)).toEqual(exact);
 const mappedFrom=transaction.changes.mapPos(anchor.position.from);
 expect(v.state.sliceDoc(mappedFrom,transaction.changes.mapPos(anchor.position.to))).toBe(anchor.quote);
 expect(undo(v)).toBe(true);
 expect(encode(v.state.doc.toString(),note)).toEqual(original);
 expect(redo(v)).toBe(true);
 expect(encode(v.state.doc.toString(),note)).toEqual(exact);
});

it('refuses a stale review and repairs a ledger failure without repeating the insert',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-rich-insert-')),file=path.join(root,'fixture.md');
 await writeFile(file,original);
 const store=await Store.open(root),ink=await InkStore.open(root),ledger=new LedgerStore(root);
 const insertion=new InsertionStore(ink,store,ledger);
 const note=await store.read('fixture.md');
 const preview=previewAiCallout(note,richLines.join('\n'),note.text.indexOf('after'));
 await expect(insertion.prepareChat({...note,path:'fixture.md',version:'stale'},'rich',preview)).rejects.toThrow();
 const operation=await insertion.prepareChat({...note,path:'fixture.md'},'rich',preview);
 await writeFile(file,exact);
 const append=vi.spyOn(ledger,'append').mockRejectedValue(new Error('Synthetic ledger failure'));
 await expect(insertion.complete('fixture.md',operation.operationId)).resolves.toMatchObject({pending:1});
 append.mockRestore();
 await expect(new InsertionStore(ink,store,ledger).reconcile('fixture.md')).resolves.toMatchObject({pending:0});
 await expect(insertion.reconcile('fixture.md')).resolves.toMatchObject({pending:0});
 expect((await ledger.read()).events.filter(event=>event.event==='inserted')).toHaveLength(1);
 expect(await readFile(file)).toEqual(exact);
});
