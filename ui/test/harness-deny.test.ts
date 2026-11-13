import path from 'node:path';
import {describe,expect,it} from 'vitest';
import {repoDenied} from '../shared/harness.ts';
import {repoDeny} from '../server/harness/deny.ts';

// What an investigation's copy of a REPO leaves out. The rules written for the notebook folder (chat, runs, measurements, backups, ink, .cache, hidden files, sidecars)
// are not repo rules: a repo has src/chat/, runs/ and backups/ folders like any other code. Only secrets, tooling folders and Aitiarch's state are kept out of a repo,
// and the notebook folder (when it is the repo, inside it, or the repo is inside it) is kept out by the notebook's own rules.
describe('repoDenied (what a repo never gives out)',()=>{
 it('lets ordinary code through, including folders that are notebook folders elsewhere, and hidden files that are not secrets',()=>{
  for(const p of ['src/chat/x.ts','runs/y.ts','backups/z.ts','measurements/m.ts','chats/a.ts','ui/server/chat/runtime.ts','ui/src/chat/ChatPanel.tsx','ink/render.ts','.cache/readme.md',
   '.gitignore','.github/workflows/ci.yml','.eslintrc.json','notebook.md','README.md','sidecar.ts','plan.ink.json','x.ledger.json'])expect(repoDenied(p),p).toBe(false);
 });
 it('keeps out secrets, keys, tooling folders and Aitiarch state, at any depth',()=>{
  for(const p of ['.env','.env.local','app/.env.production','keys/server.pem','id_rsa','ssh/id_ed25519','config/credentials.json','my-secrets.txt','a.private.md','node_modules/a.js','packages/x/node_modules/b.js',
   '.git/config','.claude/settings.json','sub/.codex/x','ui-state.json','ui-state.json.tmp','deep/ui-state.json'])expect(repoDenied(p),p).toBe(true);
 });
 it('reads backslashes like slashes and refuses an empty path',()=>{expect(repoDenied('src\\chat\\x.ts')).toBe(false);expect(repoDenied('node_modules\\a.js')).toBe(true);expect(repoDenied('')).toBe(true);});
});

describe('repoDeny (the repo rules, plus the notebook folder wherever it is)',()=>{
 const repo=path.resolve('/work/repo'),inside=(p:string)=>path.join(repo,p);
 it('a notebook that is somewhere else changes nothing: the repo rules only',()=>{
  const d=repoDeny(repo,path.resolve('/work/notebook'));
  expect(d('src/chat/x.ts')).toBe(false);expect(d('runs/y.ts')).toBe(false);expect(d('backups/z.ts')).toBe(false);expect(d('.env')).toBe(true);expect(d('node_modules/a.js')).toBe(true);
  expect(repoDeny(repo)('src/chat/x.ts')).toBe(false);
 });
 it('when the repo IS the notebook folder, the notebook rules apply to everything in it',()=>{
  const d=repoDeny(repo,repo);
  for(const p of ['chat/plan.json','runs/1.md','measurements/m.md','backups/a.md','notebook.md','.cache/x','.hidden/y.md','ink/plan.ink.json','x.ledger.jsonl','src/chat/x.ts','.env'])expect(d(p),p).toBe(true);
  expect(d('src/app.ts')).toBe(false);expect(d('README.md')).toBe(false);
 });
 it('when the notebook folder is inside the repo, all of it is kept out as a whole, and nothing beside it is',()=>{
  const d=repoDeny(repo,inside('journal'));
  for(const p of ['journal/notes.md','journal/chat/x.json','journal/deep/er/file.ts','journal'])expect(d(p),p).toBe(true);
  for(const p of ['journalism/a.md','src/journal/x.ts','src/chat/x.ts','runs/y.ts'])expect(d(p),p).toBe(false);
 });
 it('when the repo is inside the notebook folder, the notebook rules apply to paths as the notebook sees them',()=>{
  const d=repoDeny(inside('code'),repo);
  expect(d('src/app.ts')).toBe(false);expect(d('src/chat/x.ts')).toBe(true); // "chat" is a notebook folder name, and this is inside the notebook
  const e=repoDeny(path.resolve('/work/notebook/projects/app'),path.resolve('/work/notebook'));expect(e('src/app.ts')).toBe(false);expect(e('runs/y.ts')).toBe(true);
 });
 it('compares paths the way Windows does: case does not matter',()=>{
  if(process.platform!=='win32')return;
  const d=repoDeny('C:\\Work\\Repo','c:\\work\\repo\\Journal');expect(d('journal/a.md')).toBe(true);expect(d('src/chat/x.ts')).toBe(false);
 });
});
