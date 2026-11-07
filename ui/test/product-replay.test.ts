import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
const script=fileURLToPath(new URL('./replay-product.mjs',import.meta.url));
const run=async(result:string,context:string)=>{
  try{const out=await promisify(execFile)(process.execPath,[script,'--result',result,'--context',context]);return {...out,code:0};}
  catch(error){const e=error as {stdout:string;stderr:string;code:number};return {stdout:e.stdout,stderr:e.stderr,code:e.code};}
};
async function fixture(){
  const root=await mkdtemp(path.join(os.tmpdir(),'aitiarch-offline-replay-'));roots.push(root);
  const result=path.join(root,'result.txt'),context=path.join(root,'context.json');
  await writeFile(result,'```json\n'+JSON.stringify({answer:'PRIVATE_REPLAY_SENTINEL'+'.'.repeat(2100),claims:[{sourceId:'N1',quote:'Synthetic note.'}]})+'\n```');
  await writeFile(context,JSON.stringify({expectedId:'offline',resultId:'offline',provider:'claude',model:null,note:'Synthetic note.',decisions:[]}));
  return {root,result,context};
}
it('replays a fenced answer through the real validator without printing its content',async()=>{
  const f=await fixture(),out=await run(f.result,f.context);
  expect(out.code).toBe(0);expect(out.stderr).toBe('');
  const rows=out.stdout.trim().split('\n').map(line=>JSON.parse(line));
  expect(rows).toContainEqual({rule:'response_schema',pass:true});
  expect(rows).toContainEqual({rule:'claim_quote_exact',pass:true});
  expect(rows.every(row=>Object.keys(row).sort().join(',')==='pass,rule'&&row.pass===true)).toBe(true);
  expect(out.stdout).not.toMatch(/PRIVATE_REPLAY_SENTINEL|Synthetic|offline/);
});
it('reports the same exact-quote rejection as product integration, without quoting it',async()=>{
  const f=await fixture();await writeFile(f.result,JSON.stringify({answer:'PRIVATE_REPLAY_SENTINEL',claims:[{sourceId:'N1',quote:'PRIVATE_QUOTE_SENTINEL'}]}));
  const out=await run(f.result,f.context);expect(out.code).not.toBe(0);
  expect(out.stdout).toContain(JSON.stringify({rule:'claim_quote_exact',pass:false}));
  expect(out.stdout+out.stderr).not.toMatch(/PRIVATE_|Synthetic/);
});
it('does not print raw JSON syntax errors',async()=>{
  const f=await fixture();await writeFile(f.result,'PRIVATE_SYNTAX_SENTINEL');
  const out=await run(f.result,f.context);expect(out.code).not.toBe(0);
  expect(out.stdout.trim()).toBe(JSON.stringify({rule:'response_format',pass:false}));
  expect(out.stdout+out.stderr).not.toContain('PRIVATE_SYNTAX_SENTINEL');
});
it('refuses either input path inside the repository before reading it',async()=>{
  const f=await fixture();
  for(const args of [[script,f.context],[f.result,script]]){
    const out=await run(...args as [string,string]);expect(out.code).not.toBe(0);
    expect(out.stdout.trim()).toBe(JSON.stringify({rule:'replay_path',pass:false}));
    expect(out.stderr).toBe('');
  }
});
it('also refuses an external link whose target is inside the repository',async()=>{
  const f=await fixture(),link=path.join(f.root,'linked');
  await symlink(path.dirname(script),link,'junction');
  const out=await run(path.join(link,'replay-product.mjs'),f.context);expect(out.code).not.toBe(0);
  expect(out.stdout.trim()).toBe(JSON.stringify({rule:'replay_path',pass:false}));
});
