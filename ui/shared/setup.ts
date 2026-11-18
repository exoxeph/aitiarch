// Machine preferences only. No routing, grants, prompts, credentials or active globals.
export const SETUP_PROVIDERS=['claude','codex','kiro'] as const;
export type SetupProvider=typeof SETUP_PROVIDERS[number];
export const SETUP_ROLES=['normal-chat','invoked','thread-reply','council','investigate-read','skill-diagram'] as const;
export type SetupRole=typeof SETUP_ROLES[number];
export interface ModelEffort {model:string|null;effort:string|null}
export interface ProviderSetup extends ModelEffort {
 enabled:boolean;executable:string|null;roles:Partial<Record<SetupRole,ModelEffort>>;
}
export interface MachineSetup {
 version:1;providers:Record<SetupProvider,ProviderSetup>;roles:Record<SetupRole,SetupProvider|null>;
 fontSize:number;tour:{completed:boolean};
 setupSeen?:boolean;
 defaultRoles?:SetupRole[];
}
export type SetupSource = 'explicit flag' | 'saved choice' | 'default';
export interface SetupView {
 ready:boolean;
 seen:boolean;
 providers:{id:SetupProvider;label:string;path:string|null;version:string|null;notices:string[];reason:string;compatible:boolean;source:SetupSource}[];
 roles:{role:SetupRole;provider:SetupProvider|null;capableProviders:SetupProvider[];reason:string|null;source:SetupSource;routingNote?:string}[];
 privacy:{mode:'private';sharedReady:false;notice:string};
}
/** New object per call: editing preferences cannot mutate defaults in another request. */
export function defaultMachineSetup():MachineSetup {
 const provider=(enabled:boolean):ProviderSetup=>({enabled,executable:null,model:null,effort:null,roles:{}});
 return {version:1,providers:{claude:provider(true),codex:provider(false),kiro:provider(false)},
  roles:{'normal-chat':'claude',invoked:'claude','thread-reply':'claude',council:'claude','investigate-read':'claude','skill-diagram':'claude'},
  fontSize:16,tour:{completed:false}};
}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const keys=(v:Record<string,unknown>,allowed:readonly string[])=>Object.keys(v).length===allowed.length&&allowed.every(k=>Object.hasOwn(v,k));
const optionalId=(v:unknown,max:number)=>v===null||typeof v==='string'&&new RegExp('^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,'+(max-1)+'}$').test(v);
// This pure shape check recognises local absolute paths on either OS. The server
// checks existence/native executable format on save, never starts the binary.
const executable=(v:unknown)=>v===null||typeof v==='string'&&v.length<=4096&&/^(?:[a-zA-Z]:[\\/]|\/)/.test(v)&&!/^[/\\]{2}/.test(v)&&!/[\x00-\x1f\x7f]/.test(v);
function modelEffort(v:unknown):v is ModelEffort {
 return object(v)&&keys(v,['model','effort'])&&optionalId(v.model,100)&&optionalId(v.effort,40);
}
/** Exact v1 keys at every level. Catalog/role compatibility is slice 5/6, not a safety grant. */
export function validMachineSetup(v:unknown):v is MachineSetup {
 if(!object(v)||!keys(v,['version','providers','roles','fontSize','tour',...['setupSeen','defaultRoles'].filter(k=>Object.hasOwn(v,k))])||v.version!==1||
  (Object.hasOwn(v,'setupSeen')&&typeof v.setupSeen!=='boolean')||
  (Object.hasOwn(v,'defaultRoles')&&(!Array.isArray(v.defaultRoles)||!v.defaultRoles.every(role=>SETUP_ROLES.includes(role))))||
  !Number.isInteger(v.fontSize)||Number(v.fontSize)<14||Number(v.fontSize)>24||
  !object(v.tour)||!keys(v.tour,['completed'])||typeof v.tour.completed!=='boolean'||
  !object(v.roles)||!keys(v.roles,SETUP_ROLES)||!Object.values(v.roles).every(id=>id===null||SETUP_PROVIDERS.includes(id as SetupProvider))||
  !object(v.providers)||!keys(v.providers,SETUP_PROVIDERS))return false;
 const providers=v.providers;
 return SETUP_PROVIDERS.every(id=>{
  const p=providers[id];
  if(!object(p)||!keys(p,['enabled','executable','model','effort','roles'])||typeof p.enabled!=='boolean'||
   !executable(p.executable)||!optionalId(p.model,100)||!optionalId(p.effort,40)||!object(p.roles))return false;
  if(!Object.entries(p.roles).every(([role,value])=>SETUP_ROLES.includes(role as SetupRole)&&modelEffort(value)))return false;
  // Kiro has no verified selection interface yet: only Default is accepted.
  return id!=='kiro'||p.model===null&&p.effort===null&&Object.values(p.roles).every(r=>(r as ModelEffort).model===null&&(r as ModelEffort).effort===null);
 });
}
