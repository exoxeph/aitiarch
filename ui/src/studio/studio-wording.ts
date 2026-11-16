// Which prompt wording each Pipeline Studio node owns, and which nodes count as "customized". UI only: the keys are paths in the pipeline config, the server validates every value.
// Only wording the config already makes editable is listed (shared/pipeline-config.ts, `prompts`). The fixed rules around it are never editable and are not listed here.
import {DEFAULT_PIPELINE_CONFIG} from '../../shared/pipeline-config.ts';
import {FIELDS} from '../../shared/pipeline-nodes.ts';

/** The most characters one piece of wording may have (the server refuses more, in its own words). */
export const WORDING_CAP=2000;
export type PromptSurface='chat'|'skill-diagram'|'investigate'|'council';
export interface WordingField {key:string;label:string;help?:string}
export interface WordingGroup {title?:string;fields:WordingField[]}
export interface NodeWording {surface:PromptSurface;groups:WordingGroup[];/** Said above the fields when the wording is shared with another node. */note?:string}

const persona=(mode:'plan'|'grill'|'explain',title:string):WordingGroup=>({title,fields:[
 {key:`prompts.personas.${mode}.label`,label:'Name shown in the mode switch'},
 {key:`prompts.personas.${mode}.oneLine`,label:'One-line description'},
 {key:`prompts.personas.${mode}.instruction`,label:'What the mode tells the AI to do'},
]});

export const WORDING:Readonly<Record<string,NodeWording>>=Object.freeze({
 'request-intake':{surface:'chat',groups:[persona('plan','Plan with me'),persona('grill','Grill me'),persona('explain','Explain')]},
 'normal-answerer':{surface:'chat',groups:[{fields:[{key:'prompts.chatLength',label:'Chat style',help:'The length and manner every reply is asked to keep.'}]}]},
 'diagram-route':{surface:'skill-diagram',groups:[{fields:[{key:'prompts.skillDiagramStyle',label:'Diagram wording',help:'How a drawn diagram should look.'}]}]},
 'investigate':{surface:'investigate',groups:[{fields:[{key:'prompts.investigateStyle',label:'Investigate style',help:'How the explanation of the code is written.'}]}]},
 'council':{surface:'council',note:'The Claude limb of the Council uses the same chat style as Normal chat, so this wording is shared with it.',groups:[{fields:[{key:'prompts.chatLength',label:'Council wording (chat style)'}]}]},
});
export const wordingOf=(nodeId:string):NodeWording|undefined=>WORDING[nodeId];
export const wordingFields=(nodeId:string):WordingField[]=>wordingOf(nodeId)?.groups.flatMap(g=>g.fields)??[];
export const wordingKeys=(nodeId:string):string[]=>wordingFields(nodeId).map(f=>f.key);

/** The text at a dotted config path, or undefined when there is none. */
export function textAt(config:unknown,key:string):string|undefined{
 let v:any=config;for(const k of key.split('.')){if(v==null||typeof v!=='object')return undefined;v=v[k];}
 return typeof v==='string'?v:undefined;
}
const hasPath=(tree:unknown,key:string)=>{let v:any=tree;for(const k of key.split('.')){if(v==null||typeof v!=='object'||!Object.hasOwn(v,k))return false;v=v[k];}return true;};

/** The settings of a node that differ from the defaults. The server keeps only values that differ in the saved overrides, so a key being there means it was changed. */
export function customizedKeys(overrides:unknown,node:{id:string;kind:string;fields:readonly string[];answerer?:true}):string[]{
 if(node.kind!=='editable')return [];
 return [...node.fields,...wordingKeys(node.id),...(node.answerer?['normalAnswerer']:[])].filter(k=>hasPath(overrides,k));
}
export const isCustomized=(overrides:unknown,node:Parameters<typeof customizedKeys>[1])=>customizedKeys(overrides,node).length>0;
/** A plain name for a changed setting, for the card. */
export function settingLabel(key:string):string{
 if(key==='normalAnswerer')return 'Who answers Normal chat';
 const f=FIELDS[key];if(f)return f.label;
 for(const w of Object.values(WORDING))for(const g of w.groups)for(const x of g.fields)if(x.key===key)return g.title?`${g.title}: ${x.label}`:x.label;
 return key;
}
export const DEFAULT_TEXT=(key:string)=>textAt(DEFAULT_PIPELINE_CONFIG,key)??'';
