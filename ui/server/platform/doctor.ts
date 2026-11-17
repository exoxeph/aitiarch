import {resolveCli,type CliId,type DiscoveryOptions} from './cli-discovery.ts';
import {execFile} from 'node:child_process';
import {access,readFile,stat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {assessCapabilities} from '../providers/capabilities.ts';
import {CODEX_VERSION,codexVersionNotice} from '../providers/codex-command.ts';
export interface DoctorOptions {
 nodeVersion?:string;nodeRange?:string;distDir?:string;configDir:string;cwd?:string;env?:NodeJS.ProcessEnv;platform?:NodeJS.Platform;discovery?:DiscoveryOptions;
 overrides?:Partial<Record<CliId,string>>;timeoutMs?:number;
 filesystem?:{buildPresent:(dir:string)=>Promise<boolean>;configWritable:(dir:string)=>Promise<boolean>};
 runner?:(file:string,args:readonly string[],options:{signal:AbortSignal;cwd:string;env:NodeJS.ProcessEnv})=>Promise<string>;
}
export interface DoctorProvider {id:CliId;path:string|null;version:string|null;isolation:'unverified'|'metadata-compatible';code:string;reason:string;roles:string[];effort:boolean|null;effortCode:'unverified'|'help_flag_present'|'help_flag_absent'|'not_applicable'}
export interface DoctorReport {exitCode:0|1;checks:{id:string;ok:boolean;code:string;reason:string}[];providers:DoctorProvider[];notice:string}
const LIMIT=131072;
const ids:CliId[]=['claude','codex','kiro'];
const metadataRunner:NonNullable<DoctorOptions['runner']>=(file,args,{signal,cwd,env})=>new Promise((resolve,reject)=>{
 // No prompt, shell, config-file reads or login probes. Env carries only OS launch essentials.
 const allowed=Object.fromEntries(Object.entries(env).filter(([k])=>/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|TEMP|TMP)$/i.test(k)));
 execFile(file,[...args],{cwd,env:allowed,signal,timeout:30000,maxBuffer:LIMIT,encoding:'utf8',windowsHide:true,shell:false},(error,stdout)=>error?reject(error):resolve(stdout));
});
function declared(help:string,flag:string):boolean{
 return help.split(/\r?\n/).some(line=>new RegExp('^\\s*(?:-[A-Za-z],\\s*)?'+flag+'(?=[\\s=,]|$)').test(line));
}
async function metadata(options:DoctorOptions,file:string,args:readonly string[]):Promise<string>{
 const controller=new AbortController(),ms=Math.max(1,Math.min(options.timeoutMs??30000,30000));
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{
  const text=await Promise.race([(options.runner??metadataRunner)(file,args,{signal:controller.signal,cwd:options.cwd??options.configDir,env:options.env??process.env}),
   new Promise<never>((_,reject)=>{timer=setTimeout(()=>{reject(Error('metadata_timeout'));controller.abort();},ms);})]);
  if(Buffer.byteLength(text)>LIMIT)throw Error('metadata_limit');return text;
 }catch(e){const code=(e as Error).message;throw Error(code==='metadata_timeout'||code==='metadata_limit'?code:'metadata_failed');}
 finally{clearTimeout(timer);}
}
export async function doctor(options:DoctorOptions):Promise<DoctorReport>{
 const install=fileURLToPath(new URL('../../',import.meta.url));
 const nodeRange=options.nodeRange??JSON.parse(await readFile(path.join(install,'package.json'),'utf8')).engines.node;
 const checks:DoctorReport['checks']=[];
 const check=async(id:string,run:()=>boolean|Promise<boolean>,reason:string)=>{let ok=false;try{ok=await run();}catch{/* metadata-only stable diagnostics */}checks.push({id,ok,code:ok?'ok':id+'_unavailable',reason:ok?'OK':reason});};
 // This repository's engines constraint is a minimum, not an arbitrary semver expression.
 await check('node',()=>{const min=/^>=(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(nodeRange),actual=/^v?(\d+)\.(\d+)\.(\d+)$/.exec(options.nodeVersion??process.versions.node);
  if(!min||!actual)return false;for(let i=1;i<=3;i++){const a=Number(actual[i]),b=Number(min[i]??0);if(a!==b)return a>b;}return true;},`Install Node ${nodeRange}; rerun doctor.`);
 await check('build',()=>options.filesystem?options.filesystem.buildPresent(options.distDir??path.join(install,'dist')):
  stat(path.join(options.distDir??path.join(install,'dist'),'index.html')).then(s=>s.isFile()),'Build assets missing; run npm ci and npm run build from the ui install folder.');
 await check('config',()=>options.filesystem?options.filesystem.configWritable(options.configDir):
  stat(options.configDir).then(async s=>s.isDirectory()&&(await access(options.configDir,constants.W_OK),true)),'Create a writable app config folder or select one with AITIARCH_CONFIG_DIR.');
 const providers:DoctorProvider[]=[];
 for(const id of ids){
  const found=resolveCli(id,options.env??process.env,options.platform??process.platform,{...options.discovery,override:options.overrides?.[id]});
  const provider:DoctorProvider={id,path:found.path,version:null,isolation:'unverified',code:found.code,reason:found.reason,roles:[],effort:id==='claude'?false:null,effortCode:id==='claude'?'unverified':'not_applicable'};providers.push(provider);
  if(!found.path)continue;
  try{
   const version=await metadata(options,found.path,['--version']);
   const pattern=id==='claude'?/^(\d+\.\d+\.\d+) \(Claude Code\)\s*$/:id==='codex'?/^codex-cli ([0-9A-Za-z.+-]{1,50})\s*$/:/^kiro-cli (\d+\.\d+\.\d+)\s*$/;
   provider.version=pattern.exec(version.trim())?.[1]??null;
   const help=await metadata(options,found.path,id==='claude'?['--help']:[id==='codex'?'exec':'acp','--help']);
   if(id==='claude'){provider.effort=declared(help,'--effort');provider.effortCode=provider.effort?'help_flag_present':'help_flag_absent';}
   let compatible=false;
   if(id==='claude')compatible=assessCapabilities({provider:'claude',contract:'claude-canary-2.1.205'},version,help).available;
   else if(id==='codex')compatible=provider.version===CODEX_VERSION&&['--json','--ephemeral','--ignore-user-config','--ignore-rules','--disable'].every(f=>declared(help,f));
   else compatible=provider.version==='3.3.0'&&['--agent-engine','--agent'].every(f=>declared(help,f));
   provider.code=compatible?'metadata_compatible':'profile_unverified';provider.isolation=compatible?'metadata-compatible':'unverified';
   provider.roles=compatible?(id==='claude'?['normal-chat','invoked','thread-reply','council']:['normal-chat','council']):[];
   provider.reason=id==='codex'&&provider.version!==CODEX_VERSION?codexVersionNotice(provider.version??'unknown'):
    compatible?'Metadata matches the tool-less profile. Runtime isolation, login and entitlement are not verified; existing turn checks still apply.':'CLI version or required flags do not match the verified profile; check the supported CLI version. No request was sent.';
  }catch(e){provider.code=(e as Error).message;provider.reason='Metadata check failed, exceeded its output limit or timed out. Check the CLI installation; no request was sent.';}
 }
 return {exitCode:checks.every(c=>c.ok)?0:1,checks,providers,notice:'AI-off editing remains available when optional providers are missing. Login and entitlement were not checked.'};
}
export function formatDoctor(report:DoctorReport):string{return [...report.checks.map(c=>`${c.id}: ${c.code} — ${c.reason}`),...report.providers.map(p=>`${p.id}: ${p.code}; path=${p.path??'not found'}; version=${p.version??'unknown'}; isolation=${p.isolation}; roles=${p.roles.join(', ')||'none verified'}; effort=${p.effort===null?'n/a':p.effort} — ${p.reason}`),report.notice].join('\n');}
