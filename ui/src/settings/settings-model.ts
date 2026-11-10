// Settings logic for the AI settings screens. Pure; the server stays the authority and these only keep the screen honest.
import type {InvestigatorSettings,Permission} from '../../shared/investigator.ts';
import {formatCount} from '../chat/chat-model.ts';

export interface SettingField {key:keyof InvestigatorSettings;label:string;hint:string;max:number;/** What one unit means on screen; the time limit is typed in seconds. */unit:string;scale:number}
/** The ceilings the server enforces (shared/investigator.ts validateSettings); a test keeps these identical. */
export const SETTING_FIELDS:readonly SettingField[]=[
 {key:'concurrency',label:'Agents at once',hint:'How many sub-agents may run side by side.',max:6,unit:'',scale:1},
 {key:'depth',label:'Nesting depth',hint:'Agents cannot start agents; this stays at 1.',max:1,unit:'',scale:1},
 {key:'turns',label:'Turns per agent',hint:'How many back-and-forth turns one agent may take.',max:12,unit:'',scale:1},
 {key:'timeoutMs',label:'Time limit per agent',hint:'An agent that takes longer is stopped.',max:180000,unit:'seconds',scale:1000},
 {key:'delegations',label:'Delegations per answer',hint:'The most jobs one answer may hand out.',max:20,unit:'',scale:1},
 {key:'tokens',label:'Token cap per answer',hint:'An answer stops when it would pass this.',max:1000000,unit:'tokens',scale:1},
];
/** Parses what was typed (in the field's own unit) into the stored value, or null when it is not a whole number inside the limits. */
export function parseSettingInput(key:keyof InvestigatorSettings,text:string):number|null{
 const field=SETTING_FIELDS.find(f=>f.key===key);if(!field||!/^\d{1,9}$/.test(text.trim()))return null;
 const value=Number(text.trim())*field.scale;
 return Number.isSafeInteger(value)&&value>=field.scale&&value<=field.max?value:null;
}
/** Shown value of a stored setting, in the field's own unit. */
export const displaySetting=(field:SettingField,value:number)=>String(Math.round(value/field.scale));

export interface DenyExample {label:string;example:string}
/** Always refused by the app whatever the permissions say. The server owns the real rule; a test checks each example against it. */
export const DENY_EXAMPLES:readonly DenyExample[]=[
 {label:'Environment files',example:'.env'},
 {label:'Certificates and keys',example:'server.pem'},
 {label:'SSH keys',example:'id_ed25519'},
 {label:'Anything named credentials or secrets',example:'config/credentials.json'},
 {label:'Files marked private',example:'notes.private.md'},
 {label:'This app’s own saved state',example:'ui-state.json'},
 {label:'Dependencies',example:'node_modules/pkg/index.js'},
 {label:'Git internals',example:'.git/config'},
 {label:'AI tool sessions and transcripts',example:'.claude/session.json'},
 {label:'Saved chats, runs, measurements and backups',example:'chat/note.json'},
];

export function rootProblem(text:string):string|null{
 const t=text.trim();
 return /^(?:[A-Za-z]:[\\/]|\/|\\\\)/.test(t)?null:'Enter an absolute folder path, such as C:\\Users\\you\\project.';
}
export function tierSummary(p:Permission):string{
 return p==='ask'?'Ask me each time.':p==='chat'?'Allowed for this chat only, until it ends.':'Always allowed in this notebook.';
}
export interface Meter {percent:number;label:string;tone:'ok'|'warn'|'full'}
export function tokenMeter(u:{spent:number;tokenBudget:number}):Meter{
 const ratio=u.tokenBudget>0?u.spent/u.tokenBudget:0;
 return {percent:Math.min(100,Math.round(ratio*100)),label:`${formatCount(u.spent)} of ${formatCount(u.tokenBudget)} tokens`,tone:ratio>=1?'full':ratio>=0.8?'warn':'ok'};
}
