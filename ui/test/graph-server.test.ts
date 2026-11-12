import {afterEach,describe,expect,it} from 'vitest';
import {mkdtemp,mkdir,readFile,rm,utimes,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import os from 'node:os';import path from 'node:path';
import {Explorer} from '../server/explorer.ts';
import {buildGraph,handoffDocument,writeHandoff,HANDOFF_MARK} from '../server/graph.ts';
import {UiStateStore} from '../server/ui-state-store.ts';

// The Constellation's data and the handoff document. Read-only, except writeHandoff, which only ever writes handoff.md and
// only when it is missing or was written by the app before (it carries the marker).
const temps:string[]=[];
afterEach(async()=>{for(const t of temps.splice(0))await rm(t,{recursive:true,force:true,maxRetries:5});});
async function notebook(files:Record<string,string>){
 const root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-graph-'));temps.push(root);
 for(const [rel,body] of Object.entries(files)){const f=path.join(root,...rel.split('/'));await mkdir(path.dirname(f),{recursive:true});await writeFile(f,body);}
 return {root,ex:await Explorer.open(root)};
}
// A synthetic thread: open (no takeaway yet), closed (the human's submitted takeaway), or dismissed.
const item=(id:string,quote:string,kind:'open'|'closed'|'dismissed',takeaway='')=>({id,kind:'margin',body:'AI text',originalAnchor:{quote},anchor:{quote,prefix:'',suffix:'',position:{from:0,to:quote.length}},attachment:{status:'attached',from:0,to:quote.length},
 generation:{status:'complete',dismissed:kind==='dismissed'},
 thread:{schemaVersion:1,dismissed:kind==='dismissed',providerConfirmations:[],followups:[],summary:{reply:null,revealedAt:null},
  takeaway:kind==='closed'?{events:[],state:'submitted',text:takeaway,updatedAt:'2026-11-01T00:00:00.000Z'}:{events:[],state:'untouched',text:null,updatedAt:null}}});
const sidecar=(note:string,items:unknown[])=>JSON.stringify({v:2,note,noteVersion:null,lastSeenTextHash:null,items});

const files={
 'index.md':'# Home\nSee [@Plan](plan.md) and [gone](gone.md).\n',
 'plan.md':'# Plan\nBuilt on [@Base](base.md).\n',
 'base.md':'# Base\nThe foundation.\n',
 'ink/plan.ink.json':sidecar('plan.md',[item('p1','refresh tokens','closed','Rotate every 15 minutes.\nKeep the old one for a minute.'),item('p2','store sessions','open')]),
 'ink/base.ink.json':sidecar('base.md',[item('b1','pick a database','closed','Postgres.'),item('b2','noise','dismissed')]),
};

describe('graph data',()=>{
 it('has every note with its threads, edges with counts, broken links and modification times',async()=>{
  const {root,ex}=await notebook(files);
  await utimes(path.join(root,'base.md'),new Date('2026-01-01'),new Date('2026-01-01'));
  const g=await buildGraph(ex);
  expect(g.notes.map(n=>[n.path,n.title,n.threads,n.openThreads])).toEqual([['base.md','Base',1,0],['index.md','Home',0,0],['plan.md','Plan',2,1]]);
  expect(g.notes[0].mtimeMs).toBe(new Date('2026-01-01').getTime());
  expect(g.edges).toEqual([{from:'index.md',to:'plan.md',count:1},{from:'plan.md',to:'base.md',count:1}]);
  expect(g.broken).toEqual([{from:'index.md',target:'gone.md'}]);
 });
});

describe('handoff document',()=>{
 it('lists takeaways and open threads note by note in citation order: cited notes first, the human takeaways verbatim, open threads marked',async()=>{
  const {ex}=await notebook(files),doc=await handoffDocument(ex);
  expect(doc.order).toEqual(['base.md','plan.md','index.md']);
  expect(doc.markdown.startsWith(HANDOFF_MARK)).toBe(true);
  const body=doc.markdown.slice(doc.markdown.indexOf('## '));
  expect(body).toBe([
   '## Base','[base.md](base.md)','','- Takeaway: Postgres.','',
   '## Plan','[plan.md](plan.md)','','- Takeaway: Rotate every 15 minutes.','  Keep the old one for a minute.','- Open thread: “store sessions”','',
  ].join('\n'));
 });
 it('writes handoff.md when it is missing or was written by the app, and never over a file you wrote',async()=>{
  const {root,ex}=await notebook(files);
  expect(await writeHandoff(ex)).toMatchObject({written:true});
  const first=await readFile(path.join(root,'handoff.md'),'utf8');expect(first.startsWith(HANDOFF_MARK)).toBe(true);
  expect(await writeHandoff(ex)).toMatchObject({written:true});
  await writeFile(path.join(root,'handoff.md'),'# My own handoff\n');
  await expect(writeHandoff(ex)).rejects.toMatchObject({code:'not_ours'});
  expect(await readFile(path.join(root,'handoff.md'),'utf8')).toBe('# My own handoff\n');
 });
 it('leaves handoff.md out of its own graph',async()=>{
  const {ex}=await notebook(files);await writeHandoff(ex);
  expect((await buildGraph(ex)).notes.map(n=>n.path)).not.toContain('handoff.md');
 });
});

describe('remembered star positions',()=>{
 const setup=async()=>{const {root}=await notebook({'a.md':'x'});execFileSync('git',['init','-q'],{cwd:root,stdio:'pipe'});await writeFile(path.join(root,'.gitignore'),'/ui-state.json*\n');return new UiStateStore(root);};
 it('round-trips through ui-state.json',async()=>{
  const s=await setup();await s.saveStarPositions({'a.md':[12.5,-3]});
  expect(await s.starPositions()).toEqual({'a.md':[12.5,-3]});
 });
 it('refuses bad paths, non-numbers and too many entries',async()=>{
  const s=await setup();
  for(const bad of [{'../x.md':[1,2]},{'a.md':[1]},{'a.md':[Number.NaN,1]},{'a.md':'1,2'},Object.fromEntries(Array.from({length:5001},(_,i)=>[`n${i}.md`,[0,0]]))])
   await expect(s.saveStarPositions(bad as never)).rejects.toThrow();
 });
 it('needs ui-state.json to be git-ignored, like every other preference',async()=>{
  const {root}=await notebook({'a.md':'x'});const s=new UiStateStore(root);
  await expect(s.saveStarPositions({'a.md':[1,2]})).rejects.toThrow(/ignored/);
 });
});
