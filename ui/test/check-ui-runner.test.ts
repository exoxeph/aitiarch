import {spawnSync} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {expect,it} from 'vitest';

const shell=process.platform==='win32'?'powershell.exe':'pwsh';
const hasShell=spawnSync(shell,['-NoProfile','-Command','exit 0']).status===0;
const script=fileURLToPath(new URL('../scripts/check-ui.ps1',import.meta.url));
it.skipIf(!hasShell)('UI runner preserves failing exit codes, continues checks and fails the whole run',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-check-runner-'));
 try{
  const mixed=path.join(root,'mixed'),green=path.join(root,'green');await mkdir(mixed);await mkdir(green);
  await writeFile(path.join(mixed,'a.mjs'),'process.exit(0);');
  await writeFile(path.join(mixed,'b.mjs'),'process.stderr.write("synthetic failure\\n");process.exit(7);');
  await writeFile(path.join(mixed,'c.mjs'),'process.exit(0);');
  await writeFile(path.join(green,'a.mjs'),'process.exit(0);');
  const run=(dir:string,out:string)=>spawnSync(shell,['-NoProfile','-File',script,'-CheckDirectory',dir,'-OutputDirectory',out],{encoding:'utf8',timeout:20000,windowsHide:true});
  const failed=run(mixed,path.join(root,'failed-output'));
  expect(failed.status,failed.stderr).toBe(1);
  const results=JSON.parse(await readFile(path.join(root,'failed-output','results.json'),'utf8'));
  expect(results.map((r:{exitCode:number})=>r.exitCode)).toEqual([0,7,0]);
  expect(failed.stdout).toContain('TOTAL=3 FAILED=1');
  const passed=run(green,path.join(root,'passed-output'));
  expect(passed.status,passed.stderr).toBe(0);expect(passed.stdout).toContain('TOTAL=1 FAILED=0');
 }finally{console.log('CLEANUP TARGET (synthetic runner fixtures only): '+root);await rm(root,{recursive:true,force:true});}
},30000);
