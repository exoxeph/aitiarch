import type {MachineSetup,SetupProvider,SetupRole} from './setup.ts';

export interface CatalogModel {id:string;name:string;default:boolean;efforts:string[]}
export interface ModelCatalog {source:'cli'|'fallback';models:CatalogModel[];checkedAt:number|null;notice?:string}
export const CATALOG_MAX_AGE_MS=15*60*1000;
export const DISCONTINUED_MODEL_NOTICE='This model is no longer listed. New sends use the CLI default until you choose again.';
export const validEffortId=(v:unknown):v is string=>typeof v==='string'&&/^[a-z][a-z0-9_-]{0,39}$/.test(v);
export const validCatalogModelId=(v:unknown):v is string=>typeof v==='string'&&v.length<=100&&/^[A-Za-z0-9][A-Za-z0-9_.-]*(?:\[1m\])?$/.test(v);
export const catalogMissing=(id:string,catalog?:ModelCatalog)=>catalog?.source==='cli'&&!catalog.models.some(m=>m.id===id);
export const catalogEntry=(catalog:ModelCatalog|undefined,model:string|null)=>
 catalog?.models.find(entry=>model===null?entry.default:entry.id===model);

export function discontinuedModel(setup:MachineSetup,provider:SetupProvider,role:SetupRole,catalog?:ModelCatalog):boolean{
 const settings=setup.providers[provider],saved=settings.catalogChoices?.[role];
 return !!saved&&settings.roles[role]?.model===saved&&catalogMissing(saved,catalog);
}

/** Build the effective request settings without changing machine preferences. */
export function applyCatalogAvailability(setup:MachineSetup,catalogFor:(provider:SetupProvider)=>ModelCatalog|undefined):MachineSetup{
 const effective=structuredClone(setup);
 for(const provider of Object.keys(setup.providers) as SetupProvider[]){
  const catalog=catalogFor(provider);
  if(catalog?.source!=='cli')continue;
  const prefs=setup.providers[provider];
  for(const role of Object.keys(setup.roles) as SetupRole[]){
   const saved=prefs.roles[role]??prefs;
   if(discontinuedModel(setup,provider,role,catalog))effective.providers[provider].roles[role]={model:null,effort:null};
   else if(saved.effort!==null&&!catalogEntry(catalog,saved.model)?.efforts.includes(saved.effort))
    effective.providers[provider].roles[role]={model:saved.model,effort:null};
  }
 }
 return effective;
}
