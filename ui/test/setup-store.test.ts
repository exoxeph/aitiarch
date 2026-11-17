import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {mkdtemp,writeFile,readFile,readdir,mkdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {loadMachineSetup,saveMachineSetup,SETUP_FILE} from '../server/setup-store.ts';
import {resolveConfigFolder,configDir} from '../server/registry.ts';

// Only synthetic settings and executable headers; no CLI is ever launched.
const defaults=()=>({version:1,providers:{
 claude:{enabled:true,executable:null,model:null,effort:null,roles:{}},
 codex:{enabled:false,executable:null,model:null,effort:null,roles:{}},
 kiro:{enabled:false,executable:null,model:null,effort:null,roles:{}},
},roles:{'normal-chat':'claude',invoked:'claude','thread-reply':'claude',council:'claude','investigate-read':'claude','skill-diagram':'claude'},fontSize:16,tour:{completed:false}});
let dir:string;
beforeEach(async()=>{dir=await mkdtemp(path.join(os.tmpdir(),'aitiarch-setup-'));vi.stubEnv('AITIARCH_CONFIG_DIR',dir);});
afterEach(()=>vi.unstubAllEnvs());
const raw=async(value:unknown)=>writeFile(path.join(dir,SETUP_FILE),JSON.stringify(value));

describe('machine setup store v1',()=>{
 it('missing setup returns independent Claude defaults without creating any file',async()=>{
  expect(await loadMachineSetup(dir)).toEqual(defaults());expect(await readdir(dir)).toEqual([]);
  const changed=await loadMachineSetup(dir);changed.fontSize=22;
  expect((await loadMachineSetup(dir)).fontSize).toBe(16);
 });
 it('round-trips provider and role choices, model/effort, font size and tour state',async()=>{
  const value=defaults();value.providers.codex.enabled=true;value.roles['normal-chat']='codex';value.fontSize=22;value.tour.completed=true;
  Object.assign(value.providers.codex,{model:'synthetic-model',effort:'low',roles:{invoked:{model:'synthetic-role-model',effort:null}}});
  await saveMachineSetup(dir,value);expect(await loadMachineSetup(dir)).toEqual(value);
  expect(JSON.parse(await readFile(path.join(dir,SETUP_FILE),'utf8'))).toEqual(value);
 });
 it.each(['','{bad json',JSON.stringify({...defaults(),version:2}),'x'.repeat(65537)])('rejects empty, invalid, future-version and oversized files without changing them: %#',async text=>{
  await writeFile(path.join(dir,SETUP_FILE),text);
  await expect(loadMachineSetup(dir)).rejects.toMatchObject({code:expect.stringMatching(/^setup_(invalid|too_large)$/)});
  expect(await readFile(path.join(dir,SETUP_FILE),'utf8')).toBe(text);
 });
 it.each(['root','provider','role-settings','tour'])('rejects unknown keys at %s on load and save',async level=>{
  const value=defaults();const v=value as any;
  if(level==='root')v.unknown=true;else if(level==='provider')v.providers.claude.unknown=true;
  else if(level==='role-settings')v.providers.claude.roles.invoked={model:null,effort:null,unknown:true};else v.tour.unknown=true;
  await expect(saveMachineSetup(dir,value)).rejects.toMatchObject({code:'setup_invalid'});
  expect(await readdir(dir)).toEqual([]);await raw(value);
  await expect(loadMachineSetup(dir)).rejects.toMatchObject({code:'setup_invalid'});
 });
 it.each(['credentials','accessToken','refreshToken','prompts','notes'])('refuses %s, never writing the supplied value or echoing it in errors',async key=>{
  const value={...defaults(),[key]:'synthetic-private-value'};
  await expect(saveMachineSetup(dir,value)).rejects.toThrow(/Invalid machine setup/);
  expect(await readdir(dir)).toEqual([]);
 });
 it.each([13,25,NaN,16.5])('rejects invalid font size %s',async fontSize=>{
  await expect(saveMachineSetup(dir,{...defaults(),fontSize})).rejects.toMatchObject({code:'setup_invalid'});
 });
 it.each(['provider','role','enabled','tour','model','effort','kiro'])('rejects invalid provider/settings shapes: %s',async kind=>{
  const v:any=defaults();
  if(kind==='provider')v.providers.other=v.providers.claude;
  if(kind==='role')v.roles.invoked='other';
  if(kind==='enabled')v.providers.claude.enabled='yes';
  if(kind==='tour')v.tour.completed='yes';
  if(kind==='model')v.providers.claude.model='bad\nmodel';
  if(kind==='effort')v.providers.codex.effort='x'.repeat(41);
  if(kind==='kiro')v.providers.kiro.model='not-default';
  await expect(saveMachineSetup(dir,v)).rejects.toMatchObject({code:'setup_invalid'});
 });
 it.each(['relative/cli','~/cli','\\\\server\\cli.exe','\\\\?\\C:\\cli.exe','C:cli.exe'])('rejects nonlocal or nonabsolute executable %s',async executable=>{
  const value=defaults();Object.assign(value.providers.claude,{executable});
  await expect(saveMachineSetup(dir,value)).rejects.toMatchObject({code:'setup_invalid'});
  expect(await readdir(dir)).toEqual([]);
 });
 it('checks explicit executable files, not directories, missing paths or shell shims',async()=>{
  const executable=path.join(dir,process.platform==='win32'?'synthetic.exe':'synthetic');
  const magic=process.platform==='win32'?Buffer.from('4d5a0000','hex'):process.platform==='darwin'?Buffer.from('cffaedfe','hex'):Buffer.from('7f454c46','hex');
  await writeFile(executable,magic,{mode:0o700});const value=defaults();Object.assign(value.providers.claude,{executable});
  await saveMachineSetup(dir,value);expect((await loadMachineSetup(dir)).providers.claude.executable).toBe(executable);
  for(const invalid of [dir,path.join(dir,'missing.exe'),path.join(dir,'shim.cmd')]){
   Object.assign(value.providers.claude,{executable:invalid});
   await expect(saveMachineSetup(dir,value)).rejects.toMatchObject({code:'setup_executable'});
  }
  // A disappeared install is a later discovery concern, not permission to lose settings on load.
  await raw({...defaults(),providers:{...defaults().providers,claude:{...defaults().providers.claude,executable:path.join(dir,'missing.exe')}}});
  expect((await loadMachineSetup(dir)).providers.claude.executable).toBe(path.join(dir,'missing.exe'));
 });
 it('atomic replacement failure preserves the old settings and removes only its temporary file',async()=>{
  await saveMachineSetup(dir,defaults());const before=await readFile(path.join(dir,SETUP_FILE));
  const changed={...defaults(),fontSize:24};
  await expect(saveMachineSetup(dir,changed,{replace:async()=>{throw Object.assign(Error('synthetic'),{code:'EIO'});}})).rejects.toMatchObject({code:'setup_write'});
  expect(await readFile(path.join(dir,SETUP_FILE))).toEqual(before);expect(await readdir(dir)).toEqual([SETUP_FILE]);
 });
 it('first-write failure never leaves a partial settings file',async()=>{
  await expect(saveMachineSetup(dir,defaults(),{replace:async()=>{throw Error('synthetic');}})).rejects.toMatchObject({code:'setup_write'});
  expect(await readdir(dir)).toEqual([]);
 });
 it('leaves pipeline settings and the project registry byte-identical',async()=>{
  const pipeline='{"version":1,"overrides":{}}\r\n',registry='synthetic project registry, not read';
  await writeFile(path.join(dir,'pipeline-config.json'),pipeline);await writeFile(path.join(dir,'projects.json'),registry);
  await saveMachineSetup(dir,defaults());await loadMachineSetup(dir);
  expect(await readFile(path.join(dir,'pipeline-config.json'),'utf8')).toBe(pipeline);
  expect(await readFile(path.join(dir,'projects.json'),'utf8')).toBe(registry);
 });
 it('uses the registry resolver override and never opens a real config folder under tests',async()=>{
  expect(resolveConfigFolder()).toBe(dir);await saveMachineSetup(resolveConfigFolder(),defaults());
  await expect(loadMachineSetup(configDir())).rejects.toMatchObject({code:'test_guard'});
  await expect(saveMachineSetup(configDir(),defaults())).rejects.toMatchObject({code:'test_guard'});
 });
 it('rejects a directory in place of the setup file',async()=>{
  await mkdir(path.join(dir,SETUP_FILE));await expect(loadMachineSetup(dir)).rejects.toMatchObject({code:'setup_read'});
 });
});
