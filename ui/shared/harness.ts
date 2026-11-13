// Harness sessions: a Claude Code CLI session that the app owns and resumes by id. Pure and shared by the server and the page.
// The app keeps its own index of sessions (never scanned from ~/.claude); the CLI keeps the conversation itself.
export type HarnessMode='chat'|'investigate';
export interface HarnessSession {
 /** The CLI session id (a UUID the app chose with --session-id). */
 id:string;
 label:string;mode:HarnessMode;
 /** The note a chat session is about. */
 note?:string;
 /** ISO times. */
 created:string;lastUsed:string;
 /** Completed turns. 0 means the next turn starts the session (--session-id); later turns resume it (--resume). */
 turns:number;
 /** An investigation: the absolute folder of the repo the user picked. */
 repo?:string;
 /** An investigation: the hash of the scope and cost plan the user confirmed. No turn runs without it. */
 confirmed?:string;
 /** An investigation: the cost cap (dollars per question) the user confirmed. */
 budgetUsd?:number;
}
export const MAX_SESSIONS=200;
export const validSessionId=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
/** A label is one short line of plain text. */
export const cleanLabel=(v:unknown):string|null=>{if(typeof v!=='string')return null;const t=v.replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim();return t&&t.length<=80?t:null;};
export function validSession(v:unknown):v is HarnessSession{
 if(!v||typeof v!=='object'||Array.isArray(v))return false;const s=v as HarnessSession;
 return validSessionId(s.id)&&cleanLabel(s.label)===s.label&&(s.mode==='chat'||s.mode==='investigate')&&(s.note===undefined||typeof s.note==='string'&&s.note.length<=400)
  &&[s.created,s.lastUsed].every(t=>typeof t==='string'&&Number.isFinite(Date.parse(t)))&&Number.isSafeInteger(s.turns)&&s.turns>=0
  &&(s.repo===undefined||typeof s.repo==='string'&&s.repo.length<=1000)&&(s.confirmed===undefined||typeof s.confirmed==='string'&&/^[0-9a-f]{64}$/.test(s.confirmed))
  &&(s.budgetUsd===undefined||typeof s.budgetUsd==='number'&&Number.isFinite(s.budgetUsd)&&s.budgetUsd>0&&s.budgetUsd<=5)
  &&(s.budgetUsd===undefined||typeof s.budgetUsd==='number'&&Number.isFinite(s.budgetUsd)&&s.budgetUsd>0&&s.budgetUsd<=5);
}

/**
 * Paths a harness session never sees, in a chat's pasted notes or an investigation's snapshot: the notebook file itself, hidden files and folders,
 * Aitiarch's own state and sidecars, secrets and keys, and the folders where chats, runs, measurements and backups live. Matched on every path segment.
 */
export function harnessDenied(relPath:string):boolean{
 const parts=relPath.replace(/\\/g,'/').split('/').filter(Boolean);
 if(!parts.length)return true;
 return parts.some(p=>p.startsWith('.')||/^notebook\.md$/i.test(p)||/^ui-state\.json/i.test(p)||/\.ink\.json$|\.ledger\.jsonl?$/i.test(p)
  ||/\.pem$|^id_|credentials|secrets|\.private\./i.test(p)||/^(?:node_modules|backups|chat|chats|runs|measurements)$/i.test(p));
}
