import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import { createProvider } from '../server/providers/index.ts';
import { cleanupProviderTemp, sweepStaleProviderTemps } from '../server/providers/temp-cleanup.ts';
import { privateCleanupLog } from '../server/providers/failure-metrics.ts';

vi.mock('node:fs/promises', async original => {
  const actual = await original<typeof fs>();
  return { ...actual, rm: vi.fn(actual.rm) };
});
const actual = await vi.importActual<typeof fs>('node:fs/promises');
const roots:string[]=[];
const script=fileURLToPath(new URL('./fixtures/provider-cli.mjs',import.meta.url));
const request={id:'cleanup',action:'think' as const,question:'',selection:'Synthetic.',note:'Synthetic.',decisions:[],turns:[]};
afterEach(async()=>{vi.mocked(fs.rm).mockImplementation(actual.rm);for(const root of roots.splice(0))await actual.rm(root,{recursive:true,force:true});});
async function fixture(scenario='success'){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'aitiarch-cleanup-test-'));roots.push(root);
  const record=path.join(root,'record.json'),notes:unknown[]=[];
  const provider=createProvider({provider:'claude',contract:'fake',command:process.execPath,
    prefixArgs:[script,scenario,record,'claude'],failureLog:{write:async()=>{}},cleanupLog:{write:async note=>{notes.push(note);}}});
  await provider.checkAvailability();return {provider,record,notes};
}
for(const code of ['EBUSY','EPERM','ENOTEMPTY'])it(`retries transient ${code} errors, then removes the directory`,async()=>{
  const f=await fixture();let attempts=0;
  vi.mocked(fs.rm).mockImplementation(async(target,options)=>{
    if(path.basename(String(target)).startsWith('aitiarch-headless-')&&++attempts<3)throw Object.assign(new Error('private'),{code});
    return actual.rm(target,options);
  });
  await expect(f.provider.invoke(request)).resolves.toMatchObject({answer:'Answer for cleanup'});
  expect(attempts).toBe(3);expect(f.notes).toEqual([]);
});
it('cleanup records only code and attempt count in the private log',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'aitiarch-cleanup-test-'));roots.push(root);
  const target=path.join(root,'aitiarch-headless-Ab12Cd');await fs.mkdir(target);
  vi.mocked(fs.rm).mockRejectedValue(Object.assign(new Error('PRIVATE_SENTINEL'),{code:'EBUSY'}));
  await cleanupProviderTemp(target,{tempRoot:root,log:privateCleanupLog(path.join(root,'metrics'))});
  expect(await fs.readFile(path.join(root,'metrics','provider-cleanup.jsonl'),'utf8')).toBe('{"code":"EBUSY","attempts":5}\n');
});
it('cleanup log failure cannot discard a valid answer',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'aitiarch-cleanup-test-'));roots.push(root);
  const target=path.join(root,'aitiarch-headless-Ab12Cd');await fs.mkdir(target);
  vi.mocked(fs.rm).mockRejectedValue(Object.assign(new Error('PRIVATE_SENTINEL'),{code:'EACCES'}));
  await expect(cleanupProviderTemp(target,{tempRoot:root,log:{write:async()=>{throw new Error('PRIVATE_LOG_SENTINEL');}}})).resolves.toBeUndefined();
});
for(const scenario of ['success','invalid'])it(`persistent cleanup failure preserves ${scenario==='success'?'validated answer':'primary answer failure'}`,async()=>{
  const f=await fixture(scenario);let leftover='';
  vi.mocked(fs.rm).mockImplementation(async(target,options)=>{
    if(path.basename(String(target)).startsWith('aitiarch-headless-')){leftover=String(target);throw Object.assign(new Error('private'),{code:'EPERM'});}
    return actual.rm(target,options);
  });
  if(scenario==='success')await expect(f.provider.invoke(request)).resolves.toMatchObject({answer:'Answer for cleanup'});
  else await expect(f.provider.invoke(request)).rejects.toMatchObject({code:'invalid_response'});
  expect(f.notes).toEqual([{code:'EPERM',attempts:5}]);expect(await fs.stat(leftover)).toBeTruthy();roots.push(leftover);
});
it('awaits actual child exit after stdout closes before cleanup',async()=>{
  const f=await fixture('late-exit');let observed=false;
  vi.mocked(fs.rm).mockImplementation(async(target,options)=>{
    if(path.basename(String(target)).startsWith('aitiarch-headless-')){await fs.access(f.record+'.exited');observed=true;}
    return actual.rm(target,options);
  });
  await f.provider.invoke(request);expect(observed).toBe(true);
});
it('deadline kills a child even after it closes stdout, before cleanup',async()=>{
  const f=await fixture('late-hang');
  await expect(f.provider.invoke(request,{timeoutMs:1200})).rejects.toMatchObject({code:'timeout'});
  const record=JSON.parse(await fs.readFile(f.record,'utf8'));
  expect(()=>process.kill(record.pid,0)).toThrow();await expect(fs.stat(record.cwd)).rejects.toMatchObject({code:'ENOENT'});
});
it('startup sweep removes only old owned directories and preserves captures and links',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'aitiarch-cleanup-test-'));roots.push(root);
  const old=['aitiarch-headless-Ab12Cd','aitiarch-capabilities-Ef34Gh'];
  const keep=['aitiarch-headless-New123','aitiarch-think-replay-old','unrelated','aitiarch-headless-invalid-long'];
  for(const name of [...old,...keep]){await fs.mkdir(path.join(root,name));if(name!=='aitiarch-headless-New123')await fs.utimes(path.join(root,name),new Date(0),new Date(0));}
  const outside=await fs.mkdtemp(path.join(os.tmpdir(),'aitiarch-cleanup-test-'));roots.push(outside);
  await fs.symlink(outside,path.join(root,'aitiarch-headless-LiNk12'),'junction');
  await sweepStaleProviderTemps({tempRoot:root});
  expect((await fs.readdir(root)).sort()).toEqual([...keep,'aitiarch-headless-LiNk12'].sort());await fs.access(outside);
});
