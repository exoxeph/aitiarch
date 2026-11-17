// Harness sessions: a Claude Code CLI session that the app owns and resumes by id. Pure and shared by the server and the page.
// The app keeps its own index of sessions (never scanned from ~/.claude); the CLI keeps the conversation itself.
import {isProfile,type CliSession,type Grant} from './profile.ts';
import {validCouncilGrant,type CouncilGrant} from './council.ts';
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
 /** What this conversation was approved for on its plan card (profile, files, repo, diagrams, cost cap), bound to this conversation and this project. None: notes only. */
 grant?:Grant;
 /** Notes-only multi-provider approval; never interpreted as a tool/fence grant. */
 councilGrant?:CouncilGrant;
 /** Normal-chat transport only. Missing means the established Claude path. */
 normalAnswerer?:'claude'|'codex'|'kiro';normalSettingsKey?:string;normalOneOff?:true;
 /** The CLI session the next turn would resume, and the profile and folder it runs at. None (a conversation older than grants): its own id, as notes. */
 cli?:CliSession&{cwd?:string};
 /** CLI sessions this conversation used before (a profile change starts a fresh one), so Delete can remove every transcript. */
 past?:{id:string;cwd?:string}[];
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
  &&(s.normalAnswerer===undefined||['claude','codex','kiro'].includes(s.normalAnswerer))&&(s.normalSettingsKey===undefined||typeof s.normalSettingsKey==='string'&&/^[a-f0-9]{64}$/.test(s.normalSettingsKey))&&(s.normalOneOff===undefined||s.normalOneOff===true)
  &&(s.grant===undefined||validGrantShape(s.grant))&&(s.councilGrant===undefined||validCouncilGrant(s.councilGrant))&&(s.cli===undefined||validCliShape(s.cli))
  &&(s.past===undefined||Array.isArray(s.past)&&s.past.length<=50&&s.past.every(p=>p&&validSessionId(p.id)&&(p.cwd===undefined||typeof p.cwd==='string'&&p.cwd.length<=1000)));
}
/** Only the shape: whether a grant belongs to this conversation and project is decided when it is used (grantFor), so a mis-bound record is refused, not lost. */
export function validGrantShape(v:unknown):v is Grant{
 if(!v||typeof v!=='object'||Array.isArray(v))return false;const g=v as Grant,strings=(l:unknown,max:number)=>Array.isArray(l)&&l.length<=max&&l.every(x=>typeof x==='string'&&x.length<=400);
 return g.v===1&&typeof g.project==='string'&&g.project.length<=100&&validSessionId(g.session)&&isProfile(g.profile)&&strings(g.files,20)&&typeof g.repo==='boolean'&&typeof g.diagrams==='boolean'&&(g.diagramNote===undefined||typeof g.diagramNote==='string'&&g.diagramNote.length<=400)
  &&typeof g.budgetUsd==='number'&&Number.isFinite(g.budgetUsd)&&g.budgetUsd>0&&g.budgetUsd<=5&&typeof g.confirmed==='string'&&/^[0-9a-f]{64}$/.test(g.confirmed);
}
export function validCliShape(v:unknown):v is CliSession&{cwd?:string}{
 if(!v||typeof v!=='object'||Array.isArray(v))return false;const c=v as CliSession&{cwd?:string};
 return validSessionId(c.id)&&isProfile(c.profile)&&Number.isSafeInteger(c.turns)&&c.turns>=0&&(c.cwd===undefined||typeof c.cwd==='string'&&c.cwd.length<=1000);
}

/**
 * Paths a harness session never sees inside the NOTEBOOK folder, and in a chat's pasted notes: the notebook file itself, hidden files and folders,
 * Aitiarch's own state and sidecars, secrets and keys, and the folders where chats, runs, measurements and backups live. Matched on every path segment.
 * These are notebook rules. They are not applied to a repo's paths (see repoDenied): a repo has src/chat/ and runs/ folders like any other code.
 */
export function harnessDenied(relPath:string):boolean{
 const parts=relPath.replace(/\\/g,'/').split('/').filter(Boolean);
 if(!parts.length)return true;
 return parts.some(p=>p.startsWith('.')||/^notebook\.md$/i.test(p)||/^ui-state\.json/i.test(p)||/\.ink\.json$|\.ledger\.jsonl?$/i.test(p)
  ||/\.pem$|^id_|credentials|secrets|\.private\./i.test(p)||/^(?:node_modules|backups|chat|chats|runs|measurements)$/i.test(p));
}

/**
 * What a REPO never gives out to an investigation. Matched on every path segment; nothing the notebook rules keep out applies to a repo.
 *  - environment files (.env*), private keys and key stores (*.pem, id_*, *.key, *.p12, *.pfx, *.jks, *.keystore), `.private.` files;
 *  - secret STORES: a file or folder named exactly secrets or credentials (also secret, credential, .secrets), or such a name with a .json, .yml, .yaml, .toml or .env
 *    extension. Source code named secrets.ts stays code; credentials* names are always excluded;
 *  - tool credential files: .npmrc, .netrc, .pypirc, .git-credentials, .aws/, .ssh/, .docker/config.json, kubeconfig, service-account*.json;
 *  - infrastructure state and variables (*.tfstate, *.tfvars);
 *  - tooling folders (.git, .claude, .codex, node_modules) and Aitiarch's own state (ui-state.json*).
 */
const SECRET_STORE=/^\.?(?:secrets?|credentials?)$|^\.?(?:secrets?|credentials?)(?:\.[a-z0-9_-]+)?\.(?:json|ya?ml|toml|env)$/i;
const SECRET_FILE=/^\.env|\.(?:pem|key|p12|pfx|jks|keystore)$|^id_|\.private\.|^\.?(?:credentials)|^\.(?:npmrc|netrc|pypirc|git-credentials|dockercfg|s3cfg|boto|authinfo(?:\.gpg)?)$|\.tfstate(?:\.backup)?$|\.tfvars$|^kubeconfig$|^service-account.*\.json$/i;
const SECRET_FOLDER=/^(?:node_modules|\.git|\.claude|\.codex|\.aws|\.ssh|\.gnupg|\.password-store)$/i;
export function repoDenied(relPath:string):boolean{
 const parts=relPath.replace(/\\/g,'/').split('/').filter(Boolean);
 if(!parts.length)return true;
 return parts.some((p,i)=>SECRET_STORE.test(p)||SECRET_FILE.test(p)||SECRET_FOLDER.test(p)||/^ui-state\.json/i.test(p)||(p.toLowerCase()==='.docker'&&parts[i+1]?.toLowerCase()==='config.json')||(p.toLowerCase()==='.kube'&&parts[i+1]?.toLowerCase()==='config'));
}
/** Display-only names; never put these paths in the ledger or use them as a grant. */
export interface CopyExclusions {paths:string[];more:number}
export function copyExclusions(paths:readonly string[]):CopyExclusions {
 const sorted=[...new Set(paths)].sort();return {paths:sorted.slice(0,10).map(p=>p.replace(/[\u0000-\u001f\u007f-\u009f]/g,'').slice(0,300)),more:Math.max(0,sorted.length-10)};
}

