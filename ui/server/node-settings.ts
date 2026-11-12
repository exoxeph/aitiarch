// Turns each node's saved settings (persona + attached skill ids, in ui-state.json) into what a request carries.
// Skill text comes only through loadSkillBlock, and only for skills attached to that node.
import type {SkillBlock} from '../shared/instruction.ts';
import {resolveNodes,validSavedNodes,type NodeSettings,type SavedNodeSettings,type SkillsReview} from '../shared/node-settings.ts';
import type {PersonaMode,PersonaNode} from '../shared/persona.ts';
import {validSkillRefs} from '../shared/threads.ts';
import {loadSkillBlock} from './skill-instructions.ts';
import type {SkillInfo} from './skills.ts';
import type {UiStateStore} from './ui-state-store.ts';

export interface NodeExtras {
 persona:PersonaMode;
 /** Loaded skill text and what was loaded or skipped. */
 skills:SkillBlock;
 /** Plain, distinct names of the skills that were loaded: what gets recorded on the answer. */
 names:string[];
 /** Attached skill ids that are no longer installed. */
 missing:string[];
 /** For the review. Null when the node has no skills attached. */
 review:SkillsReview|null;
}
export type ExtrasFor=(node:PersonaNode)=>Promise<NodeExtras>;

export class NodeSettingsService {
 private ui:Pick<UiStateStore,'nodes'|'saveNodes'>;private discover:()=>Promise<SkillInfo[]>;
 constructor(ui:Pick<UiStateStore,'nodes'|'saveNodes'>,discover:()=>Promise<SkillInfo[]>){this.ui=ui;this.discover=discover;}
 async get():Promise<NodeSettings>{return resolveNodes(await this.ui.nodes());}
 async save(value:unknown):Promise<{persisted:boolean}>{
  if(!validSavedNodes(value))throw new Error('Invalid node settings.');
  return this.ui.saveNodes(value as SavedNodeSettings);
 }
 async extras(node:PersonaNode):Promise<NodeExtras>{
  const setting=(await this.get())[node],chosen:SkillInfo[]=[],missing:string[]=[];
  if(setting.skills.length){
   const byId=new Map((await this.discover()).map(s=>[s.id,s]));
   for(const id of setting.skills){const s=byId.get(id);if(s)chosen.push(s);else missing.push(id);}
  }
  const skills=await loadSkillBlock(chosen);
  const names=[...new Set(skills.loaded.map(l=>l.name))].filter(n=>validSkillRefs([n]));
  const review:SkillsReview|null=setting.skills.length?{loaded:skills.loaded.map(l=>({name:l.name,tokens:l.tokens,truncated:l.truncated})),
   skipped:skills.skipped.map(name=>({name,reason:skills.reasons?.[name]??'unreadable'})),missing}:null;
  return {persona:setting.persona,skills,names,missing,review};
 }
}
