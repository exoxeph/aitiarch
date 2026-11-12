// The rules behind the Skills tab, as plain functions: what a card says, how a skill is attached to a step, and the short
// "recently used" list kept in this browser. No network, no disk, nothing that runs a skill.
import {MAX_NODE_SKILLS,NODES,validSkillId,type NodeSettings,type SavedNodeSettings} from '../../shared/node-settings.ts';
import type {PersonaMode,PersonaNode} from '../../shared/persona.ts';
import type {PublicSkill} from '../../server/skill-library.ts';

export const NODE_LABEL:Record<PersonaNode,string>={think:'Think',ask:'Ask',visualize:'Visualize',chat:'Chat'};
const ENGINE_LABEL:Record<string,string>={claude:'Claude',codex:'Codex','chatgpt-plan':'ChatGPT plan'};
const names=(list:readonly string[])=>list.map(e=>ENGINE_LABEL[e]??e).join(', ');

export const badgeFor=(s:Pick<PublicSkill,'scripts'>)=>s.scripts?'Can run scripts (agent mode)':'Instructions only';
/** Agent mode is only worth naming when the skill ships scripts; otherwise it is instruction mode alone. */
export const engineLines=(s:Pick<PublicSkill,'scripts'|'engines'>)=>[`Instruction mode: ${names(s.engines.instruction)}`,...(s.scripts?[`Agent mode: ${names(s.engines.agent)}`]:[])];

export interface ToggleResult {nodes:NodeSettings;error?:string}
export function toggleSkill(nodes:NodeSettings,node:PersonaNode,skillId:string):ToggleResult{
 const has=nodes[node].skills.includes(skillId);
 if(!has&&nodes[node].skills.length>=MAX_NODE_SKILLS)return {nodes,error:`A step can use up to ${MAX_NODE_SKILLS} skills. Remove one first.`};
 const skills=has?nodes[node].skills.filter(x=>x!==skillId):[...nodes[node].skills,skillId];
 return {nodes:{...nodes,[node]:{...nodes[node],skills}}};
}
export const setPersona=(nodes:NodeSettings,node:PersonaNode,persona:PersonaMode):NodeSettings=>({...nodes,[node]:{...nodes[node],persona}});
export const toSaved=(nodes:NodeSettings):SavedNodeSettings=>Object.fromEntries(NODES.map(n=>[n,{persona:nodes[n].persona,skills:[...nodes[n].skills]}]));

export const MAX_RECENT=8;
const KEY='aitiarch.recent-skills';
type Store=Pick<Storage,'getItem'|'setItem'>;
export const rememberRecent=(list:readonly string[],skillId:string)=>[skillId,...list.filter(x=>x!==skillId)].slice(0,MAX_RECENT);
/** Skill ids only (never paths or text). Storage can be missing or blocked: then there is simply no history. */
export function readRecents(store:Store|undefined=typeof localStorage==='undefined'?undefined:localStorage):string[]{
 try{const v=JSON.parse(store?.getItem(KEY)??'[]');return Array.isArray(v)?v.filter(validSkillId).slice(0,MAX_RECENT):[];}catch{return [];}
}
export function writeRecents(list:readonly string[],store:Store|undefined=typeof localStorage==='undefined'?undefined:localStorage){
 try{store?.setItem(KEY,JSON.stringify(list.slice(0,MAX_RECENT)));}catch{/* history is a convenience */}
}
