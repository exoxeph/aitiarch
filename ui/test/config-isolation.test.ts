import {execFileSync} from 'node:child_process';
import {existsSync,readdirSync,readFileSync,realpathSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {expect,it} from 'vitest';
import {resolveConfigFolder} from '../server/registry.ts';

// No UI check and no server test may read or write the machine's real pipeline-config.json or projects.json. Every check that starts the app imports check/config-isolation.mjs
// (an empty temp config folder), or gives the server it spawns its own AITIARCH_CONFIG_DIR; every test runs with an empty temp folder by default (test/setup/isolated-config.ts).
const ui=path.resolve(__dirname,'..');
const read=(rel:string)=>readFileSync(path.join(ui,rel),'utf8');
const checks=readdirSync(path.join(ui,'check')).filter(f=>f.endsWith('.mjs')&&f!=='config-isolation.mjs');
const startsInProcess=(src:string)=>/\bcreateApp\(|\bcreateHost\(/.test(src);
const spawnsServer=(src:string)=>/['"]server['"]\s*,\s*['"]main\.ts['"]/.test(src);
const firstImport=(src:string)=>src.split(/\r?\n/).find(l=>l.startsWith('import '))??'';

it('every check that starts the app in its own process imports the temp config folder first',()=>{
 const started=checks.filter(f=>startsInProcess(read('check/'+f)));
 expect(started.length,'the scan found the checks').toBeGreaterThan(30);
 for(const f of started)expect(firstImport(read('check/'+f)),`${f} must start with: import './config-isolation.mjs'`).toMatch(/^import '\.\/config-isolation\.mjs'/);
});
it('every check that spawns the server gives it its own AITIARCH_CONFIG_DIR, or imports the temp folder (which the child inherits)',()=>{
 const spawning=checks.filter(f=>spawnsServer(read('check/'+f)));
 expect(spawning.length).toBeGreaterThan(5);
 for(const f of spawning){
  const src=read('check/'+f);
  expect(/AITIARCH_CONFIG_DIR/.test(src)||/^import '\.\/config-isolation\.mjs'/.test(firstImport(src)),`${f} starts the server without a config folder of its own`).toBe(true);
  // an explicit env object must not drop the variable: it spreads process.env or names AITIARCH_CONFIG_DIR itself
  for(const m of src.matchAll(/spawn\([^;]*?main\.ts[^;]*?\{[^;]*?\benv\s*:\s*(\{[^}]*\})/g))expect(m[1],`${f} spawn env`).toMatch(/AITIARCH_CONFIG_DIR|\.\.\.process\.env/);
 }
});
it('the isolation module replaces an inherited folder (even one that looks real) with an empty temp one, and removes it at exit',()=>{
 const tmp=realpathSync(os.tmpdir()),fake=path.join(tmp,'not-the-folder-'+process.pid);
 const out=execFileSync(process.execPath,['--input-type=module','-e',`import fs from 'node:fs';import {checkConfigDir} from ${JSON.stringify(path.join(ui,'check','config-isolation.mjs').replace(/\\/g,'/').replace(/^([A-Za-z]):/,'file:///$1:'))};console.log(JSON.stringify({dir:process.env.AITIARCH_CONFIG_DIR,same:checkConfigDir===process.env.AITIARCH_CONFIG_DIR,entries:fs.readdirSync(checkConfigDir)}));`],{env:{...process.env,AITIARCH_CONFIG_DIR:fake},encoding:'utf8'});
 const line=out.split(/\r?\n/).filter(l=>l.startsWith('{')).at(-1)!,r=JSON.parse(line);
 expect(r.dir).not.toBe(fake);expect(r.same).toBe(true);expect(r.entries).toEqual([]);
 expect(path.resolve(r.dir).toLowerCase().startsWith(tmp.toLowerCase()+path.sep)).toBe(true);expect(existsSync(r.dir),'removed at exit').toBe(false);
});
it('every test runs with an empty temp config folder by default',()=>{
 const dir=process.env.AITIARCH_CONFIG_DIR!,tmp=realpathSync(os.tmpdir());
 expect(dir).toBeTruthy();expect(path.resolve(dir).toLowerCase().startsWith(tmp.toLowerCase()+path.sep)).toBe(true);
 expect(readdirSync(dir)).toEqual([]);
 expect(resolveConfigFolder()).toBe(path.resolve(dir));
 expect(readFileSync(path.join(ui,'vite.config.ts'),'utf8')).toContain('test/setup/isolated-config.ts');
});
