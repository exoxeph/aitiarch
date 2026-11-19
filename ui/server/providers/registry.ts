// Policy and request snapshots only. Existing adapters retain all runtime guards.
// No spawn, read-tool harness constructor, prompt assembly or active global settings.
import {createHash} from 'node:crypto';
import {defaultMachineSetup,SETUP_PROVIDERS,ROLE_REGISTRY,roleDefinition,type MachineSetup,type SetupRole,type SetupProvider} from '../../shared/setup.ts';
import {loadMachineSetup} from '../setup-store.ts';
import {SETUP_FILE} from '../setup-store.ts';
import {lstat} from 'node:fs/promises';
import path from 'node:path';
import type {TurnAdapter,SafetyLabel} from './turn.ts';
import type {createInvokedCodexBridge} from './invoked-bridge.ts';
import type {Provider} from './index.ts';
import {modelSelection} from '../../shared/model-settings.ts';
import {applyCatalogAvailability,effectiveCatalogSelection,type ModelCatalog} from '../../shared/models.ts';
import type {ModelEffort} from '../../shared/setup.ts';
import {versionCheck,versionParts,type CliNotice} from './cli-compatibility.ts';
export type InvokedBridgeFactory=(options:Pick<Parameters<typeof createInvokedCodexBridge>[0],'cap'|'onTurn'|'beforeTurn'|'selection'>)=>Provider;

export interface Detection {available:boolean;reason:string|null;version?:string;notices?:CliNotice[]}
export interface ProviderDescriptor {
 readonly selection?:Readonly<ModelEffort>;
 readonly id:SetupProvider;readonly label:string;readonly safetyLabel:SafetyLabel;
 readonly capabilities:Readonly<Record<SetupRole|'vision',boolean>>;
 readonly vision:Readonly<{available:boolean;reason:string}>;
 readonly detect:()=>Promise<Detection>;
 readonly models:()=>Promise<{source:'default';models:readonly {id:null;label:string}[];reason:string}>;
 readonly createToollessAdapter:()=>TurnAdapter;
 readonly createInvokedProvider?:InvokedBridgeFactory;
 readonly createThreadProvider?:InvokedBridgeFactory;
 readonly createSkillDiagramProvider?:InvokedBridgeFactory;
}
export interface Unavailable {
 available:false;provider:SetupProvider|null;role:SetupRole;
 code:'provider-disabled'|'provider-unavailable'|'role-unavailable'|'settings-unavailable';reason:string;
}
export type RoleResolution=ProviderDescriptor|Unavailable;
export const WIRED_ROLE_BRIDGES=Object.freeze({invoked:true,'thread-reply':true,'investigate-read':true,'skill-diagram':true});
/** Shared transport policy; metadata compatibility alone does not supply a bridge. */
export function providerCapabilities(id:SetupProvider,bridges:Partial<Record<'invoked'|'thread-reply'|'investigate-read'|'skill-diagram',boolean>>={}):Record<SetupRole|'vision',boolean> {
 const capabilities:Record<SetupRole|'vision',boolean>={'normal-chat':true,council:true,invoked:false,'thread-reply':false,'investigate-read':false,'skill-diagram':false,vision:false};
 if(id==='claude')for(const role of ['invoked','thread-reply','investigate-read','skill-diagram'] as const)capabilities[role]=bridges[role]===true;
 if(id==='codex'){capabilities.invoked=bridges.invoked===true;capabilities['thread-reply']=bridges['thread-reply']===true;capabilities['skill-diagram']=bridges['skill-diagram']===true;}
 return capabilities;
}
export function roleRestriction(provider:SetupProvider,capability:SetupRole):string|null {
 return provider==='codex'&&capability==='investigate-read'
  ?"Codex CLI help does not establish snapshot-only reads or a pre-turn budget ceiling equivalent to Claude's Investigate cap."
  :null;
}

export function investigateAssignmentNotice(setup:MachineSetup):string|null {
 if(!setup.replacedCodexInvestigate)return null;
 return setup.roles['investigate-read']==='claude'
  ?'The saved Codex Investigate choice was replaced with the Claude default.'
  :'The saved Codex Investigate choice was cleared. No compatible provider was available at setup.';
}

