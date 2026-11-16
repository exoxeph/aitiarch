import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';import {execFileSync} from 'node:child_process';import os from 'node:os';import path from 'node:path';
import {renderToStaticMarkup} from 'react-dom/server';
import {syncSnapshot,excludedSnapshotPaths} from '../server/harness/snapshot.ts';
import {PlanCard} from '../src/chat/PlanCard.tsx';
import type {ConversationPlan} from '../server/harness/conversation.ts';
let root:string;
beforeEach(async()=>{root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-exclusions-'));vi.stubEnv('AITIARCH_CONFIG_DIR',path.join(root,'config'));});
afterEach(async()=>{vi.unstubAllEnvs();console.log('CLEANUP TARGET synthetic exclusion fixture',root);await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
const names=['.env','.env.local','SERVER.PEM','server.key','id_rsa.backup','ID_ED25519.pub','.npmrc','.pypirc','.netrc','credentials.backup','credentials.py','client.p12','client.pfx','.aws/config','.ssh/config','.gnupg/private-keys-v1.d/key','deep/nested/.ENV.production','deep/.GNUPG/pubring.kbx','deep/credentials-cache','deep/.git-credentials','deep/deploy.jks','deep/store.keystore','deep/terraform.tfvars','deep/a.private.json','deep/.password-store/example.gpg','deep/.authinfo.gpg','deep/.dockercfg','deep/.s3cfg','deep/.boto','deep/.KUBE/config'];
it('excludes every secret pattern at any depth without reading its contents; ordinary source still copies',async()=>{
 const repo=path.join(root,'repo'),dest=path.join(root,'copy');await mkdir(repo);execFileSync('git',['init','-q'],{cwd:repo,stdio:'pipe'});
 for(const rel of [...names,'src/normal.ts']){const file=path.join(repo,rel);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,rel==='src/normal.ts'?'ordinary source':'SYNTHETIC_SECRET_CONTENT');}
 const result=await syncSnapshot(repo,dest,path.join(root,'manifest.json'));
 expect(result.files).toBe(1);expect(await readFile(path.join(dest,'src/normal.ts'),'utf8')).toBe('ordinary source');
 for(const rel of names)await expect(readFile(path.join(dest,rel))).rejects.toMatchObject({code:'ENOENT'});
 const summary=(result as any).excludedFromCopy;expect(summary.paths).toHaveLength(10);expect(summary.more).toBe(names.length-10);expect(JSON.stringify(summary)).not.toContain('SYNTHETIC_SECRET_CONTENT');
});
function card(excludedFromCopy?:{paths:string[];more:number}){const plan={hash:'hash',profile:'investigate',budgetUsd:.5,attachments:{repo:true,files:[],notes:[]},files:[],repo:{path:'synthetic repo'},...(excludedFromCopy?{excludedFromCopy}:{})} as unknown as ConversationPlan;return renderToStaticMarkup(<PlanCard plan={plan} busy={false} onApprove={()=>{}} onReplan={()=>{}} onCancel={()=>{}}/>);}
it('the plan card escapes file names as text, limits to ten and reports the remainder, never file contents',()=>{
 const html=card({paths:['nested/.env','credentials-<img src=x onerror=alert(1)>'],more:4});expect(html).toContain('Excluded from the copy');expect(html).toContain('nested/.env');expect(html).toContain('&lt;img');expect(html).not.toContain('<img');expect(html).toContain('and 4 more');expect(html).not.toContain('SYNTHETIC_SECRET_CONTENT');
});
it('the plan card hides the exclusion line when no files were excluded',()=>{expect(card()).not.toContain('Excluded from the copy');expect(card({paths:[],more:0})).not.toContain('Excluded from the copy');});
it('display metadata includes ignored secret names too, and file-scoped plans list only their scope',async()=>{
 const repo=path.join(root,'repo');await mkdir(repo);execFileSync('git',['init','-q'],{cwd:repo,stdio:'pipe'});await writeFile(path.join(repo,'.gitignore'),'.env.hidden\n');await writeFile(path.join(repo,'.env.hidden'),'NEVER_DISPLAY_THIS_CONTENT');await writeFile(path.join(repo,'normal.ts'),'ordinary source');
 expect(await excludedSnapshotPaths(repo)).toEqual({paths:['.env.hidden'],more:0});expect(await excludedSnapshotPaths(repo,undefined,new Set(['normal.ts']))).toEqual({paths:[],more:0});
});
it('the plan card never renders more than ten paths even if given an oversized display list',()=>{
 const html=card({paths:Array.from({length:12},(_,i)=>`credentials-${i}`),more:2});expect((html.match(/<code>credentials-/g)??[]).length).toBe(10);expect(html).toContain('and 4 more');expect(html).not.toContain('<code>credentials-10</code>');
});
