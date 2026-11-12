import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach,describe,expect,it} from 'vitest';
import {harnessDirectory,SessionIndex} from '../server/harness/session-index.ts';
import {harnessDenied} from '../shared/harness.ts';

// The app's own index of harness sessions: kept outside the repo, never scanned from ~/.claude, and it survives the project being reopened.
const dirs:string[]=[];afterEach(async()=>{for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true});});
const temp=async()=>{const d=await mkdtemp(path.join(os.tmpdir(),'aitiarch-harness-index-'));dirs.push(d);return d;};

describe('SessionIndex',()=>{
 it('creates, lists, renames and touches sessions, and a reopened index sees the same thing',async()=>{
  const dir=await temp(),index=await SessionIndex.open(dir);
  const a=await index.create({mode:'chat',label:'  Storage   questions ',note:'plan.md'});
  expect(a).toMatchObject({mode:'chat',label:'Storage questions',note:'plan.md',turns:0});
  expect(a.id).toMatch(/^[0-9a-f-]{36}$/);
  await index.create({mode:'investigate',label:'Login code'});
  expect((await index.list({mode:'chat',note:'plan.md'})).map(s=>s.label)).toEqual(['Storage questions']);
  await index.rename(a.id,'Where data lives');await index.touch(a.id);
  const again=await SessionIndex.open(dir),s=await again.get(a.id);
  expect(s).toMatchObject({label:'Where data lives',turns:1});expect(Date.parse(s!.lastUsed)).toBeGreaterThanOrEqual(Date.parse(s!.created));
  expect((await again.list()).length).toBe(2);
 });
 it('lists the most recently used first',async()=>{
  const index=await SessionIndex.open(await temp()),a=await index.create({mode:'chat',label:'A'}),b=await index.create({mode:'chat',label:'B'});
  await new Promise(r=>setTimeout(r,5));await index.touch(a.id);
  expect((await index.list()).map(s=>s.id)).toEqual([a.id,b.id]);
 });
 it('refuses bad labels, unknown ids and a mode it does not know',async()=>{
  const index=await SessionIndex.open(await temp());
  await expect(index.create({mode:'chat',label:'  '})).rejects.toThrow();await expect(index.create({mode:'chat',label:'x'.repeat(81)})).rejects.toThrow();
  await expect(index.create({mode:'agent' as never,label:'x'})).rejects.toThrow();
  await expect(index.rename('00000000-0000-4000-8000-000000000000','x')).rejects.toThrow();
 });
 it('keeps working when the file is damaged: bad rows are dropped, never trusted',async()=>{
  const dir=await temp(),index=await SessionIndex.open(dir),a=await index.create({mode:'chat',label:'Good'});
  const file=path.join(dir,'sessions.json'),data=JSON.parse(await readFile(file,'utf8'));
  data.sessions.push({id:'../../evil',label:'x',mode:'chat',created:'now',lastUsed:'now',turns:0});await writeFile(file,JSON.stringify(data));
  expect((await (await SessionIndex.open(dir)).list()).map(s=>s.id)).toEqual([a.id]);
  await writeFile(file,'{not json');expect(await (await SessionIndex.open(dir)).list()).toEqual([]);
 });
 it('lives outside the project: the folder is per project and never inside the notebook',()=>{
  const root=path.join(os.tmpdir(),'some-project','.aitiarch'),dir=harnessDirectory(root,{LOCALAPPDATA:path.join(os.tmpdir(),'local')});
  expect(path.relative(root,dir).startsWith('..')).toBe(true);expect(dir).toContain(path.join('Aitiarch','harness'));
  expect(harnessDirectory(root,{LOCALAPPDATA:'x'})).toBe(harnessDirectory(root,{LOCALAPPDATA:'x'}));expect(harnessDirectory(root+'2',{LOCALAPPDATA:'x'})).not.toBe(harnessDirectory(root,{LOCALAPPDATA:'x'}));
  expect(()=>harnessDirectory(root,{LOCALAPPDATA:path.join(root,'inside')})).toThrow();
 });
});

describe('harnessDenied',()=>{
 it('keeps out the notebook file, hidden files, sidecars, state and secrets, and lets ordinary notes through',()=>{
  for(const p of ['notebook.md','.private-note.md','sub/.hidden/x.md','ink/plan.ink.json','ui-state.json','ui-state.json.tmp','.env','.env.local','keys/server.pem','id_rsa','credentials.md','my-secrets.txt','a.private.md','backups/x.md','chat/plan.json','runs/1.md','measurements/m.md','node_modules/a/b.js','.git/config'])expect(harnessDenied(p),p).toBe(true);
  for(const p of ['plan.md','decisions/setup.md','src/server.js','README.md','notes/n07.md'])expect(harnessDenied(p),p).toBe(false);
 });
});
