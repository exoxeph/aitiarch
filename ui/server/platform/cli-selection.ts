import {resolveCli,type CliId,type DiscoveryOptions} from './cli-discovery.ts';
import {execFile} from 'node:child_process';
import {assessCapabilities} from '../providers/capabilities.ts';
import {assessToollessMetadata,cliVersion,compareVersions,type CliNotice} from '../providers/cli-compatibility.ts';
import {helpDeclaresEffort} from '../../shared/model-settings.ts';
import {loadMachineSetup} from '../setup-store.ts';
export interface CliSelectionOptions {
 ids?:readonly CliId[];
 nodeVersion?:string;nodeRange?:string;distDir?:string;configDir:string;cwd?:string;env?:NodeJS.ProcessEnv;platform?:NodeJS.Platform;discovery?:DiscoveryOptions;
 overrides?:Partial<Record<CliId,string>>;timeoutMs?:number;
  runner?:(file:string,args:readonly string[],options:{signal:AbortSignal;cwd:string;env:NodeJS.ProcessEnv})=>Promise<string>;
}
export interface SelectedCli {id:CliId;path:string|null;version:string|null;isolation:'unverified'|'metadata-compatible';code:string;reason:string;notices?:CliNotice[];roles:string[];effort:boolean|null;effortCode:'unverified'|'help_flag_present'|'help_flag_absent'|'not_applicable'}
const LIMIT=131072;
const ids:CliId[]=['claude','codex','kiro'];
const metadataRunner:NonNullable<CliSelectionOptions['runner']>=(file,args,{signal,cwd,env})=>new Promise((resolve,reject)=>{
 // No prompt, shell, config-file reads or login probes. Env carries only OS launch essentials.
 const allowed=Object.fromEntries(Object.entries(env).filter(([k])=>/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|TEMP|TMP)$/i.test(k)));
 execFile(file,[...args],{cwd,env:allowed,signal,timeout:30000,maxBuffer:LIMIT,encoding:'utf8',windowsHide:true,shell:false},(error,stdout)=>error?reject(error):resolve(stdout));
});
async function metadata(options:CliSelectionOptions,file:string,args:readonly string[]):Promise<string>{
 const controller=new AbortController(),ms=Math.max(1,Math.min(options.timeoutMs??30000,30000));
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{
  const text=await Promise.race([(options.runner??metadataRunner)(file,args,{signal:controller.signal,cwd:options.cwd??options.configDir,env:options.env??process.env}),
   new Promise<never>((_,reject)=>{timer=setTimeout(()=>{reject(Error('metadata_timeout'));controller.abort();},ms);})]);
  if(Buffer.byteLength(text)>LIMIT)throw Error('metadata_limit');return text;
 }catch(e){const code=(e as Error).message;throw Error(code==='metadata_timeout'||code==='metadata_limit'?code:'metadata_failed');}
 finally{clearTimeout(timer);}
}
export async function selectClis(options:CliSelectionOptions):Promise<SelectedCli[]>{
 const providers:SelectedCli[]=[];
 let setup:Awaited<ReturnType<typeof loadMachineSetup>>|undefined,setupError=false;
 try{setup=await loadMachineSetup(options.configDir);}catch{setupError=true;}
 for(const id of options.ids??ids){
  if(setupError){providers.push({id,path:null,version:null,isolation:'unverified',code:'setup_unavailable',reason:'Machine setup could not be read. Fix the saved settings before checking providers.',roles:[],effort:null,effortCode:'unverified'});continue;}
  const found=resolveCli(id,options.env??process.env,options.platform??process.platform,{...options.discovery,override:options.overrides?.[id]??setup?.providers[id].executable??undefined});
  const paths=id==='codex'&&found.candidates?.length?found.candidates:[found.path];
  let best:SelectedCli|undefined;
  for(const candidate of paths){
  const provider:SelectedCli={id,path:candidate,version:null,isolation:'unverified',code:found.code,reason:found.reason,roles:[],effort:id==='claude'?false:null,effortCode:id==='claude'?'unverified':'not_applicable'};
  best??=provider;
  if(!candidate)continue;
  try{
   const version=await metadata(options,candidate,['--version']);
   provider.version=cliVersion(id,version);
   const help=await metadata(options,candidate,id==='claude'?['--help']:[id==='codex'?'exec':'acp','--help']);
   if(id==='claude'){provider.effort=helpDeclaresEffort(help);provider.effortCode=provider.effort?'help_flag_present':'help_flag_absent';}
   const assessed=id==='claude'?assessCapabilities({provider:'claude',contract:'claude-canary-2.1.205'},version,help):assessToollessMetadata(id,version,help);
   const compatible=assessed.available;
   provider.notices='notices' in assessed?assessed.notices:[];
   provider.code=compatible?'metadata_compatible':'profile_unverified';provider.isolation=compatible?'metadata-compatible':'unverified';
   provider.roles=compatible?(id==='claude'?['normal-chat','invoked','thread-reply','council']:['normal-chat','council']):[];
   provider.reason=compatible?[...(provider.notices??[]).map(n=>n.message),'Metadata matches the tool-less profile. Runtime isolation, login and entitlement are not verified; existing turn checks still apply.'].join('; '):
    ('message' in assessed?assessed.message:'reason' in assessed?assessed.reason:null)??'CLI capabilities could not be verified. No request was sent.';
  }catch(e){provider.code=(e as Error).message;provider.reason='Metadata check failed, exceeded its output limit or timed out. Check the CLI installation; no request was sent.';}
  if(provider.isolation==='metadata-compatible'&&(best.isolation!=='metadata-compatible'||compareVersions(provider.version!,best.version!)>0))best=provider;
  }
  providers.push(best!);
 }
 return providers;
}

