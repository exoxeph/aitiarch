// The single chat box, without DOM or network: what a turn carries (attachment chips), which way it goes, when the plan card is shown, and the names and words around it.
// The server decides what a turn may do (shared/profile.ts, server/harness/conversation.ts); this file only decides what the page asks and shows, and never claims more than the server said.
import type {Attachments,Profile} from '../../shared/profile.ts';
import type {ConversationPlan,FileCheck,FileRefusal} from '../../server/harness/conversation.ts';
import type {HarnessSession} from '../../shared/harness.ts';

/** One chip above the composer, picked with "@": another note, a repo file, or the repo itself. A file the server refused carries the reason. */
export type AttachmentChip=
 |{kind:'note';path:string}
 |{kind:'file';path:string;refused?:FileRefusal}
 |{kind:'repo';fixed?:true};
export const chipKey=(c:AttachmentChip)=>c.kind==='repo'?'repo':c.kind+':'+c.path;
/** The attachments a turn sends: what the chips say, nothing else. */
export function attachmentsOf(chips:readonly AttachmentChip[]):Attachments{
 return {notes:chips.flatMap(c=>c.kind==='note'?[c.path]:[]),files:chips.flatMap(c=>c.kind==='file'?[c.path]:[]),repo:chips.some(c=>c.kind==='repo')};
}
/** Adds a chip once (the same note, file or the repo twice is one chip). */
export const addChip=(chips:readonly AttachmentChip[],c:AttachmentChip)=>chips.some(x=>chipKey(x)===chipKey(c))?[...chips]:[...chips,c];
/** The server's verdicts put on the file chips (a file the server says nothing about keeps its chip as it was). */
export function markRefused(chips:readonly AttachmentChip[],files:readonly FileCheck[]):AttachmentChip[]{
 return chips.map(c=>{if(c.kind!=='file')return c;const v=files.find(f=>f.path===c.path);if(!v)return c;const {refused:_old,...rest}=c;return v.ok?rest:{...rest,refused:v.reason??'missing'};});
}
export const refusedChips=(chips:readonly AttachmentChip[])=>chips.filter((c):c is Extract<AttachmentChip,{kind:'file'}>&{refused:FileRefusal}=>c.kind==='file'&&!!c.refused);

/** Which way a message goes. 'one-off': the classic chat (no conversation, nothing beyond notes). 'chat': a conversation turn that the chat engine runs (no tools, or Read in the
 *  diagram folder); its review says whether the plan card is needed. 'investigate': it carries files or the repo, so the plan comes first. */
export type Route='one-off'|'chat'|'investigate';
export function routeOf(att:Pick<Attachments,'files'|'repo'>,conversation:boolean):Route{
 if(att.repo||att.files.length)return 'investigate';
 return conversation?'chat':'one-off';
}
/**
 * Whether to show the plan card before this turn. Only when the server says the conversation needs more than it was approved for: the plan says needsApproval, or the chat review
 * says needsPlan. A turn that carries notes only never gets the card; neither does a turn the conversation already covers. `forced`: the person asked to continue after a stop on the cap.
 */
export function needsCard(i:{route:Route;plan?:Pick<ConversationPlan,'needsApproval'>|null;review?:{needsPlan?:boolean}|null;forced?:boolean}):boolean{
 if(i.route==='one-off')return false;
 if(i.forced)return true;
 if(i.route==='investigate')return !!i.plan?.needsApproval;
 return !!i.review?.needsPlan;
}
/** True when nothing may be sent yet: a file the server refused is still attached (the gate refuses the whole turn then). */
export const blockedByRefusals=(chips:readonly AttachmentChip[])=>refusedChips(chips).length>0;

/** A conversation's name from its first question: about 40 characters, cut at a word, no model call. */
export function autoName(question:string,max=40):string{
 const t=question.replace(/\s+/g,' ').trim();if(!t)return 'Conversation';
 if(t.length<=max)return t;
 const cut=t.slice(0,max),space=cut.lastIndexOf(' ');
 return (space>=Math.floor(max*0.6)?cut.slice(0,space):cut).replace(/[\s,;:.!?-]+$/,'')+'…';
}
/** The label "New" gives a conversation until its first question names it. */
export const PLACEHOLDER=/^Conversation \d+$/;
export const isPlaceholder=(s:Pick<HarnessSession,'label'|'turns'>)=>s.turns===0&&PLACEHOLDER.test(s.label);

/** Chat conversations and investigations in one list, newest first; an investigation made before the single box is marked as such. */
export function mergeSessions(chat:readonly HarnessSession[],inv:readonly HarnessSession[]):HarnessSession[]{
 const seen=new Set<string>(),out:HarnessSession[]=[];
 for(const s of [...chat,...inv])if(!seen.has(s.id)){seen.add(s.id);out.push(s);}
 const when=(s:HarnessSession)=>Date.parse(s.lastUsed||s.created||'')||0;
 return out.sort((a,b)=>when(b)-when(a));
}
/** An investigation made before the single box always reads the repo: its repo chip cannot be removed. */
export const isLegacyInvestigation=(s:Pick<HarnessSession,'mode'>|null|undefined)=>s?.mode==='investigate';

/** The words for a file the server refused, on its chip and on the card. The same words as the server's (a unit test keeps them equal). */
export const FILE_REFUSAL_TEXT:Readonly<Record<FileRefusal,string>>=Object.freeze({bad_path:'not an acceptable repo path',denied:'a file the repo rules keep out (secrets, keys, tooling, state)',missing:'no such file in the repo',too_large:'larger than the size cap',outside_snapshot:'not part of the copy Claude reads (ignored, linked or outside the repo)',not_file:'not a regular file'});
/** What each profile lets Claude do, on the card. */
export const PROFILE_TEXT:Readonly<Record<Profile,string>>=Object.freeze({notes:'Claude reads only the notes sent with each message. No tools.',diagrams:'Claude may open the pictures of this note\'s diagrams with Read, and nothing else.',investigate:'Claude can Read, Grep and Glob in a read-only copy, and nothing else. Nothing is written, run or sent anywhere else.'});
/** The message for a turn the server refused because of the plan. */
export function refusalText(code:string):string{
 if(code==='plan_required')return 'This needs more than the conversation was approved for. Review the plan below, then send again.';
 if(code==='grant_mismatch')return 'The approval stored for this conversation does not match it any more, so it was not used. Review the plan again.';
 if(code==='plan_changed')return 'The plan changed since it was shown. Review it again.';
 if(code==='file_refused')return 'A file cannot be attached. Remove it (its chip says why), then send again.';
 if(code==='no_repo')return 'Choose the repo folder first.';
 if(code==='invalid_cap')return 'The cost cap must be between $0.05 and $5.';
 return 'That could not be sent. Nothing was sent.';
}
/** "earlier context carried over" on the card, when the plan says so. */
export const CARRIED_TEXT='Earlier questions and answers of this conversation are carried over to the new session (not resumed). Only the questions and final answers go.';
/** The wait line from send until the first text. */
export const waitText=(ms:number)=>`Waiting for Claude · ${Math.max(0,Math.floor(ms/1000))}s`;
