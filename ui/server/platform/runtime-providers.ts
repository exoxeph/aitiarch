import {selectClis,type CliSelectionOptions} from './cli-selection.ts';
import {selectedCouncilAdapters} from '../providers/council-adapters.ts';
import {DEFAULT_PIPELINE_CONFIG} from '../../shared/pipeline-config.ts';
import {verifyKiroProviderHome,type AvailabilityCheck} from '../providers/council-availability.ts';
import path from 'node:path';
import os from 'node:os';

/** Select once for the process. Metadata refresh may disable that path, never substitute another. */
export async function selectRuntimeProviders(options:CliSelectionOptions){
 const providers=await selectClis(options);
 const commands=Object.fromEntries(providers.filter(p=>p.path&&p.isolation==='metadata-compatible').map(p=>[p.id,p.path!])) as Partial<Record<'claude'|'codex'|'kiro',string>>;
 const availabilityChecks:AvailabilityCheck[]=providers.map(p=>({id:p.id,label:p.id==='claude'?'Claude':p.id==='codex'?'Codex':'Kiro',safetyLabel:DEFAULT_PIPELINE_CONFIG.safetyLabels[p.id],
  check:async()=>{
   // An absent or incompatible startup selection stays off until restart. No fallback.
   const current=p.path&&p.isolation==='metadata-compatible'?(await selectClis({...options,ids:[p.id],overrides:{[p.id]:p.path}}))[0]:p;
   if(current.id==='kiro'&&current.isolation==='metadata-compatible'){
    try{await verifyKiroProviderHome(path.join((options.env??process.env).LOCALAPPDATA??path.join(os.homedir(),'.local','share'),'Aitiarch','providers','kiro-temp'));}
    catch{return {available:false,path:current.path,version:current.version??undefined,reason:'Kiro app-owned provider home cannot be created safely. Check its folder permissions; no other provider was tried.'};}
   }
   return {available:current.isolation==='metadata-compatible',path:current.path,version:current.version??undefined,notices:current.notices,reason:current.reason};
  }}));
 return {providers,commands,adapters:selectedCouncilAdapters(providers),availabilityChecks};
}
