import {DEFAULT_PIPELINE_CONFIG as defaults} from '../../shared/pipeline-config.ts';
import {stat,mkdir,lstat,mkdtemp} from 'node:fs/promises';import {metadataOutput,spawnToolless,killTree} from './launcher.ts';import {cleanupProviderTemp} from './temp-cleanup.ts';import path from 'node:path';
import {existsSync} from 'node:fs';import os from 'node:os';
import type {SafetyLabel} from './turn.ts';
import {assessToollessMetadata,cliVersion,type CliNotice} from './cli-compatibility.ts';
import {assessCapabilities} from './capabilities.ts';
async function localMetadata(id:'claude'|'codex'|'kiro',command:string,args:string[]){
 const cwd=await mkdtemp(path.join(os.tmpdir(),'aitiarch-headless-'));const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|TEMP|TMP)$/i.test(k)));
 try{if(id==='claude')return await metadataOutput({provider:'claude',command},args,cwd,env);
 return await new Promise<string>((resolve,reject)=>{const child=spawnToolless({id,command},args[0]==='--version'?'version':'metadata',{cwd,env});let output='',failed=false,killing=Promise.resolve();const stop=()=>{failed=true;if(child.pid)killing=killTree(child.pid);};const timer=setTimeout(stop,30000);child.stdin.end();child.stdout.on('data',b=>{output+=b;if(output.length>131072)stop();});child.stderr.resume();child.on('error',()=>{failed=true;});child.once('close',async code=>{clearTimeout(timer);await killing;if(failed||code!==0)reject(Error('Metadata check failed'));else resolve(output);});});
 }finally{console.info('Council metadata cleanup target:',cwd);await cleanupProviderTemp(cwd);}
}
export interface Availability {id:string;label:string;safetyLabel:SafetyLabel;available:boolean;reason:string|null;path?:string|null;version?:string;notices?:CliNotice[]}
export interface AvailabilityCheck {id:string;label:string;safetyLabel:SafetyLabel;check:()=>Promise<{available:boolean;reason:string|null;path?:string|null;version?:string;notices?:CliNotice[]}>}
export class CouncilAvailability {
 private checks:AvailabilityCheck[];private cached:{at:number;value:Promise<Availability[]>}|null=null;
 constructor(checks:AvailabilityCheck[]){this.checks=checks;}
 get(refresh=false){if(refresh||!this.cached||Date.now()-this.cached.at>30000)this.cached={at:Date.now(),value:Promise.all(this.checks.map(async({check,...info})=>{try{return {...info,...await check()};}catch{return {...info,available:false,reason:info.label+' local availability check failed. Verify its executable and restart or refresh.'};}}))};return this.cached.value;}
}
/** Fixed metadata argv only. Never starts a prompt, opens a login, or reads user configuration. */
export async function verifyKiroProviderHome(providerHome:string){
 let cur=path.parse(providerHome).root;for(const part of providerHome.slice(cur.length).split(path.sep)){cur=path.join(cur,part);await mkdir(cur).catch(e=>{if(e.code!=='EEXIST')throw e;});const s=await lstat(cur);if(s.isSymbolicLink()||!s.isDirectory())throw Error('unsafe home');}
}
export function localCouncilCheck(id:'claude'|'codex'|'kiro',command:string|undefined,providerHome?:string,metadata?: (args:string[])=>Promise<string>):AvailabilityCheck{
 return {id,label:id==='claude'?'Claude':id==='codex'?'Codex':'Kiro',safetyLabel:defaults.safetyLabels[id],check:async()=>{
  if(!command||!path.isAbsolute(command)||!(await stat(command).catch(()=>null))?.isFile())return {available:false,reason:`${id} executable missing. Start with a valid ${id==='kiro'?'installed Kiro CLI':'--'+id+' <path>'}.`};
  const output=metadata??((args:string[])=>localMetadata(id,command,args));
  const version=(await output(['--version'])).trim(),found=cliVersion(id,version);
  const help=await output(id==='claude'?['--help']:[id==='codex'?'exec':'acp','--help']);
  const assessed=id==='claude'?assessCapabilities({provider:'claude',contract:'claude-canary-2.1.205'},version,help):assessToollessMetadata(id,version,help);
  if(!assessed.available)return {available:false,reason:('message' in assessed?assessed.message:assessed.reason)??'Required CLI capabilities could not be verified.',...(found?{version:found}:{})};
  if(id==='kiro'){if(!providerHome)throw Error('home unavailable');await verifyKiroProviderHome(providerHome);}
  return {available:true,version:found!,notices:assessed.notices,reason:[...(assessed.notices??[]).map(n=>n.message),`Local checks passed (${found}); runtime isolation is checked again for each turn.`].join('; ')};
 }};
}
export function councilLocalChecks(claude?:string,codex?:string){
 const find=(name:string)=>{const paths=(process.env.PATH??'').split(path.delimiter).map(p=>path.join(p,name+(process.platform==='win32'?'.exe':'')));if(process.platform==='win32'&&name==='kiro-cli')paths.push(path.join(process.env.LOCALAPPDATA??'','Kiro-Cli','kiro-cli.exe'));return paths.find(p=>path.isAbsolute(p)&&existsSync(p));};
 return [localCouncilCheck('claude',claude),localCouncilCheck('codex',codex??find('codex')),localCouncilCheck('kiro',find('kiro-cli'),path.join(process.env.LOCALAPPDATA??path.join(os.homedir(),'.local','share'),'Aitiarch','providers','kiro-temp'))];
}
