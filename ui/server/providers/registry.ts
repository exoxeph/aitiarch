// Policy and request snapshots only. Existing adapters retain all runtime guards.
// No spawn, read-tool harness constructor, prompt assembly or active global settings.
import {createHash} from 'node:crypto';
import {defaultMachineSetup,SETUP_PROVIDERS,SETUP_ROLES,type MachineSetup,type SetupRole,type SetupProvider} from '../../shared/setup.ts';
import {loadMachineSetup} from '../setup-store.ts';
import {SETUP_FILE} from '../setup-store.ts';
import {lstat} from 'node:fs/promises';
import path from 'node:path';
import type {TurnAdapter,SafetyLabel} from './turn.ts';
import type {createInvokedCodexBridge} from './invoked-bridge.ts';
import type {Provider} from './index.ts';
export type InvokedBridgeFactory=(options:Pick<Parameters<typeof createInvokedCodexBridge>[0],'cap'|'onTurn'|'beforeTurn'>)=>Provider;

export interface Detection {available:boolean;reason:string|null}
export interface ProviderDescriptor {
 readonly id:SetupProvider;readonly label:string;readonly safetyLabel:SafetyLabel;
 readonly capabilities:Readonly<Record<SetupRole|'vision',boolean>>;
 readonly vision:Readonly<{available:boolean;reason:string}>;
 readonly detect:()=>Promise<Detection>;
 readonly models:()=>Promise<{source:'default';models:readonly {id:null;label:string}[];reason:string}>;
 readonly createToollessAdapter:()=>TurnAdapter;
 readonly createInvokedProvider?:InvokedBridgeFactory;
}
export interface Unavailable {
 available:false;provider:SetupProvider|null;role:SetupRole;
 code:'provider-disabled'|'provider-unavailable'|'role-unavailable'|'settings-unavailable';reason:string;
}
export type RoleResolution=ProviderDescriptor|Unavailable;
export interface RequestSettingsSnapshot {
 readonly settings:MachineSetup;
 resolveRole(role:SetupRole):RoleResolution;
 resolveParticipant(id:SetupProvider):RoleResolution;
 council():{available:boolean;providers:readonly ProviderDescriptor[];reason:string|null};
 /** Runtime integration must reset provider sessions when this identity changes. */
 contextKey(role:SetupRole):string;
 /** Optional for older consumers; approval-sensitive callers must require it.
  * Rereads settings only, without another asynchronous provider detection. */
 currentContextKey?(role:SetupRole):Promise<string>;
}
function settingsKey(settings:MachineSetup,role:SetupRole,fault=false):string {
 const id=settings.roles[role],p=id===null?null:settings.providers[id],selection=p?.roles[role]??p;
 return createHash('sha256').update(JSON.stringify({role,id,enabled:p?.enabled,executable:p?.executable,
  model:selection?.model,effort:selection?.effort,fault})).digest('hex');
}
const unavailable=(role:SetupRole,provider:SetupProvider|null,code:Unavailable['code'],reason:string):Unavailable=>({available:false,role,provider,code,reason});
function freeze<T>(v:T):T {
 if(v&&typeof v==='object'){for(const item of Object.values(v))freeze(item);Object.freeze(v);}return v;
}
/** Wrap an existing tool-less instance; never constructs a harness or changes flags.
 * Bridges describe already wired legacy Claude paths, not grants to use read tools. */
