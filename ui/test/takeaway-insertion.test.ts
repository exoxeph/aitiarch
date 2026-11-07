import {expect,it} from 'vitest';import {EditorState} from '@codemirror/state';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {previewTakeawayInsertion} from '../shared/takeaway-insertion.ts';import {captureAnchor} from '../shared/anchors.ts';import {newThread} from '../shared/threads.ts';import type {InkItem} from '../shared/ink.ts';import {Store} from '../server/store.ts';
it('explicit preview applies a normal editor transaction and compare-and-write preserves BOM/CRLF and surrounding bytes',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-takeaway-'));try{
 const file=path.join(root,'fixture.md'),original=Buffer.from('\ufeff# Fixture\r\n\r\nSelected paragraph.\r\n\r\nKeep exactly.\r\n');await writeFile(file,original);const store=await Store.open(root),note=await store.read('fixture.md');
 const from=note.text.indexOf('Selected'),anchor=captureAnchor(note.text,from,from+19);const item:InkItem={id:'t',kind:'answer',body:'Synthetic.',anchor,originalAnchor:anchor,attachment:{status:'attached',...anchor.position}};item.thread=newThread(item);item.thread.takeaway={state:'submitted',text:'My own takeaway.',updatedAt:'2026-11-08T00:00:00Z',events:[{action:'submit',text:'My own takeaway.',at:'2026-11-08T00:00:00Z'}]};
 const preview=previewTakeawayInsertion(note,item,note.version);expect(await readFile(file)).toEqual(original);
 const state=EditorState.create({doc:note.text}).update({changes:preview.changes}).state;expect(await store.write('fixture.md',state.doc.toString(),note.version)).toMatchObject({ok:true});
 expect(await readFile(file)).toEqual(Buffer.from('\ufeff# Fixture\r\n\r\nSelected paragraph.\r\n\r\nMy own takeaway.\r\n\r\nKeep exactly.\r\n'));
 expect(()=>previewTakeawayInsertion(note,item,'stale')).toThrow(/changed/i);
 await writeFile(file,Buffer.from('external change'));expect(await store.write('fixture.md',state.doc.toString(),note.version)).toMatchObject({ok:false,reason:'conflict'});
 item.attachment={status:'orphaned',reason:'missing'};expect(()=>previewTakeawayInsertion(note,item,note.version)).toThrow(/anchor/i);
 }finally{await rm(root,{recursive:true,force:true});}
});