export interface RequestSettingsSnapshot {
 readonly skillModelNotice?:string;
 readonly investigateModelNotice?:string;
 readonly settings:MachineSetup;
 readonly providerVersions?:Readonly<Partial<Record<SetupProvider,string>>>;
 readonly codexChatImageInput?:boolean;
 codexRoleImageInput?(role:SetupRole):boolean|undefined;
 resolveRole(role:SetupRole):RoleResolution;
 resolveParticipant(id:SetupProvider):RoleResolution;
 council():{available:boolean;providers:readonly ProviderDescriptor[];reason:string|null};
 /** Runtime integration must reset provider sessions when this identity changes. */
 contextKey(role:SetupRole):string;
 /** Optional for older consumers; approval-sensitive callers must require it.
  * Rereads settings only, without another asynchronous provider detection. */
 currentContextKey?(role:SetupRole):Promise<string>;
 /** Approval identity for every role override of one Council participant. */
 providerKey?(id:SetupProvider):string;
 currentProviderKey?(id:SetupProvider):Promise<string>;
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
export function descriptorFromAdapter(adapter:TurnAdapter,options:{detect:()=>Promise<Detection>;invokedBridge?:InvokedBridgeFactory;threadReplyBridge?:InvokedBridgeFactory;skillDiagramBridge?:InvokedBridgeFactory;bridges?:Partial<Record<'invoked'|'thread-reply'|'investigate-read'|'skill-diagram',boolean>>}):ProviderDescriptor {
 if(!SETUP_PROVIDERS.includes(adapter.id as SetupProvider))throw Error('Unknown registry provider');
 const id=adapter.id as SetupProvider;
 const capabilities=providerCapabilities(id,id==='codex'?{invoked:typeof options.invokedBridge==='function','thread-reply':typeof options.threadReplyBridge==='function','skill-diagram':typeof options.skillDiagramBridge==='function'}:options.bridges);
 return freeze({id,label:adapter.label,safetyLabel:adapter.safetyLabel,capabilities,
  vision:{available:false,reason:'Image input for this role, model and isolated transport is not verified.'},
  detect:options.detect,models:async()=>({source:'default' as const,models:[{id:null,label:'Default'}],reason:'Model catalog is not verified yet; use the CLI default.'}),
  createToollessAdapter:()=>adapter,...(id==='codex'&&options.invokedBridge?{createInvokedProvider:options.invokedBridge}:{}),...(id==='codex'&&options.threadReplyBridge?{createThreadProvider:options.threadReplyBridge}:{}),...(id==='codex'&&options.skillDiagramBridge?{createSkillDiagramProvider:options.skillDiagramBridge}:{})});
}
/** Initial setup suggestion only, never applied over a stored choice. No discovery or fallback. */
export function compatibleDefaults(providers:readonly ProviderDescriptor[]):MachineSetup {
 const setup=defaultMachineSetup();
 for(const id of SETUP_PROVIDERS)setup.providers[id].enabled=providers.some(p=>p.id===id);
 for(const {id,capability} of ROLE_REGISTRY){const compatible=providers.filter(p=>p.capabilities[capability]);
  setup.roles[id]=compatible.find(p=>p.id==='claude')?.id??compatible[0]?.id??null;
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
  const restriction=roleRestriction(id,roleDefinition(role).capability);
  if(restriction)return unavailable(role,id,'role-unavailable',restriction);
  if(!setup.providers[id].enabled)return unavailable(role,id,'provider-disabled','The selected provider is disabled. Enable it in machine setup; no other provider was tried.');
  const provider=this.providers.find(p=>p.id===id);
  if(!provider)return unavailable(role,id,'provider-unavailable','The selected provider has no registered adapter. Configure its CLI; no other provider was tried.');
  if(!provider.capabilities[roleDefinition(role).capability])return unavailable(role,id,'role-unavailable',`${provider.label} is not available for ${role} through a verified bridge. No other provider was tried.`);
  return provider;
 }
 async snapshot(dir:string,initial?:()=>Promise<MachineSetup>,catalogFor?:(provider:SetupProvider)=>ModelCatalog|undefined):Promise<RequestSettingsSnapshot>{
  const readSavedSettings=async()=>{
   let missing=false;
   if(initial)try{await lstat(path.join(dir,SETUP_FILE));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')missing=true;else throw e;}
   return missing?await initial!():await loadMachineSetup(dir);
  };
  const applyCatalog=(setup:MachineSetup)=>catalogFor?applyCatalogAvailability(setup,catalogFor):setup;
  const readSettings=async()=>applyCatalog(await readSavedSettings());
  let settings:MachineSetup,fault=false,skillModelNotice:string|undefined,investigateModelNotice:string|undefined,investigateRequestedKey:string|undefined;
  try{
   const saved=await readSavedSettings();
   investigateRequestedKey=settingsKey(saved,'investigate-read');
   const modelNotice=(role:'skill-diagram'|'investigate-read')=>{
    const id=saved.roles[role];
    if(!id||!catalogFor)return;
    const requested=modelSelection(saved,role,id);
    return effectiveCatalogSelection(id,requested,saved.providers[id].catalogChoices?.[role]===requested.model,catalogFor(id)).modelNotice;
   };
   skillModelNotice=modelNotice('skill-diagram');
   investigateModelNotice=modelNotice('investigate-read');
   settings=applyCatalog(saved);
  }catch{settings=defaultMachineSetup();fault=true;}
  // Capture before asynchronous metadata checks; later disk edits are a new request.
  const frozen=freeze(structuredClone(settings));
  const states=new Map<SetupProvider,Detection>();
  if(!fault)await Promise.all(this.providers.filter(p=>frozen.providers[p.id].enabled).map(async p=>{
   try{const d=await p.detect();states.set(p.id,d.available===true?{...d,available:true,reason:d.reason??null}:{...d,available:false,reason:d.reason||'Provider metadata could not be verified.'});}
   catch{states.set(p.id,{available:false,reason:`${p.label} local availability check failed. Check its CLI configuration; no other provider was tried.`});}
  }));
  const providerVersions=freeze(Object.fromEntries([...states].filter(([,d])=>typeof d.version==='string'&&versionParts(d.version)).map(([id,d])=>[id,d.version])) as Partial<Record<SetupProvider,string>>);
  const versionKey=(key:string,id:SetupProvider|null)=>id&&providerVersions[id]?createHash('sha256').update(JSON.stringify({key,version:providerVersions[id]})).digest('hex'):key;
  const contextKey=(setup:MachineSetup,role:SetupRole,requested?:string,invalid=false)=>{
   const effective=settingsKey(setup,role,invalid);
   const key=role==='investigate-read'&&requested!==undefined?createHash('sha256').update(effective+requested).digest('hex'):effective;
   return versionKey(key,setup.roles[role]);
  };
  const resolve=(role:SetupRole,setup=frozen):RoleResolution=>{
   if(fault)return unavailable(role,null,'settings-unavailable','Machine setup could not be read. Fix the saved settings; no provider was selected.');
   const selected=this.resolveRole(role,setup);if('available' in selected)return selected;
   const state=states.get(selected.id);
   if(!state?.available)return unavailable(role,selected.id,'provider-unavailable',state?.reason??'Provider metadata could not be verified.');
   if(role==='skill-diagram'&&selected.id==='codex'){
    const gate=versionCheck('codex',state.version??null);
    if(!gate.available)return unavailable(role,selected.id,'provider-unavailable',gate.reason!);
   }
   const selection=modelSelection(setup,role,selected.id);
   // Keep the legacy Default descriptor and exact transport input unchanged.
   if(selection.model===null&&selection.effort===null)return selected;
   const bind=(factory:InvokedBridgeFactory):InvokedBridgeFactory=>options=>factory({...options,selection});
   return Object.freeze({...selected,selection,createToollessAdapter:()=>{
    const adapter=selected.createToollessAdapter(),{startImageTurn}=adapter;
    return {...adapter,startTurn:(input:Parameters<TurnAdapter['startTurn']>[0],signal:AbortSignal)=>adapter.startTurn({...input,selection},signal),
     ...(startImageTurn?{startImageTurn:(...[input,signal,images]:Parameters<NonNullable<TurnAdapter['startImageTurn']>>)=>startImageTurn.call(adapter,{...input,selection},signal,images)}:{})};
   },...(selected.createInvokedProvider?{createInvokedProvider:bind(selected.createInvokedProvider)}:{}),...(selected.createThreadProvider?{createThreadProvider:bind(selected.createThreadProvider)}:{}),...(selected.createSkillDiagramProvider?{createSkillDiagramProvider:bind(selected.createSkillDiagramProvider)}:{})});
  };
  const council=()=>{
   const providers=fault?[]:this.providers.filter(p=>frozen.providers[p.id].enabled&&p.capabilities.council&&states.get(p.id)?.available&&(!frozen.councilParticipants||frozen.councilParticipants.includes(p.id)));
   // Informational Council eligibility only: do not change the shared single-provider
   // approval service used by normal chat, or its grants/budget rules.
   return {available:providers.length>=2,providers:Object.freeze(providers),reason:providers.length>=2?null:fault?'Machine setup could not be read. No providers were selected.':'Council needs at least two enabled, available providers. Normal chat can use one compatible provider.'};
  };
  const providerKey=(settings:MachineSetup,id:SetupProvider)=>versionKey(createHash('sha256').update(JSON.stringify(
   settings.councilParticipants===undefined?settings.providers[id]:{provider:settings.providers[id],participants:settings.councilParticipants})).digest('hex'),id);
  const codexCatalog=catalogFor?.('codex');
  const codexImageInputs=new Map(codexCatalog?.source==='cli'?codexCatalog.models.map(entry=>[entry.id,entry.imageInput]):[]);
  const codexRoleImageInput=(role:SetupRole)=>frozen.roles[role]==='codex'?
   codexImageInputs.get(modelSelection(frozen,role,'codex').model??''):undefined;
  return Object.freeze({settings:frozen,providerVersions,codexChatImageInput:codexRoleImageInput('normal-chat'),codexRoleImageInput,skillModelNotice,investigateModelNotice,resolveRole:resolve,resolveParticipant:(id:SetupProvider)=>frozen.councilParticipants&&!frozen.councilParticipants.includes(id)
   ? unavailable('council',id,'role-unavailable','This provider is not selected in AI settings → Setup → Council participants.')
   : resolve('council',{...frozen,roles:{...frozen.roles,council:id}}),council,
   contextKey:(role:SetupRole)=>contextKey(frozen,role,investigateRequestedKey,fault),
   currentContextKey:async(role:SetupRole)=>{
    const saved=await readSavedSettings();
    return contextKey(applyCatalog(saved),role,role==='investigate-read'?settingsKey(saved,role):undefined);
   },
   providerKey:(id:SetupProvider)=>providerKey(frozen,id),
   currentProviderKey:async(id:SetupProvider)=>providerKey(await readSettings(),id)});
 }
}
