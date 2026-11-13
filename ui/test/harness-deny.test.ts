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
  for(const p of ['.env','.env.local','app/.env.production','keys/server.pem','id_rsa','ssh/id_ed25519','a.private.md','node_modules/a.js','packages/x/node_modules/b.js',
   '.git/config','.claude/settings.json','sub/.codex/x','ui-state.json','ui-state.json.tmp','deep/ui-state.json'])expect(repoDenied(p),p).toBe(true);
 });
 it('keeps out secret STORES: a file named secrets or credentials with no extension, or as json, yml, yaml, toml or env',()=>{
  for(const p of ['secrets','credentials','config/secrets.json','credentials.json','a/b/secrets.yml','secrets.yaml','credentials.toml','secrets.env','Secrets.JSON','secrets.prod.yml','credentials.production.json','secret.yaml','.secrets','my/credentials'])expect(repoDenied(p),p).toBe(true);
 });
 it('lets source code through even when its name says secrets or credentials',()=>{
  for(const p of ['src/secrets.ts','lib/credentials.py','ui/server/chat/secrets.ts','secrets.js','credentials.go','Secrets.cs','secrets.test.ts','credentials.rb','docs/credentials.md','my-secrets.txt','credentials_helper.py','secretsManager.ts'])expect(repoDenied(p),p).toBe(false);
 });
 it('treats a FOLDER named exactly secrets or credentials like the file rule: whatever is inside is kept out',()=>{
  for(const p of ['secrets/db.txt','config/credentials/token.txt','deploy/secrets/index.ts'])expect(repoDenied(p),p).toBe(true);
 });
 it('keeps out credential files of common tools, keys and stores, and cloud or infrastructure state',()=>{
  for(const p of ['.npmrc','sub/.npmrc','.netrc','.pypirc','.git-credentials','.aws/credentials','home/.aws/config','.ssh/id_rsa','.ssh/known_hosts','.docker/config.json','deploy.key','certs/site.key','cert.p12','cert.pfx','release.jks','release.keystore',
   'terraform.tfstate','terraform.tfstate.backup','prod.tfvars','env/prod.auto.tfvars','kubeconfig','deploy/kubeconfig','service-account.json','service-account-prod.json','gcp/service-account-key.json'])expect(repoDenied(p),p).toBe(true);
 });
 it('does not over-reach on the same names',()=>{
  for(const p of ['.docker/Dockerfile','docker/config.json','.docker','src/aws.ts','npmrc.md','keys.ts','keyboard.ts','src/key.ts','tfvars.md','kubeconfig.ts','service-account.ts','service-accounts/README.md','src/netrc.js'])expect(repoDenied(p),p).toBe(false);
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
