import {execFile} from 'node:child_process';
import {readFile,readdir,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {expect,it} from 'vitest';
import {repoFiles,syncSnapshot} from '../server/harness/snapshot.ts';

it('demo generator creates only synthetic temp data and its fake .env never enters the snapshot',async()=>{
 const script=fileURLToPath(new URL('../../scripts/make-demo-project.mjs',import.meta.url));
 const result=await promisify(execFile)(process.execPath,[script]);
 const root=/^Demo folder: (.+)$/m.exec(result.stdout)![1].trim();
 expect(path.dirname(root)).toBe(tmpdir());expect(path.basename(root)).toMatch(/^aitiarch-demo-/);
 const repo=path.join(root,'project'),notebook=path.join(repo,'.aitiarch'),outside=path.join(root,'outside-secret.private.txt');
 expect(await repoFiles(repo)).toContain('.env'); // exclusion must come from the fence, not .gitignore
 expect(await readFile(path.join(notebook,'notebook.md'),'utf8')).toContain('invented');
 expect(await readFile(outside,'utf8')).toContain('FAKE_DEMO_TOKEN_NOT_A_REAL_CREDENTIAL');
 expect(result.stdout).toContain(`Try to read the file at "${outside}"`);
 const cache=await mkdtemp(path.join(tmpdir(),'aitiarch-demo-snapshot-'));
 const snapshot=await syncSnapshot(repo,path.join(cache,'files'),path.join(cache,'manifest.json'),undefined,notebook);
 expect(snapshot.skipped.denied).toBeGreaterThan(0);
 expect(await readdir(path.join(cache,'files'),{recursive:true})).not.toContain('.env');
 expect(await readFile(path.join(cache,'files','src','app.js'),'utf8')).toContain('demo');
 // Deliberately retain these tiny synthetic temp folders for inspection; no deletion command.
},20000);
