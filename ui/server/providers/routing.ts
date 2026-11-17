// Runtime policy only. Reuses the exact existing adapters, never rebuilds a fence.
import type {SetupProvider} from '../../shared/setup.ts';
import type {MachineSetup} from '../../shared/setup.ts';
import type {TurnAdapter} from './turn.ts';
import {ProviderRegistry,descriptorFromAdapter,compatibleDefaults,type RequestSettingsSnapshot} from './registry.ts';
import {CouncilAvailability,type AvailabilityCheck} from './council-availability.ts';

export type RoleRouting=()=>Promise<RequestSettingsSnapshot>;
export function roleRouting(o:{dir:string;adapters:TurnAdapter[];checks:AvailabilityCheck[];legacyAnswerer:()=>SetupProvider;claudeBridge?:boolean}):RoleRouting {
 const availability=new CouncilAvailability(o.checks);
 const descriptors=o.adapters.map(a=>descriptorFromAdapter(a,{detect:async()=>{
  const state=(await availability.get()).find(p=>p.id===a.id);
  return state?{available:state.available,reason:state.reason}:{available:false,reason:'Provider local metadata could not be verified. No other provider was tried.'};
 },bridges:a.id==='claude'&&o.claudeBridge?{invoked:true,'thread-reply':true,'investigate-read':true,'skill-diagram':true}:undefined}));
 const registry=new ProviderRegistry(descriptors);
 let initial:Promise<MachineSetup>|undefined;
 return ()=>registry.snapshot(o.dir,async()=>{
  // A first-run suggestion is selected once, never recomputed as runtime fallback.
  initial??=availability.get().then(states=>compatibleDefaults(descriptors.filter(d=>states.some(s=>s.id===d.id&&s.available))));
  const setup=structuredClone(await initial),legacy=o.legacyAnswerer();
  // Preserve an explicit pre-machine-setup Pipeline choice, even if unavailable.
  // The legacy default Claude permits first-run compatible-only setup suggestions.
  if(legacy!=='claude'){setup.roles['normal-chat']=legacy;setup.providers[legacy].enabled=true;}
  return setup;
 });
}
