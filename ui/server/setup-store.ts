import {open,mkdir,rename,unlink,lstat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {defaultMachineSetup,validMachineSetup,SETUP_PROVIDERS,SETUP_ROLES,type MachineSetup,type SetupProvider,type SetupRole} from '../shared/setup.ts';
import type {ProviderDescriptor} from './providers/registry.ts';
import {configDir,underTest} from './registry.ts';
import {resolveCli} from './platform/cli-discovery.ts';

export const SETUP_FILE='machine-setup.json';
export const SETUP_MAX_BYTES=65536;
export type SetupCode='setup_invalid'|'setup_too_large'|'setup_read'|'setup_write'|'setup_executable'|'test_guard';
export class SetupError extends Error {
 readonly code:SetupCode;
 constructor(code:SetupCode){
  super(({setup_invalid:'Invalid machine setup. The file was left unchanged.',setup_too_large:'Machine setup exceeds its size limit.',
   setup_read:'Machine setup could not be read. The file was left unchanged.',setup_write:'Machine setup could not be saved. Previous settings were preserved.',
   setup_executable:'Choose an existing absolute local native executable, not a directory or shell shim.',
   test_guard:'Tests must use a temporary machine setup folder.'})[code]);this.code=code;
 }
}
function folder(dir:string):string {
 const resolved=path.resolve(dir),real=configDir();
 const same=(a:string,b:string)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
 if(underTest()&&same(resolved,path.resolve(real)))throw new SetupError('test_guard');
 return resolved;
}
/** Caller supplies the registry's resolveConfigFolder() result; never reads projects.json or pipeline-config.json. */
export async function loadMachineSetup(dir:string):Promise<MachineSetup>{
 const file=path.join(folder(dir),SETUP_FILE);
 let text:string;
 try {
  const info=await lstat(file);
  if(!info.isFile()||info.isSymbolicLink())throw new SetupError('setup_read');
  if(info.size>SETUP_MAX_BYTES)throw new SetupError('setup_too_large');
  // A bounded read also limits a file that grows between stat and read. O_NOFOLLOW
  // is used where supported; on Windows lstat still rejects existing links.
  const handle=await open(file,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try {
   const buffer=Buffer.alloc(SETUP_MAX_BYTES+1);let bytes=0;
   while(bytes<buffer.length){const r=await handle.read(buffer,bytes,buffer.length-bytes,null);if(!r.bytesRead)break;bytes+=r.bytesRead;}
   if(bytes>SETUP_MAX_BYTES)throw new SetupError('setup_too_large');
   text=buffer.subarray(0,bytes).toString('utf8');
  }finally{await handle.close();}
 }catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return defaultMachineSetup();if(e instanceof SetupError)throw e;throw new SetupError('setup_read');}
 let value:unknown;
 try{value=JSON.parse(text);}catch{throw new SetupError('setup_invalid');}
 if(!validMachineSetup(value))throw new SetupError('setup_invalid');
 // A removed CLI is discovered later, not a reason to discard otherwise valid settings.
 return value;
}
/** Atomic same-directory replace; injection permits deterministic filesystem-failure tests. */
export async function saveMachineSetup(dir:string,value:unknown,options:{replace?:(from:string,to:string)=>Promise<void>}={}):Promise<void>{
 const target=folder(dir);
 if(!validMachineSetup(value))throw new SetupError('setup_invalid');
 // Snapshot before the first await: concurrent caller edits cannot bypass validation.
 const text=JSON.stringify(value,null,2)+'\n';
 if(Buffer.byteLength(text)>SETUP_MAX_BYTES)throw new SetupError('setup_too_large');
 for(const id of SETUP_PROVIDERS){const executable=value.providers[id].executable;
  if(executable!==null&&resolveCli(id,{},process.platform,{override:executable}).code!=='found')throw new SetupError('setup_executable');
 }
 const temp=path.join(target,`${SETUP_FILE}.${randomUUID()}.tmp`);let created=false;
 try {
  await mkdir(target,{recursive:true});
  const handle=await open(temp,'wx',0o600);created=true;
  try{await handle.writeFile(text);await handle.sync();}finally{await handle.close();}
  // Same-filesystem rename is atomic; if unsupported/locked on an OS, fail without
  // deleting the previous settings. No destructive replacement fallback.
  await (options.replace??rename)(temp,path.join(target,SETUP_FILE));
 }catch{throw new SetupError('setup_write');}
 finally{if(created)await unlink(temp).catch(()=>{/* Only our uniquely named staging file; a leftover is harmless. */});}
}

/** Explicit startup initialization, not runtime fallback. Existing assignments and provider preferences win. */
export async function initializeDefaultRoles(dir:string,providers:readonly ProviderDescriptor[],preferred:readonly SetupProvider[]=[],priorRoles:Partial<Record<SetupRole,SetupProvider>>={}):Promise<MachineSetup>{
 let exists=true;try{await lstat(path.join(folder(dir),SETUP_FILE));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')exists=false;else throw new SetupError('setup_read');}
 const setup=await loadMachineSetup(dir),before=JSON.stringify(setup);
 const available=(await Promise.all(providers.map(async p=>{try{return (await p.detect()).available?p:null;}catch{return null;}}))).filter((p):p is ProviderDescriptor=>p!==null);
 if(!exists){
  // loadMachineSetup's legacy Claude defaults are not saved user choices.
  for(const role of SETUP_ROLES)setup.roles[role]=null;
  for(const id of SETUP_PROVIDERS)setup.providers[id].enabled=available.some(p=>p.id===id);
  for(const role of SETUP_ROLES){const id=priorRoles[role];if(id){setup.roles[role]=id;setup.providers[id].enabled=true;}}
 }
 const order=[...new Set([...preferred,...SETUP_PROVIDERS])];
 for(const role of SETUP_ROLES){
  if(setup.roles[role]!==null)continue;
  const selected=order.map(id=>available.find(p=>p.id===id&&p.capabilities[role]&&setup.providers[id].enabled)).find(Boolean);
  if(selected){
   setup.roles[role]=selected.id;
   (setup.defaultRoles??=[]).push(role);
  }
 }
 // Council eligibility uses all enabled compatible descriptors, not this legacy single-role slot.
 if(!exists||before!==JSON.stringify(setup))await saveMachineSetup(dir,setup);
 return setup;
}
