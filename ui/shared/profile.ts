// One conversation entry point: what a turn may do is decided by what the user attached, never by what the page says it is. Pure and shared.
//   notes     no tools (--tools ""): notes, the open note and nothing else
//   diagrams  Read, allowed only in the PNG-only folder of the note's diagrams (unchanged)
//   investigate  Read, Grep and Glob over the app's read-only copy of the repo (or of just the attached files)
// A conversation is GRANTED a profile once (the plan card). A turn that needs more than the grant is refused until the card is approved again.
export type Profile='notes'|'diagrams'|'investigate';
export const PROFILE_RANK:Readonly<Record<Profile,number>>=Object.freeze({notes:0,diagrams:1,investigate:2});
export const PROFILES=Object.freeze(['notes','diagrams','investigate'] as const);
export const isProfile=(v:unknown):v is Profile=>typeof v==='string'&&(PROFILES as readonly string[]).includes(v);

/** What a turn carries beyond the open note: other notes (by path), repo files (repo-relative) and the repo itself. */
export interface Attachments {notes:string[];files:string[];repo:boolean}
export const NO_ATTACHMENTS:Readonly<Attachments>=Object.freeze({notes:[],files:[],repo:false});
export const ATTACHMENT_LIMITS=Object.freeze({notes:8,files:20,pathChars:400});

/** One repo-relative file spelling: forward slashes, no way out of the repo, nothing the platform treats specially. Null when it is not acceptable. */
export function normalizeAttachedPath(raw:unknown):string|null{
 if(typeof raw!=='string'||!raw||raw.length>ATTACHMENT_LIMITS.pathChars)return null;
 if(/[\u0000-\u001f\u007f<>"|?*:%$]/.test(raw)||/^\s|\s$/.test(raw))return null; // control characters, drive letters and streams (:), variables, wildcards
 const p=raw.replace(/\\/g,'/');
 if(p.startsWith('/')||p.startsWith('~')||p.endsWith('/'))return null; // absolute, UNC, home, a folder
 const parts=p.split('/');
 if(parts.some(s=>!s||s==='.'||s==='..'||/[. ]$/.test(s)))return null; // empty, current/parent folder, and names Windows quietly rewrites (trailing dot or space)
 return parts.join('/');
}
/** The attachments of a request, cleaned: unknown fields dropped, every path normalised, duplicates removed, sorted. A bad entry refuses the whole request. */
export function cleanAttachments(raw:unknown):{ok:true;value:Attachments}|{ok:false;reason:string}{
 if(raw===undefined||raw===null)return {ok:true,value:{notes:[],files:[],repo:false}};
 if(typeof raw!=='object'||Array.isArray(raw))return {ok:false,reason:'attachments must be an object'};
 const a=raw as Record<string,unknown>,list=(v:unknown)=>v===undefined?[]:Array.isArray(v)?v:null;
 const notes=list(a.notes),files=list(a.files);
 if(!notes||!files)return {ok:false,reason:'notes and files must be lists'};
 if(a.repo!==undefined&&typeof a.repo!=='boolean')return {ok:false,reason:'repo must be true or false'};
 if(notes.length>ATTACHMENT_LIMITS.notes)return {ok:false,reason:'too many notes attached'};
 if(files.length>ATTACHMENT_LIMITS.files)return {ok:false,reason:'too many files attached'};
 const cleanNotes:string[]=[],cleanFiles:string[]=[];
 for(const n of notes){const p=normalizeAttachedPath(n);if(!p)return {ok:false,reason:'a note path is not acceptable'};cleanNotes.push(p);}
 for(const f of files){const p=normalizeAttachedPath(f);if(!p)return {ok:false,reason:'a file path is not acceptable'};cleanFiles.push(p);}
 return {ok:true,value:{notes:[...new Set(cleanNotes)].sort(),files:[...new Set(cleanFiles)].sort(),repo:a.repo===true}};
}

/** The profile a turn needs, from what it carries and nothing else. Files or the repo mean Investigate (diagrams are withheld then); otherwise diagrams when the note has some. */
export function deriveProfile(a:Pick<Attachments,'files'|'repo'>,noteHasDiagrams:boolean):Profile{
 if(a.repo||a.files.length>0)return 'investigate';
 return noteHasDiagrams?'diagrams':'notes';
}

/** What a conversation was approved for on its plan card, and for which conversation and project. `confirmed` is a hash of every other field. */
export interface Grant {v:1;project:string;session:string;profile:Profile;files:string[];repo:boolean;diagrams:boolean;budgetUsd:number;confirmed:string}
/** What a turn needs. */
export interface Need {profile:Profile;files:string[];repo:boolean;diagrams:boolean}
export const needOf=(a:Pick<Attachments,'files'|'repo'>,noteHasDiagrams:boolean):Need=>{const profile=deriveProfile(a,noteHasDiagrams);return {profile,files:[...a.files],repo:a.repo,diagrams:profile==='diagrams'};};

/** Does the grant cover the need? Never more than was shown and approved: a higher profile, a file not on the card, the repo, or diagrams not granted all say no. No grant is notes only. */
export function covers(grant:Pick<Grant,'profile'|'files'|'repo'|'diagrams'>|null,need:Need):boolean{
 const g=grant??{profile:'notes' as Profile,files:[],repo:false,diagrams:false};
 if(PROFILE_RANK[need.profile]>PROFILE_RANK[g.profile])return false;
 if(need.repo&&!g.repo)return false;
 if(!g.repo&&need.files.some(f=>!g.files.includes(f)))return false; // a repo grant reaches any file that passes the path rules; a files grant only its own
 if(need.diagrams&&!g.diagrams)return false;
 return true;
}

/** A conversation's CLI session: the CLI keeps the conversation under its own id and working folder, so a different profile (up or down) needs a fresh one. */
export interface CliSession {id:string;profile:Profile;turns:number}
/** Resume only the session that already ran at exactly this profile. A conversation with no record (older than grants) counts as notes. */
export function resumePlan(cli:CliSession|undefined,legacyTurns:number,need:Profile):{fresh:boolean;resume:boolean}{
 const had=cli??{profile:'notes' as Profile,turns:legacyTurns};
 if(had.profile!==need)return {fresh:true,resume:false};
 return {fresh:false,resume:had.turns>0};
}
