import type {MachineSetup,ModelEffort,SetupProvider,SetupRole} from './setup.ts';
import {validCatalogModelId} from './models.ts';
export const CLAUDE_MODELS=Object.freeze(['opus','sonnet','haiku','fable'] as const);
export const CLAUDE_EFFORTS=Object.freeze(['low','medium','high','xhigh','max'] as const);
export const DEFAULT_SELECTION:Readonly<ModelEffort>=Object.freeze({model:null,effort:null});
/** IDs are data, never a shell fragment, path, positional prompt or CLI option. */
export const validModelId=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(v);
/** Capture only the effective per-role selection; explicit null means CLI Default. */
export function modelSelection(setup:MachineSetup,role:SetupRole,id:SetupProvider=setup.roles[role]!):Readonly<ModelEffort>{
 if(!id||!setup.providers[id])throw Error('No provider selected for model settings.');
 const p=setup.providers[id],selection=p.roles[role]??p;
 return Object.freeze({model:selection.model,effort:selection.effort});
}
/** Static, deliberately conservative choices until the catalog is verified.
 * Codex 0.167.0 exec --help documents --model and generic -c only; it does not
 * name an effort override. Do not guess a configuration key or infer support. */
export function modelArguments(id:SetupProvider,selection:Readonly<ModelEffort>=DEFAULT_SELECTION,effortSupported=false):string[]{
 if(!selection||Object.keys(selection).sort().join()!=='effort,model')throw Error('Invalid model selection.');
 const {model,effort}=selection;
 if(model!==null&&!validModelId(model)&&!(id==='claude'&&validCatalogModelId(model)))throw Error('Invalid model ID: use 1-100 letters, digits, dots, underscores or hyphens, starting with a letter or digit.');
 if(id==='kiro'&&(model!==null||effort!==null))throw Error('Kiro model and effort must stay at Default.');
 if(effort!==null){
  if(id!=='claude')throw Error('Codex effort is not verified; use Default.');
  if(typeof effort!=='string'||!(CLAUDE_EFFORTS as readonly string[]).includes(effort))throw Error('Invalid Claude effort. Choose Default, low, medium, high, xhigh or max.');
  if(effortSupported!==true)throw Error('Claude effort flag is not verified in CLI help; use Default.');
 }
 return [...(model===null?[]:['--model',model]),...(effort===null?[]:['--effort',effort])];
}
/** Only CLI help declarations count; prose mentions must never enable a flag. */
export const helpDeclaresEffort=(help:string)=>help.split(/\r?\n/).some(line=>/^\s*(?:-[A-Za-z],\s*)?--effort(?=[\s=,]|$)/.test(line));
export const reportedModelLabel=(model:unknown)=>typeof model==='string'&&model.trim()?model:'model not reported';
/** Requested settings are labels, never a claim about the resolved model. */
export const selectionLabel=(selection?:Readonly<ModelEffort>)=>`Requested model: ${selection?.model??'Default'} · effort: ${selection?.effort??'Default'}`;
