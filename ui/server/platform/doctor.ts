import {access,readFile,stat,lstat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {selectClis,type CliSelectionOptions,type SelectedCli} from './cli-selection.ts';
import {loadMachineSetup,SETUP_FILE} from '../setup-store.ts';
import {SETUP_ROLES,type SetupRole,type SetupProvider} from '../../shared/setup.ts';
import {providerCapabilities} from '../providers/registry.ts';
export interface DoctorOptions extends CliSelectionOptions {
 filesystem?:{buildPresent:(dir:string)=>Promise<boolean>;configWritable:(dir:string)=>Promise<boolean>};
}
export type DoctorProvider=SelectedCli;
export interface DoctorRole {role:SetupRole;provider:SetupProvider|null;version:string|null;reason:string|null;participants?:SetupProvider[]}
export interface DoctorReport {exitCode:0|1;checks:{id:string;ok:boolean;code:string;reason:string}[];providers:DoctorProvider[];roles?:DoctorRole[];notice:string}
export async function checkPrerequisites(options:DoctorOptions):Promise<DoctorReport['checks']>{
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
 return checks;
}
export async function doctor(options:DoctorOptions):Promise<DoctorReport>{
 const checks=await checkPrerequisites(options);
 const providers=await selectClis(options);
 let setup:Awaited<ReturnType<typeof loadMachineSetup>>|null=null,roleError=false;
 try{await lstat(path.join(options.configDir,SETUP_FILE));setup=await loadMachineSetup(options.configDir);}catch(e){roleError=(e as NodeJS.ErrnoException).code!=='ENOENT';}
 const roles=SETUP_ROLES.map(role=>{
  const id=setup?.roles[role]??null,p=providers.find(p=>p.id===id);
  const capable=id&&providerCapabilities(id,{invoked:true,'thread-reply':true,'investigate-read':true,'skill-diagram':true})[role];
  return {role,provider:id,version:p?.version??null,reason:roleError?'Machine setup could not be read. Fix the saved settings.':!id?'No compatible provider is assigned for this role. Start Aitiarch to assign available defaults.':!setup!.providers[id].enabled?'Assigned provider is disabled.':!capable?`${id} has no verified bridge for ${role}.`:p?.isolation!=='metadata-compatible'?p?.reason??'Assigned provider is unavailable.':null,
   ...(role==='council'?{participants:providers.filter(p=>p.isolation==='metadata-compatible'&&setup?.providers[p.id].enabled).map(p=>p.id)}:{})};
 });
 return {exitCode:checks.every(c=>c.ok)?0:1,checks,providers,roles,notice:'AI-off editing remains available when optional providers are missing. Login and entitlement were not checked.'};
}
export function formatDoctor(report:DoctorReport):string{return [...report.checks.map(c=>`${c.id}: ${c.code} — ${c.reason}`),...report.providers.map(p=>`${p.id}: ${p.code}; path=${p.path??'not found'}; version=${p.version??'unknown'}; isolation=${p.isolation}; roles=${p.roles.join(', ')||'none verified'}; effort=${p.effort===null?'n/a':p.effort} — ${p.reason}`),...(report.roles??[]).map(r=>`${r.role} -> ${r.provider===null?'unset: '+r.reason:(r.provider==='claude'?'Claude':r.provider==='codex'?'Codex':'Kiro')+', version='+(r.version??'not reported')+(r.reason?'; '+r.reason:'')}${r.participants?.length?'; participants='+r.participants.join(', '):''}`),report.notice].join('\n');}
