import {afterEach,describe,expect,it} from 'vitest';
import {mkdir,mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';
import {EditorState} from '@codemirror/state';import {history,undo} from '@codemirror/commands';
import {InsertionStore} from '../server/insertion-store.ts';import {Store} from '../server/store.ts';import {InkStore} from '../server/ink-store.ts';import {LedgerStore} from '../server/ledger-store.ts';
import {SkillDiagramStore} from '../server/skill-diagram-store.ts';import {captureAnchor} from '../shared/anchors.ts';import {decode,encode} from '../server/codec.ts';
import {sanitizeSvgDocument} from '../shared/svg-sanitize.ts';import {PAGE} from './fixtures/skill-page.ts';

// Add to note for a skill's diagram: a markdown image of the saved static svg inside the one AI callout, through the same preview, journal and
// ledger as every other AI insertion. When only the interactive fallback exists, a link to the saved page instead. Nothing new is written to assets/.
const roots:string[]=[];afterEach(async()=>{for(const r of roots.splice(0))await rm(r,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
const BODY='# Invented\n\nReview the release.\n\nTail.  \n';
const svg=(sanitizeSvgDocument(PAGE) as {ok:true;svg:string}).svg;
type Kind='svg'|'html'|'none';
async function fixture(opts:{eol?:'\n'|'\r\n';bom?:boolean;rel?:string;kind?:Kind}={}){
 const rel=opts.rel??'fixture.md',root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-skill-insert-'));roots.push(root);
 const bytes=Buffer.from((opts.bom?'\ufeff':'')+BODY.replace(/\n/g,opts.eol??'\n'));await mkdir(path.dirname(path.join(root,rel)),{recursive:true});await writeFile(path.join(root,rel),bytes);
 const files=new SkillDiagramStore(root),kind=opts.kind??'svg',ref=kind==='svg'?await files.saveSvg(svg):kind==='html'?{...await files.saveHtml('<html><body>page</body></html>'),why:'svg_none' as const}:undefined;
 const ink=await InkStore.open(root),s=await ink.read(rel),note=decode(bytes),from=note.text.indexOf('Review'),anchor=captureAnchor(note.text,from,from+19);
 s.document.items.push({id:'k1',kind:'answer',body:kind==='svg'?'Diagram drawn by the diagram-design skill. It is shown as a static image.':'Diagram drawn by the diagram-design skill. It could not be shown as an image: the skill did not draw a picture the app can show. An interactive version is available.',
  ...(ref?{skillDiagram:ref}:{}),anchor,originalAnchor:anchor,attachment:{status:'attached',...anchor.position},
  generation:{requestId:'k1',action:'ask',provider:'claude',model:null,status:'complete',createdAt:'2026-11-12T00:00:00Z',evidence:[],dismissed:false,skills:['diagram-design']}});
 await ink.write(rel,s.document,null);
 const store=await Store.open(root),ledger=new LedgerStore(root),insertions=new InsertionStore(ink,store,ledger);
 return {root,rel,bytes,note,ink,store,ledger,insertions,ref,input:{path:rel,id:'k1',noteVersion:note.version}};
}
const apply=(f:Awaited<ReturnType<typeof fixture>>,changes:{from:number;to:number;insert:string})=>{
 let state=EditorState.create({doc:f.note.text,extensions:[history()]});state=state.update({changes}).state;const v={state,dispatch:(tr:any)=>{v.state=tr.state;}};return {v,edited:encode(v.state.doc.toString(),f.note)};
};

describe.each<[string,{eol:'\n'|'\r\n';bom?:boolean}]>([['LF',{eol:'\n'}],['CRLF',{eol:'\r\n'}],['BOM + CRLF',{eol:'\r\n',bom:true}]])('a static svg, note with %s',(_name,opts)=>{
 it('previews one callout holding the image, writes nothing new, and the note keeps its bytes, BOM and line endings; one undo restores them',async()=>{
  const f=await fixture(opts),p=await f.insertions.preview(f.input);
  expect(p.changes.insert).toMatch(/^\n\n> \[!ai\]\n> Diagram drawn by the diagram-design skill\. It is shown as a static image\.\n> !\[AI diagram: diagram-design\]\(assets\/diagram-[a-f0-9]{64}\.svg\)/);
  expect(p.changes.insert.match(/\[!ai\]/g)).toHaveLength(1);expect(p.changes.insert).toContain(`(assets/${f.ref!.asset})`);expect(p.assetName).toBeUndefined();
  const before=await readdir(path.join(f.root,'assets')),prepared=await f.insertions.prepare({...f.input,preview:p});expect(await readdir(path.join(f.root,'assets'))).toEqual(before);
  const {v,edited}=apply(f,p.changes);
  expect(edited.subarray(0,3).equals(f.bytes.subarray(0,3))).toBe(true);expect(edited.toString().replace(p.changes.insert.replace(/\n/g,opts.eol),'')).toBe(f.bytes.toString());
  const text=edited.toString();expect(text.includes('\ufeff')).toBe(!!opts.bom);
  if(opts.eol==='\r\n')expect(text.replace(/\r\n/g,'').includes('\n')).toBe(false);else expect(text.includes('\r')).toBe(false);
  expect((await f.store.write(f.rel,v.state.doc.toString(),f.note.version)).ok).toBe(true);expect((await readFile(path.join(f.root,f.rel))).equals(edited)).toBe(true);
  expect((await f.insertions.complete(f.rel,prepared.operationId)).pending).toBe(0);
  const events=(await f.ledger.read()).events;expect(events).toHaveLength(1);expect(events[0]).toMatchObject({event:'inserted',authorship:'ai',insertedBy:'human',inkId:'k1'});
  expect(undo(v as any)).toBe(true);expect(encode(v.state.doc.toString(),f.note).equals(f.bytes)).toBe(true);
 });
});
describe('Add to note for a skill diagram',()=>{
 it('points at the asset from a note in a sub-folder',async()=>{
  const f=await fixture({rel:'deep/er/fixture.md'}),p=await f.insertions.preview(f.input);expect(p.changes.insert).toContain(`(../../assets/${f.ref!.asset})`);
 });
 it('the preview is the same every time, and a changed note makes a stale preview fail before any intent is recorded',async()=>{
  const f=await fixture(),p=await f.insertions.preview(f.input);expect(await f.insertions.preview(f.input)).toEqual(p);
  await f.store.write(f.rel,f.note.text+'User edit.',f.note.version);await expect(f.insertions.prepare({...f.input,preview:p})).rejects.toThrow();await expect(readFile(path.join(f.root,'ink/insertions.json'))).rejects.toThrow();
 });
 it('with only the interactive fallback it inserts a link to the saved page, not an image',async()=>{
  const f=await fixture({kind:'html'}),p=await f.insertions.preview(f.input);
  expect(p.changes.insert).toMatch(/\n> \[AI diagram, interactive version: diagram-design\]\(assets\/diagram-[a-f0-9]{64}\.html\)/);expect(p.changes.insert).not.toContain('![');expect(p.changes.insert.match(/\[!ai\]/g)).toHaveLength(1);
 });
 it('refuses an asset whose bytes no longer match its name, and one that is gone',async()=>{
  const f=await fixture();await writeFile(path.join(f.root,'assets',f.ref!.asset),'<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>');
  await expect(f.insertions.preview(f.input)).rejects.toThrow(/diagram/i);await rm(path.join(f.root,'assets',f.ref!.asset));await expect(f.insertions.preview(f.input)).rejects.toThrow();
 });
 it('refuses a layout for a thought that has no built-in diagram',async()=>{
  const f=await fixture();await expect(f.insertions.preview({...f.input,layout:{width:1,height:1,nodes:[],edges:[],groups:[]},theme:'light'})).rejects.toThrow();
 });
 it('a thought with no diagram at all still inserts as plain labelled text (unchanged)',async()=>{
  const f=await fixture({kind:'none'}),p=await f.insertions.preview(f.input);expect(p.changes.insert).toContain('> [!ai]');expect(p.changes.insert).not.toMatch(/!\[|\]\(/);
 });
});
