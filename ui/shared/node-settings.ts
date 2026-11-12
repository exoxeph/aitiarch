// Per-node settings: each step that talks to the model (Think, Ask, Visualize, Chat) has a persona mode and the skills attached to it.
// Skills are kept by id (a short hash), never by path. Pure and shared by the server (which saves them) and the UI (which edits them).
import {VISUALIZE_QUESTION} from './diagram.ts';
import {defaultPersona,isPersona,type PersonaMode,type PersonaNode} from './persona.ts';
import {exactKeys} from './threads.ts';

export const NODES:readonly PersonaNode[]=['think','ask','visualize','chat'];
export const MAX_NODE_SKILLS=6;
export interface NodeSetting {persona:PersonaMode;skills:string[]}
export type NodeSettings=Record<PersonaNode,NodeSetting>;
/** What is saved: only the nodes you changed. */
export type SavedNodeSettings=Partial<Record<PersonaNode,NodeSetting>>;

/** What the "What will be sent" review shows about a node's skills. Token numbers are estimates (about four characters each). */
export interface SkillsReview {
 loaded:{name:string;tokens:number;truncated:boolean}[];
 skipped:{name:string;reason:import('./instruction.ts').SkipReason}[];
 /** Attached skill ids that are no longer installed. */
 missing:string[];
}

export const validSkillId=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{12}$/.test(v);

export function validSavedNodes(v:unknown):v is SavedNodeSettings{
 if(!v||typeof v!=='object'||Array.isArray(v))return false;
 return Object.entries(v).every(([node,s])=>(NODES as readonly string[]).includes(node)&&exactKeys(s,['persona','skills'])&&isPersona((s as NodeSetting).persona)
  &&Array.isArray((s as NodeSetting).skills)&&(s as NodeSetting).skills.length<=MAX_NODE_SKILLS&&new Set((s as NodeSetting).skills).size===(s as NodeSetting).skills.length&&(s as NodeSetting).skills.every(validSkillId));
}

export function resolveNodes(saved:SavedNodeSettings|undefined):NodeSettings{
 const out={} as NodeSettings;
 for(const n of NODES){const s=saved?.[n];out[n]=s?{persona:s.persona,skills:[...s.skills]}:{persona:defaultPersona(n),skills:[]};}
 return out;
}

/** Which node a request belongs to: Think; Ask; or Visualize, which is an Ask with the fixed Visualize question. */
export const nodeFor=(action:'think'|'ask',question:string):PersonaNode=>action==='think'?'think':question===VISUALIZE_QUESTION?'visualize':'ask';
