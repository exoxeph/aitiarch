import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {stat,mkdir,lstat} from 'node:fs/promises';import path from 'node:path';
import {existsSync} from 'node:fs';import os from 'node:os';
import type {SafetyLabel} from './turn.ts';import {CODEX_VERSION,codexVersionNotice} from './codex-command.ts';
const exec=promisify(execFile);
export interface Availability {id:string;label:string;safetyLabel:SafetyLabel;available:boolean;reason:string|null}
export interface AvailabilityCheck {id:string;label:string;safetyLabel:SafetyLabel;check:()=>Promise<{available:boolean;reason:string|null}>}
export class CouncilAvailability {
 private checks:AvailabilityCheck[];private cached:{at:number;value:Promise<Availability[]>}|null=null;
 constructor(checks:AvailabilityCheck[]){this.checks=checks;}
 get(refresh=false){if(refresh||!this.cached||Date.now()-this.cached.at>30000)this.cached={at:Date.now(),value:Promise.all(this.checks.map(async({check,...info})=>{try{return {...info,...await check()};}catch{return {...info,available:false,reason:info.label+' local availability check failed. Verify its executable and restart or refresh.'};}}))};return this.cached.value;}
}
/** Fixed metadata argv only. Never starts a prompt, opens a login, or reads user configuration. */
export function localCouncilCheck(id:'claude'|'codex'|'kiro',command:string|undefined,providerHome?:string,metadata?: (args:string[])=>Promise<string>):AvailabilityCheck{
 return {id,label:id==='claude'?'Claude':id==='codex'?'Codex':'Kiro',safetyLabel:id==='claude'?'fenced':id==='codex'?'contained':'host-gated',check:async()=>{
  if(!command||!path.isAbsolute(command)||!(await stat(command).catch(()=>null))?.isFile())return {available:false,reason:`${id} executable missing. Start with a valid ${id==='kiro'?'installed Kiro CLI':'--'+id+' <path>'}.`};
  const output=metadata??(async(args:string[])=>{const r=await exec(command,args,{windowsHide:true,timeout:30000,maxBuffer:131072,env:Object.fromEntries(Object.entries(process.env).filter(([k])=>/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|TEMP|TMP)$/i.test(k)))});return r.stdout;});
  const version=(await output(['--version'])).trim(),found=/^(?:codex-cli|kiro-cli|Claude Code)?\s*([0-9A-Za-z.+-]{1,50})(?:\s+\(Claude Code\))?$/.exec(version)?.[1]??'unknown';
  if(id==='codex'&&found!==CODEX_VERSION)return {available:false,reason:codexVersionNotice(found)};
  if(id==='kiro'&&found!=='3.3.0')return {available:false,reason:`Kiro version ${found}; expected 3.3.0. Install the verified version.`};
  if(id==='claude'&&found==='unknown')return {available:false,reason:'Claude version could not be verified.'};
  const help=await output(id==='claude'?['--help']:[id==='codex'?'exec':'acp','--help']);const flags=id==='claude'?['--tools','--setting-sources','--strict-mcp-config','--disable-slash-commands','--include-hook-events']:id==='codex'?['--json','--ephemeral','--ignore-user-config','--ignore-rules','--disable']:['--agent-engine','--agent'];const missing=flags.filter(f=>!help.includes(f));if(missing.length)return {available:false,reason:`${id} ${found}: missing required flags ${missing.join(', ')}. Install the verified CLI.`};
  if(id==='kiro'){if(!providerHome)throw Error('home unavailable');let cur=path.parse(providerHome).root;for(const part of providerHome.slice(cur.length).split(path.sep)){cur=path.join(cur,part);await mkdir(cur).catch(e=>{if(e.code!=='EEXIST')throw e;});const s=await lstat(cur);if(s.isSymbolicLink()||!s.isDirectory())throw Error('unsafe home');}}
  return {available:true,reason:`Local checks passed (${found}); runtime isolation is checked again for each turn.`};
 }};
}
export function councilLocalChecks(claude?:string,codex?:string){
 const find=(name:string)=>{const paths=(process.env.PATH??'').split(path.delimiter).map(p=>path.join(p,name+(process.platform==='win32'?'.exe':'')));if(process.platform==='win32'&&name==='kiro-cli')paths.push(path.join(process.env.LOCALAPPDATA??'','Kiro-Cli','kiro-cli.exe'));return paths.find(p=>path.isAbsolute(p)&&existsSync(p));};
 return [localCouncilCheck('claude',claude),localCouncilCheck('codex',codex??find('codex')),localCouncilCheck('kiro',find('kiro-cli'),path.join(process.env.LOCALAPPDATA??path.join(os.homedir(),'.local','share'),'Aitiarch','providers','kiro-temp'))];
}
