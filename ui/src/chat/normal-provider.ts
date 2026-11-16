// Words and small rules for choosing who answers Normal chat (Claude, Codex or Kiro). Presentation only: no I/O, and nothing here grants anything. The server is the authority.
import type {NativeChatUsage} from '../../shared/chat.ts';
import {formatUsage,providerName} from './council-view.ts';

export type Answerer='claude'|'codex'|'kiro';
export const ANSWERERS:readonly Answerer[]=['claude','codex','kiro'];
/** Cheap local check status, in the same plain words in Settings and Studio. */
export function availabilityStatus(avail:readonly {id:string;available:boolean;reason?:string}[]|null|undefined,id:Answerer):{word:string;why?:string}{
 if(avail===undefined)return {word:'Checking…'};
 if(avail===null)return {word:'Could not check',why:'Availability could not be checked.'};
 const p=avail.find(a=>a.id===id);
 return !p?{word:'Not set up',why:'This provider is not set up on this computer.'}:p.available?{word:'Available'}:{word:'Unavailable',...(p.reason?{why:p.reason}:{})};
}
export const isAnswerer=(v:unknown):v is Answerer=>typeof v==='string'&&(ANSWERERS as readonly string[]).includes(v);
/** Codex and Kiro answer through the Council transport: notes only, a cap, no session of their own. */
export const isNativeAnswerer=(a:string|undefined|null):a is 'codex'|'kiro'=>a==='codex'||a==='kiro';

/** The line under the conversation picker: what carries the conversation, said for the provider that answers. */
export function memoryText(answerer:string|undefined|null):string{
 return isNativeAnswerer(answerer)
  ?'This provider keeps no session. Your notes and recent exchanges are sent fresh with each message.'
  :'Claude remembers this conversation, also after Aitiarch is reopened. Your notes are sent fresh with every message.';
}

/** What this turn used, in the provider's own unit (tokens for Codex, credits for Kiro, dollars for Claude). Empty when nothing was reported. */
export function nativeUsageText(usage:readonly NativeChatUsage[]|undefined,costUsd?:number):string{
 const parts=(usage??[]).map(u=>formatUsage(u));
 if(!parts.length&&costUsd!==undefined)parts.push(formatUsage({unit:'usd',amount:costUsd}));
 return parts.length?`This turn used ${parts.join(' · ')}`:'';
}

export const OVER_CAP_TEXT='This turn used more than its approved cap, so its approval was withdrawn. Approve it again before the next message.';
export const approvalTitle=(provider:string)=>`Before ${providerName(provider)} answers`;
export const APPROVAL_NOTICE='This provider’s approval was withdrawn. Review it and approve again to send.';

/** The pipeline-config PUT body for choosing an answerer: the saved overrides with this one setting changed (Claude is the default, so choosing it removes the override). */
export function overridesFor(saved:Record<string,unknown>,answerer:Answerer):Record<string,unknown>{
 const next={...saved};
 if(answerer==='claude')delete next.normalAnswerer;else next.normalAnswerer=answerer;
 return next;
}
/** Plain words for what the server says when a save is refused. The server's own sentence is kept; a bare code gets one. */
export function saveErrorText(e:{message?:string;code?:string}|null|undefined):string{
 const m=(e?.message??'').trim();
 if(m&&!/^[a-z][a-z0-9_]*$/.test(m))return m;
 return 'The setting could not be saved. Nothing was changed.';
}
