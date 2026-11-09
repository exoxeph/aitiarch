import {expect,it} from 'vitest';
import {EditorState} from '@codemirror/state';
import {decode,encode} from '../server/codec.ts';
import {history,undo} from '@codemirror/commands';
import {captureAnchor} from '../shared/anchors.ts';
import {mapInkItems} from '../shared/anchor-mapping.ts';
import {layoutThoughts,thoughtSide,previewThoughtInsertion} from '../shared/thoughts.ts';
import type {InkItem} from '../shared/ink.ts';
function item(text:string):InkItem {const from=text.indexOf('Chosen paragraph.'),anchor=captureAnchor(text,from,from+17);return {id:'thought-1',kind:'answer',body:'Synthetic AI text.\nSecond line.',anchor,originalAnchor:anchor,attachment:{status:'attached',...anchor.position},generation:{requestId:'request-1',action:'think',provider:'claude',model:null,status:'complete',createdAt:'2026-11-09T00:00:00Z',evidence:[],dismissed:false}};}
it('places measured blobs without overlap separately on each stable side',()=>{
 const rows=layoutThoughts([{id:'a',side:'left',target:20,height:120},{id:'b',side:'left',target:25,height:75},{id:'c',side:'right',target:25,height:60}]);
 expect(rows.map(r=>r.top)).toEqual([20,148,25]);expect(rows[1].target).toBe(25);expect(thoughtSide('thought-1')).toBe(thoughtSide('thought-1'));
});
it('previews AI-only callout beneath the whole anchored paragraph without touching other bytes; undo restores BOM CRLF',()=>{
 const text='\ufeff# Synthetic\r\n\r\nChosen paragraph. Continued line.\r\nMore in the same paragraph.\r\n\r\nTail.  \r\n';
 const i=item(text),p=previewThoughtInsertion({text,version:'v'},i,'v');
 expect(p.changes.from).toBe(text.indexOf('\r\n\r\nTail'));
 expect(p.changes.insert).toBe('\r\n\r\n> [!ai]\r\n> Synthetic AI text.\r\n> Second line.');
 const next=text.slice(0,p.changes.from)+p.changes.insert+text.slice(p.changes.from);
 expect(Buffer.from(next).subarray(0,3)).toEqual(Buffer.from([239,187,191]));expect(next.replace(p.changes.insert,'')).toBe(text);
 const original=decode(Buffer.from(text)),edit=previewThoughtInsertion(original,item(original.text),original.version);
 let state=EditorState.create({doc:original.text,extensions:[history()]});
 state=state.update({changes:edit.changes}).state;const view={state,dispatch:(tr:any)=>{view.state=tr.state}};
 expect(undo(view as any)).toBe(true);expect(encode(view.state.doc.toString(),original)).toEqual(Buffer.from(text));
});
it('maps a thought after edits above it before previewing insertion',()=>{
 const before='Intro.\n\nChosen paragraph.\n\nTail.',i=item(before),after='New line.\n\n'+before;
 const mapped=mapInkItems(before,after,[i],undefined,'external')[0];
 expect(mapped.attachment).toMatchObject({status:'attached',from:after.indexOf('Chosen paragraph.')});
 expect(previewThoughtInsertion({text:after,version:'v2'},mapped,'v2').changes.from).toBe(after.indexOf('\n\nTail'));
});
it('refuses pending, dismissed, orphaned and stale thought insertion',()=>{
 const note={text:'Chosen paragraph.',version:'v'},i=item(note.text);
 expect(()=>previewThoughtInsertion(note,i,'old')).toThrow();
 for(const changed of [{...i,generation:undefined},{...i,attachment:{status:'orphaned',reason:'missing'}},{...i,generation:{...i.generation!,status:'pending'}},{...i,generation:{...i.generation!,dismissed:true}}])expect(()=>previewThoughtInsertion(note,changed as InkItem,'v')).toThrow();
});

