// Machine preferences only. No routing, grants, prompts, credentials or active globals.
export const SETUP_PROVIDERS=['claude','codex','kiro'] as const;
export type SetupProvider=typeof SETUP_PROVIDERS[number];
export const ROLE_REGISTRY=[
 {id:'normal-chat',label:'Normal chat',capability:'normal-chat',multiple:false,modelSettings:true,help:'Answers ordinary chat messages.'},
 {id:'invoked',label:'Think and Ask',capability:'invoked',multiple:false,modelSettings:true,help:'Answers questions about selected text.'},
 {id:'thread-reply',label:'Thread replies',capability:'thread-reply',multiple:false,modelSettings:true,help:'Answers follow-ups in note threads.'},
 {id:'council',label:'Council participants',capability:'council',multiple:true,modelSettings:true,help:'Answers the same question independently.'},
 {id:'investigate-read',label:'Investigate',capability:'investigate-read',multiple:false,modelSettings:false,help:'Reads approved project files.',routingNote:'This feature uses the startup Claude configuration. Role assignment is unavailable here.'},
 {id:'skill-diagram',label:'Skill diagrams',capability:'skill-diagram',multiple:false,modelSettings:false,help:'Creates diagrams using the Skill workflow.',routingNote:'This feature uses the startup Claude configuration. Role assignment is unavailable here.'},
] as const;
export type RoleDefinition=typeof ROLE_REGISTRY[number];
export type SetupRole=RoleDefinition['id'];
export const SETUP_ROLES=ROLE_REGISTRY.map(role=>role.id);
export const roleDefinition=(id:SetupRole)=>ROLE_REGISTRY.find(role=>role.id===id)!;
export const MODEL_ROLES=ROLE_REGISTRY.flatMap(role=>role.modelSettings?[role.id]:[]);
export type ModelRole=Extract<RoleDefinition,{modelSettings:true}>['id'];
export const LAUNCH_ROLE_LOCK='Set by launch flag; remove the flag to edit here.';
export interface ModelEffort {model:string|null;effort:string|null}
export interface ProviderSetup extends ModelEffort {
 enabled:boolean;executable:string|null;roles:Partial<Record<SetupRole,ModelEffort>>;
}
export interface MachineSetup {
 version:1;providers:Record<SetupProvider,ProviderSetup>;roles:Record<SetupRole,SetupProvider|null>;
 fontSize:number;tour:{completed:boolean};
 setupSeen?:boolean;
 defaultRoles?:SetupRole[];
 councilParticipants?:SetupProvider[];
 fontSizeConfigured?:boolean;
}
export interface RoleModelPreference {
 role:ModelRole;
 provider:SetupProvider;
 effortSupported:boolean;
 selection:ModelEffort|null;
 effective:ModelEffort;
}
export type SetupUpdate = {seen:true}|{role:SetupRole;provider:SetupProvider}|
 {role:ModelRole;provider:SetupProvider;selection:ModelEffort|null}|{fontSize:number}|
 {role:SetupRole;reset:true}|{role:'council';participants:SetupProvider[]};
export type SetupSource = 'explicit flag' | 'discovered' | 'saved choice' | 'default';
export interface SetupView {
 ready:boolean;
 seen:boolean;
 fontSize:number|null;
 models:RoleModelPreference[];
 providers:{id:SetupProvider;label:string;path:string|null;version:string|null;notices:string[];reason:string;compatible:boolean;source:SetupSource}[];
 roles:{role:SetupRole;provider:SetupProvider|null;capableProviders:SetupProvider[];reason:string|null;source:SetupSource;routingNote?:string;locked?:string;participants?:SetupProvider[];eligibleParticipants?:SetupProvider[]}[];
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
export function validCouncilParticipants(value:unknown):value is SetupProvider[]{
 return Array.isArray(value)&&value.length<=SETUP_PROVIDERS.length&&new Set(value).size===value.length&&value.every(id=>SETUP_PROVIDERS.includes(id));
}
// This pure shape check recognises local absolute paths on either OS. The server
// checks existence/native executable format on save, never starts the binary.
const executable=(v:unknown)=>v===null||typeof v==='string'&&v.length<=4096&&/^(?:[a-zA-Z]:[\\/]|\/)/.test(v)&&!/^[/\\]{2}/.test(v)&&!/[\x00-\x1f\x7f]/.test(v);
function modelEffort(v:unknown):v is ModelEffort {
 return object(v)&&keys(v,['model','effort'])&&optionalId(v.model,100)&&optionalId(v.effort,40);
}
/** Exact v1 keys at every level. Catalog/role compatibility is slice 5/6, not a safety grant. */
export function validMachineSetup(v:unknown):v is MachineSetup {
 if(!object(v)||!keys(v,['version','providers','roles','fontSize','tour',...['setupSeen','defaultRoles','fontSizeConfigured','councilParticipants'].filter(k=>Object.hasOwn(v,k))])||v.version!==1||
  (Object.hasOwn(v,'councilParticipants')&&!validCouncilParticipants(v.councilParticipants))||
  (Object.hasOwn(v,'fontSizeConfigured')&&typeof v.fontSizeConfigured!=='boolean')||
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