export function descriptorFromAdapter(adapter:TurnAdapter,options:{detect:()=>Promise<Detection>;invokedBridge?:InvokedBridgeFactory;bridges?:Partial<Record<'invoked'|'thread-reply'|'investigate-read'|'skill-diagram',boolean>>}):ProviderDescriptor {
 if(!SETUP_PROVIDERS.includes(adapter.id as SetupProvider))throw Error('Unknown registry provider');
 const id=adapter.id as SetupProvider;
 const capabilities:Record<SetupRole|'vision',boolean>={'normal-chat':true,council:true,invoked:false,'thread-reply':false,'investigate-read':false,'skill-diagram':false,vision:false};
 if(id==='claude')for(const role of ['invoked','thread-reply','investigate-read','skill-diagram'] as const)capabilities[role]=options.bridges?.[role]===true;
 if(id==='codex')capabilities.invoked=typeof options.invokedBridge==='function';
 return freeze({id,label:adapter.label,safetyLabel:adapter.safetyLabel,capabilities,
  vision:{available:false,reason:'Image input for this role, model and isolated transport is not verified.'},
  detect:options.detect,models:async()=>({source:'default' as const,models:[{id:null,label:'Default'}],reason:'Model catalog is not verified yet; use the CLI default.'}),
  createToollessAdapter:()=>adapter,...(id==='codex'&&options.invokedBridge?{createInvokedProvider:options.invokedBridge}:{})});
}
/** Initial setup suggestion only, never applied over a stored choice. No discovery or fallback. */
export function compatibleDefaults(providers:readonly ProviderDescriptor[]):MachineSetup {
 const setup=defaultMachineSetup();
 for(const id of SETUP_PROVIDERS)setup.providers[id].enabled=providers.some(p=>p.id===id);
 for(const role of SETUP_ROLES){const compatible=providers.filter(p=>p.capabilities[role]);
  setup.roles[role]=compatible.find(p=>p.id==='claude')?.id??compatible[0]?.id??null;
 }
 return setup;
}
export class ProviderRegistry {
 private readonly providers:readonly ProviderDescriptor[];
 constructor(providers:readonly ProviderDescriptor[]){
  if(new Set(providers.map(p=>p.id)).size!==providers.length)throw Error('Duplicate registry provider');
  this.providers=Object.freeze([...providers]);
 }
 /** Synchronous policy resolution, not runtime isolation/availability approval.
  * Actual requests must use snapshot.resolveRole, which also checks detection. */
 resolveRole(role:SetupRole,setup:MachineSetup):RoleResolution {
  const id=setup.roles[role];
  if(id===null)return unavailable(role,null,'role-unavailable','No compatible provider is selected for this role.');
  if(!setup.providers[id].enabled)return unavailable(role,id,'provider-disabled','The selected provider is disabled. Enable it in machine setup; no other provider was tried.');
  const provider=this.providers.find(p=>p.id===id);
  if(!provider)return unavailable(role,id,'provider-unavailable','The selected provider has no registered adapter. Configure its CLI; no other provider was tried.');
  if(!provider.capabilities[role])return unavailable(role,id,'role-unavailable',`${provider.label} is not available for ${role} through a verified bridge. No other provider was tried.`);
  return provider;
 }
 async snapshot(dir:string,initial?:()=>Promise<MachineSetup>):Promise<RequestSettingsSnapshot>{
  const readSettings=async()=>{
   let missing=false;
   if(initial)try{await lstat(path.join(dir,SETUP_FILE));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')missing=true;else throw e;}
   return missing?await initial!():await loadMachineSetup(dir);
  };
  let settings:MachineSetup,fault=false;
  try{
   settings=await readSettings();
  }catch{settings=defaultMachineSetup();fault=true;}
  // Capture before asynchronous metadata checks; later disk edits are a new request.
  const frozen=freeze(structuredClone(settings));
  const states=new Map<SetupProvider,Detection>();
  if(!fault)await Promise.all(this.providers.filter(p=>frozen.providers[p.id].enabled).map(async p=>{
   try{const d=await p.detect();states.set(p.id,d.available===true?{available:true,reason:null}:{available:false,reason:d.reason||'Provider metadata could not be verified.'});}
   catch{states.set(p.id,{available:false,reason:`${p.label} local availability check failed. Check its CLI configuration; no other provider was tried.`});}
  }));
  const resolve=(role:SetupRole,setup=frozen):RoleResolution=>{
   if(fault)return unavailable(role,null,'settings-unavailable','Machine setup could not be read. Fix the saved settings; no provider was selected.');
   const selected=this.resolveRole(role,setup);if('available' in selected)return selected;
   const state=states.get(selected.id);
   return state?.available?selected:unavailable(role,selected.id,'provider-unavailable',state?.reason??'Provider metadata could not be verified.');
  };
  const council=()=>{
   const providers=fault?[]:this.providers.filter(p=>frozen.providers[p.id].enabled&&p.capabilities.council&&states.get(p.id)?.available);
   // Informational Council eligibility only: do not change the shared single-provider
   // approval service used by normal chat, or its grants/budget rules.
   return {available:providers.length>=2,providers:Object.freeze(providers),reason:providers.length>=2?null:fault?'Machine setup could not be read. No providers were selected.':'Council needs at least two enabled, available providers. Normal chat can use one compatible provider.'};
  };
  return Object.freeze({settings:frozen,resolveRole:resolve,resolveParticipant:(id:SetupProvider)=>resolve('council',{...frozen,roles:{...frozen.roles,council:id}}),council,
   contextKey:(role:SetupRole)=>settingsKey(frozen,role,fault),currentContextKey:async(role:SetupRole)=>settingsKey(await readSettings(),role)});
 }
}
