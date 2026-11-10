import type {ContextChoice} from '../../shared/chat.ts';
import type {SessionDetails,SessionKind} from '../../shared/ide-sessions.ts';
export interface PickedSession {id:string;kind:SessionKind;label:string;session:SessionDetails}
export const filterSessions=(rows:PickedSession[],query:string,other:boolean)=>rows.filter(r=>(other||r.session.projectMatch)&&(r.session.title+' '+r.label).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
export const sessionChoices=(rows:PickedSession[]):ContextChoice[]=>(['claude-sessions','codex-sessions'] as const).flatMap(moduleId=>{const ids=rows.filter(r=>r.kind===moduleId&&r.session.status==='ready').map(r=>r.id);return ids.length?[{moduleId,ids}]:[];});
export const toggleSession=(rows:PickedSession[],row:PickedSession)=>row.session.status!=='ready'?rows:rows.some(r=>r.id===row.id)?rows.filter(r=>r.id!==row.id):[...rows,row];
export const relativeTime=(at:string,now=Date.now())=>{const minutes=Math.max(0,Math.floor((now-Date.parse(at))/60000));return minutes<1?'just now':minutes<60?`${minutes}m ago`:minutes<1440?`${Math.floor(minutes/60)}h ago`:`${Math.floor(minutes/1440)}d ago`;};
export const tokenCount=(n:number)=>n<1000?String(n):(n/1000).toFixed(1).replace(/\.0$/,'')+'k';
export const sessionChip=(row:PickedSession)=>`${row.label} - ${new Date(row.session.modifiedAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',hour12:false})} - ~${tokenCount(row.session.estimatedTokens)} tokens`;
export function redactedParts(text:string):{text:string;redacted:boolean}[]{return text.split(/(\[redacted: [a-z -]+\])/g).filter(Boolean).map(text=>({text,redacted:text.startsWith('[redacted: ')}));}
export const moveRow=(current:number,delta:number,count:number)=>count?Math.max(0,Math.min(count-1,current+delta)):-1;
