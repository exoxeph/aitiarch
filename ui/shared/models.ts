import type {MachineSetup,ModelEffort,SetupProvider,SetupRole} from './setup.ts';

export interface CatalogModel {id:string;name:string;default:boolean;efforts:string[]}
export interface ModelCatalog {source:'cli'|'fallback';models:CatalogModel[];checkedAt:number|null;notice?:string;loading?:true}
export const CATALOG_MAX_AGE_MS=15*60*1000;
export const DISCONTINUED_MODEL_NOTICE='This model is no longer listed. New sends use the CLI default until you choose again.';
export const DISCONTINUED_EFFORT_NOTICE='This effort is no longer listed for the model. New sends use the CLI default effort.';
export const UNVERIFIED_EFFORT_NOTICE='New sends use the CLI default effort until the model list can be checked.';
export const validEffortId=(v:unknown):v is string=>typeof v==='string'&&/^[a-z][a-z0-9_-]{0,39}$/.test(v);
export const validCatalogModelId=(v:unknown):v is string=>typeof v==='string'&&v.length<=100&&/^[A-Za-z0-9][A-Za-z0-9_.-]*(?:\[1m\])?$/.test(v);
export const catalogMissing=(id:string,catalog?:ModelCatalog)=>catalog?.source==='cli'&&!catalog.models.some(m=>m.id===id);
export const catalogEntry=(catalog:ModelCatalog|undefined,model:string|null)=>
 catalog?.models.find(entry=>model===null?entry.default:entry.id===model);

export const catalogSupportsEffort=(catalog:ModelCatalog|undefined,model:string|null,effort:string)=>
 catalog?.source==='cli'&&validEffortId(effort)&&catalogEntry(catalog,model)?.efforts.includes(effort)===true;

/** Only a model selected from a catalog can be retired. Custom IDs stay usable. */
export function effectiveCatalogSelection(provider:SetupProvider,requested:Readonly<ModelEffort>,listed:boolean,catalog?:ModelCatalog){
 if (listed&&requested.model!==null&&catalogMissing(requested.model,catalog))
  return {effective:{model:null,effort:null},modelNotice:DISCONTINUED_MODEL_NOTICE};
 if (requested.effort!==null&&(catalog?.source==='cli'||provider==='codex')&&
    !catalogSupportsEffort(catalog,requested.model,requested.effort))
  return {effective:{model:requested.model,effort:null},modelNotice:catalog?.source==='cli'?DISCONTINUED_EFFORT_NOTICE:UNVERIFIED_EFFORT_NOTICE};
 return {effective:requested,modelNotice:undefined};
}

/** Build the effective request settings without changing machine preferences. */
export function applyCatalogAvailability(setup:MachineSetup,catalogFor:(provider:SetupProvider)=>ModelCatalog|undefined):MachineSetup{
 const effective=structuredClone(setup);
 for(const provider of Object.keys(setup.providers) as SetupProvider[]){
  const catalog=catalogFor(provider);
  const prefs=setup.providers[provider];
  for(const role of Object.keys(setup.roles) as SetupRole[]){
   const saved=prefs.roles[role]??prefs;
   const selection={model:saved.model,effort:saved.effort};
   const listed=prefs.catalogChoices?.[role]===selection.model;
   const resolved=effectiveCatalogSelection(provider,selection,listed,catalog).effective;
   if(resolved!==selection)effective.providers[provider].roles[role]=resolved;
  }
 }
 return effective;
}
