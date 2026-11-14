import { link, lstat, open, readFile, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {isAbortCause,type AbortCause} from '../shared/chat.ts';
import type {TurnUsage,TurnStatus} from './providers/turn.ts';
export interface CouncilAudit {provider:'claude'|'codex'|'kiro';status:TurnStatus;usage:TurnUsage[];durationMs:number}
export function validCouncilAudit(v:unknown):v is CouncilAudit{
 if(!v||typeof v!=='object'||Array.isArray(v))return false;const c=v as CouncilAudit;
 return Object.keys(c).sort().join()==='durationMs,provider,status,usage'&&['claude','codex','kiro'].includes(c.provider)&&['ok','refused','unavailable','timeout','error'].includes(c.status)&&Number.isFinite(c.durationMs)&&c.durationMs>=0&&Array.isArray(c.usage)&&c.usage.length<=20&&c.usage.every(u=>u&&Object.keys(u).sort().join()==='afterTurn,amount,unit'&&['usd','tokens','credits'].includes(u.unit)&&Number.isFinite(u.amount)&&u.amount>=0&&typeof u.afterTurn==='boolean');
}
export interface InvestigationAudit {kind:'mother'|'agent'|'lookup';agent:'claude'|'codex'|null;filesRead:string[];durationMs:number;tokens:number|null;cost:number|null;cancelled:boolean;outcome:'completed'|'failed'|'cancelled'}
export function validInvestigation(v:unknown):v is InvestigationAudit {if(!v||typeof v!=='object'||Array.isArray(v))return false;const x=v as InvestigationAudit;return Object.keys(x).sort().join()==='agent,cancelled,cost,durationMs,filesRead,kind,outcome,tokens'&&['mother','agent','lookup'].includes(x.kind)&&['claude','codex',null].includes(x.agent)&&Array.isArray(x.filesRead)&&x.filesRead.length<=100&&x.filesRead.every(p=>typeof p==='string'&&p.length<=400)&&[x.durationMs,x.tokens??0,x.cost??0].every(n=>typeof n==='number'&&Number.isFinite(n)&&n>=0)&&typeof x.cancelled==='boolean'&&['completed','failed','cancelled'].includes(x.outcome);}
/** One Investigate turn that reached the CLI: what it cost, never what was asked or answered. Counts are null when the CLI reported none (a stopped turn). */
export interface InvestigateTurnAudit {session:string;mode:'investigate';inputTokens:number|null;cachedTokens:number|null;outputTokens:number|null;costUsd:number|null;outcome:string}
const counter=(v:unknown)=>v===null||typeof v==='number'&&Number.isFinite(v)&&v>=0;
export function validInvestigateTurn(v:unknown):v is InvestigateTurnAudit {if(!v||typeof v!=='object'||Array.isArray(v))return false;const x=v as InvestigateTurnAudit;
 return Object.keys(x).sort().join()==='cachedTokens,costUsd,inputTokens,mode,outcome,outputTokens,session'&&x.mode==='investigate'&&typeof x.session==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(x.session)
  &&[x.inputTokens,x.cachedTokens,x.outputTokens,x.costUsd].every(counter)&&typeof x.outcome==='string'&&/^[a-z_]{1,24}$/.test(x.outcome);}
/** One diagram the model opened with Read in a conversation turn: which diagram (D<n>), its name in the assets folder, the SHA-256 and size of the copy it read, and the note it is in. Never the picture. */
export interface DiagramReadAudit {id:string;asset:string;hash:string;bytes:number;note:string}
export function validDiagramReadAudit(v:unknown):v is DiagramReadAudit {if(!v||typeof v!=='object'||Array.isArray(v))return false;const x=v as DiagramReadAudit;
 return Object.keys(x).sort().join()==='asset,bytes,hash,id,note'&&/^D[1-9]$/.test(x.id)&&/^(?:ai-)?diagram-[a-f0-9]{64}$/.test(x.asset)&&/^[a-f0-9]{64}$/.test(x.hash)&&typeof x.bytes==='number'&&Number.isSafeInteger(x.bytes)&&x.bytes>=1&&x.bytes<=10_000_000
  &&typeof x.note==='string'&&x.note.length>=1&&x.note.length<=400&&!/[\u0000-\u001f\u007f]/.test(x.note);}
/** The Claude Code CLI's version, written at the first turn of a conversation: the diagram fence was verified on one version. */
export interface CliVersionAudit {version:string;session:string}
export function validCliVersionAudit(v:unknown):v is CliVersionAudit {if(!v||typeof v!=='object'||Array.isArray(v))return false;const x=v as CliVersionAudit;
 return Object.keys(x).sort().join()==='session,version'&&typeof x.version==='string'&&/^[0-9]{1,4}(?:\.[0-9]{1,4}){1,3}[0-9A-Za-z.+-]{0,30}$/.test(x.version)&&typeof x.session==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(x.session);}
/** The selection that went with a request: its size and, when the editor said it, its line range. Never any text. */
export interface ContextSelectionAudit {chars:number;fromLine?:number;toLine?:number}
const whole=(v:unknown,min:number,max:number)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min&&v<=max;
export function validContextSelection(v:unknown):v is ContextSelectionAudit{
 if(!v||typeof v!=='object'||Array.isArray(v))return false;const x=v as ContextSelectionAudit,keys=Object.keys(x);
 if(keys.some(k=>k!=='chars'&&k!=='fromLine'&&k!=='toLine')||!whole(x.chars,1,10_000_000))return false;
 return x.fromLine===undefined&&x.toLine===undefined||whole(x.fromLine,1,10_000_000)&&whole(x.toLine,1,10_000_000)&&x.toLine!>=x.fromLine!;
}
const CONTEXT_REQUIRED=['at','event','id','inkId','moduleId','note','requestId','sourceHash'],CONTEXT_OPTIONAL=['chars','path','selection'];
/** The sorted keys of a context_read when they are the old ones plus any of the new optional ones; '' when anything else is in it. */
const contextReadKeys=(e:LedgerEvent)=>{const k=Object.keys(e);return CONTEXT_REQUIRED.every(x=>k.includes(x))&&k.every(x=>CONTEXT_REQUIRED.includes(x)||CONTEXT_OPTIONAL.includes(x))?k.sort().join():'';};
/** The values of the optional context_read fields. A path is a note path (never text), the sizes are counts. */
export function validContextFields(e:LedgerEvent):boolean{
 return (e.path===undefined||typeof e.path==='string'&&e.path.length>=1&&e.path.length<=400&&!/[\u0000-\u001f\u007f]/.test(e.path))&&(e.chars===undefined||whole(e.chars,0,10_000_000))&&(e.selection===undefined||validContextSelection(e.selection));
}
/** A context_read as a whole: a known module, the hash of what was asked for, and the optional note, size and selection fields. */
export const validContextRead=(e:LedgerEvent)=>['this-note','other-notes','claude-sessions','codex-sessions'].includes(e.moduleId??'')&&/^[a-f0-9]{64}$/.test(e.sourceHash??'')&&validContextFields(e);
export interface LedgerEvent { id: string; inkId: string; requestId: string; note: string; event: 'shown' | 'dismissed' | 'inserted' | 'resolved' | 'reopened' | 'adopted' | 'context_read' | 'chat_started' | 'chat_completed' | 'chat_failed'|'investigation'|'investigate_turn'|'diagram_read'|'cli_version'|'conversation_turn'|'council_turn'; at: string; council?:CouncilAudit; authorship?: 'ai'; insertedBy?: 'human'; moduleId?:'this-note'|'other-notes'|'claude-sessions'|'codex-sessions';sourceHash?:string;investigation?:InvestigationAudit;turn?:InvestigateTurnAudit;/** diagram_read only. */diagram?:DiagramReadAudit;/** cli_version only. */cli?:CliVersionAudit;/** conversation_turn only: what the turn was allowed to do and what it carried, by counts. Never a path or any text. */conv?:ConversationTurnAudit;
  /** context_read only, all optional (older lines have none). `path` is the note whose text was read, which in a conversation can differ from `note` (the chat's note); `chars` is the size of the source as sent;
   *  `selection` is the selection that went with the request. A context_read without `chars` is the attempt written before the read; the one with `chars` is written after it. */
  path?:string;chars?:number;selection?:ContextSelectionAudit;
  /** chat_failed only: why a running request was stopped (a person pressing Stop, the server closing, a stream limit, the budget gate, the page going away). Absent for other failures. */cause?:AbortCause }
/** One conversation turn's profile and attachments, as counts: the conversation, the profile it ran at, how many files and notes it carried, whether the repo and how many diagrams, whether it started a fresh CLI session, and the cap it had. */
export interface ConversationTurnAudit {session:string;profile:'notes'|'diagrams'|'investigate';files:number;notes:number;repo:boolean;diagrams:number;fresh:boolean;budgetUsd:number}
const countOf=(v:unknown,max:number)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0&&v<=max;
export function validConversationTurn(c:unknown):c is ConversationTurnAudit{
 if(!c||typeof c!=='object'||Array.isArray(c))return false;const t=c as ConversationTurnAudit;
 return Object.keys(t).sort().join()==='budgetUsd,diagrams,files,fresh,notes,profile,repo,session'&&typeof t.session==='string'&&/^[0-9a-f-]{36}$/.test(t.session)&&['notes','diagrams','investigate'].includes(t.profile)
  &&countOf(t.files,50)&&countOf(t.notes,50)&&countOf(t.diagrams,200)&&typeof t.repo==='boolean'&&typeof t.fresh==='boolean'&&typeof t.budgetUsd==='number'&&Number.isFinite(t.budgetUsd)&&t.budgetUsd>=0&&t.budgetUsd<=5;
}
interface Ledger { v: 1; events: LedgerEvent[] }
/** A file operation can fail for a moment on Windows (a scanner or another handle holds the file; one just removed is still delete-pending): EPERM, EBUSY and EACCES are tried again, briefly, and anything else is raised at once. */
const PASSING = new Set(['EPERM', 'EBUSY', 'EACCES']);
const pause = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
async function retried<T>(op: () => Promise<T>, withinMs = 2000): Promise<T> {
  const end = Date.now() + withinMs;
  for (let wait = 10; ; wait = Math.min(wait * 2, 100)) {
    try { return await op(); }
    catch (e) { if (!PASSING.has((e as NodeJS.ErrnoException).code ?? '') || Date.now() >= end) throw e; await pause(wait); }
  }
}
/** How long an append waits for the lock file before it gives up (as it always did: about 5 s). */
const LOCK_WAIT_MS = 5_000;
/** A lock older than this is broken whatever its pid says (the pid may belong to another program by now). */
const LOCK_STALE_MS = 60_000;
export type LockJudgement = 'held' | 'stale' | 'unreadable';
/** Whether a process is running. Signal 0 only checks: it sends nothing, and it works on Windows. EPERM means it exists but is not ours to signal. */
export function processAlive(pid: number): boolean {
  // Unsupported liveness checks degrade to "held", not permission to break a fresh lock.
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code !== 'ESRCH'; }
}
/** What the contents say, independently of mtime. Unreadable contents need the separate regular-file age check before recovery. */
export function judgeLock(raw: string, now: number, alive: (pid: number) => boolean = processAlive): LockJudgement {
  let d: unknown; try { d = JSON.parse(raw); } catch { return 'unreadable'; }
  if (!d || typeof d !== 'object' || Array.isArray(d)) return 'unreadable';
  const { pid, startedAt } = d as { pid?: unknown; startedAt?: unknown };
  if (typeof pid !== 'number' || !Number.isSafeInteger(pid) || pid <= 0 || typeof startedAt !== 'number' || !Number.isFinite(startedAt)) return 'unreadable';
  if (now - startedAt > LOCK_STALE_MS) return 'stale';
  return alive(pid) ? 'held' : 'stale';
}
export class LedgerStore {
  private tail: Promise<unknown> = Promise.resolve();
  private file: string;
  constructor(root: string) { this.file = path.join(root, 'ledger.json'); }
  /** Recovery is shared by stores for this same file, not by a chat or provider. */
  get auditKey(): string { const key=path.resolve(this.file);return process.platform==='win32'?key.toLowerCase():key; }
  private async safe() {
    try { const s = await lstat(this.file); if (!s.isFile() || s.isSymbolicLink()) throw new Error('Invalid ledger path.'); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  }
  async read(): Promise<Ledger> {
    await this.safe(); let text: string;
    try { text = await retried(() => readFile(this.file, 'utf8')); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { v: 1, events: [] }; throw e; }
    const d = JSON.parse(text);
    if (d.v !== 1 || !Array.isArray(d.events) || Object.keys(d).sort().join() !== 'events,v' || d.events.some((e: LedgerEvent) =>
      Object.keys(e).sort().join() !== (e.event==='council_turn'?'at,council,event,id,inkId,note,requestId':e.event==='investigation'?'at,event,id,inkId,investigation,note,requestId':e.event==='investigate_turn'?'at,event,id,inkId,note,requestId,turn':e.event==='diagram_read'?'at,diagram,event,id,inkId,note,requestId':e.event==='cli_version'?'at,cli,event,id,inkId,note,requestId':e.event==='conversation_turn'?'at,conv,event,id,inkId,note,requestId':e.event==='context_read'?contextReadKeys(e):e.event==='inserted'?'at,authorship,event,id,inkId,insertedBy,note,requestId':e.event==='chat_failed'&&Object.hasOwn(e,'cause')?'at,cause,event,id,inkId,note,requestId':'at,event,id,inkId,note,requestId') || !['shown', 'dismissed', 'inserted', 'resolved', 'reopened', 'adopted','context_read','chat_started','chat_completed','chat_failed','investigation','investigate_turn','diagram_read','cli_version','conversation_turn','council_turn'].includes(e.event) ||(e.event==='council_turn'&&!validCouncilAudit(e.council))||(e.event==='conversation_turn'&&!validConversationTurn(e.conv))||(e.event==='diagram_read'&&!validDiagramReadAudit(e.diagram))||(e.event==='cli_version'&&!validCliVersionAudit(e.cli))||(e.event==='investigation'&&!validInvestigation(e.investigation))||(e.event==='investigate_turn'&&!validInvestigateTurn(e.turn))||(Object.hasOwn(e,'cause')&&!isAbortCause(e.cause))|| (e.event==='inserted'&&(e.authorship!=='ai'||e.insertedBy!=='human')) || (e.event==='context_read'&&!validContextRead(e)) ||
      ![e.id, e.inkId, e.requestId, e.note, e.at].every(v => typeof v === 'string'))) throw new Error('Invalid ledger; original preserved.');
    return d;
  }
  /** Several parts of the app keep their own LedgerStore on the same file. Their appends are serialised by this lock file; one that finds it taken, or finds the file system saying no for a moment, waits its turn (up to 5 s) instead of failing.
   *  The lock records who holds it. One that is stale (see judgeLock) is broken by the waiter that finds it; any other is waited for. Returns the text the lock was written with: the proof, later, that it is still this append's. */
  private async lock(lockPath: string): Promise<string> {
    const end = Date.now() + LOCK_WAIT_MS;
    for (;;) {
      try {
        const handle = await open(lockPath, 'wx', 0o600), mine = JSON.stringify({ pid: process.pid, startedAt: Date.now(), id: randomUUID() });
        try { await handle.writeFile(mine); }
        catch (e) { await handle.close().catch(() => {}); await unlink(lockPath).catch(() => {}); throw e; } // a lock that could not be written would be an unreadable one that nobody breaks
        await handle.close(); return mine;
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code ?? '';
        if ((code !== 'EEXIST' && !PASSING.has(code)) || Date.now() >= end) throw e;
        if (code === 'EEXIST' && await this.breakIfStale(lockPath)) continue;
        await pause(15 + Math.random() * 25);
      }
    }
  }
  /** Removes the lock when it is stale, and says whether it did. Safe against other waiters doing the same: the lock is read, judged, read again, and moved away by rename (which only one of them can win). What was moved is checked to be what was judged;
   *  if another lock took its place in between, it is put back (a hard link, which does not replace a file) and left alone. Unparseable regular files need an mtime more than 60 s old; unreadable files and directories are never broken. */
  private async breakIfStale(lockPath: string): Promise<boolean> {
    const same=(a:Awaited<ReturnType<typeof lstat>>,b:Awaited<ReturnType<typeof lstat>>)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs;
    const snapshot=async(p:string)=>{
      const before=await lstat(p);if(!before.isFile()||before.isSymbolicLink())throw new Error('Not a regular lock.');
      const raw=await retried(()=>readFile(p,'utf8')),after=await lstat(p);
      if(!same(before,after)||before.ctimeMs!==after.ctimeMs)throw new Error('Lock changed during read.');
      return {raw,stat:after};
    };
    let judged:Awaited<ReturnType<typeof snapshot>>;
    try { judged=await snapshot(lockPath); } catch { return false; }
    const judgement=judgeLock(judged.raw,Date.now());
    if(judgement!=='stale'&&!(judgement==='unreadable'&&Date.now()-judged.stat.mtimeMs>LOCK_STALE_MS))return false;
    try { const again=await snapshot(lockPath);if(again.raw!==judged.raw||!same(again.stat,judged.stat)||again.stat.ctimeMs!==judged.stat.ctimeMs)return false; } catch { return false; }
    const away = lockPath + '.broken.' + randomUUID();
    try { await retried(() => rename(lockPath, away)); } catch { return false; }
    let moved:Awaited<ReturnType<typeof snapshot>>|null=null;
    try { moved=await snapshot(away); } catch { /* unreadable: preserve it */ }
    // Rename can change ctime on some platforms, so compare identity, mtime, size and bytes here.
    if(moved&&moved.raw===judged.raw&&same(moved.stat,judged.stat)){await unlink(away).catch(()=>{});return true;}
    // Same-directory rename failures leave the original alone. If hard links are unsupported,
    // restore the verified regular file with exclusive create instead (never overwrites).
    // A failed write leaves a fresh empty lock as a fence, and preserves the .broken copy.
    let restored=false;
    try { await link(away,lockPath);restored=true; } catch {
      if(moved){let f;try{f=await open(lockPath,'wx',0o600);await f.writeFile(moved.raw);await f.sync();restored=true;}catch{/* Keep the copy; never overwrite another holder. */}finally{await f?.close().catch(()=>{});}}
    }
    if(restored)await unlink(away).catch(()=>{});
    return false;
  }
  /** Whether the lock file is still the one this append wrote (after 60 s, or a crashed holder's pid being judged dead, another may have broken and taken it). */
  private async owns(lockPath: string, mine: string): Promise<boolean> {
    try { return await retried(() => readFile(lockPath, 'utf8')) === mine; } catch { return false; }
  }
  append(event: LedgerEvent): Promise<void> {
    if(event.event==='council_turn'&&!validCouncilAudit(event.council))return Promise.reject(new Error('Invalid council metadata.'));
    if(event.event==='investigation'&&!validInvestigation(event.investigation))return Promise.reject(new Error('Invalid investigation metadata.'));
    if(event.event==='investigate_turn'&&!validInvestigateTurn(event.turn))return Promise.reject(new Error('Invalid Investigate turn metadata.'));
    if(event.event==='diagram_read'&&!validDiagramReadAudit(event.diagram))return Promise.reject(new Error('Invalid diagram read metadata.'));
    if(event.event==='cli_version'&&!validCliVersionAudit(event.cli))return Promise.reject(new Error('Invalid CLI version metadata.'));
    if(event.event==='conversation_turn'&&!validConversationTurn(event.conv))return Promise.reject(new Error('Invalid conversation turn metadata.'));
    if(event.event==='context_read'&&(contextReadKeys(event)===''||!validContextRead(event)))return Promise.reject(new Error('Invalid context metadata.'));
    const job = this.tail.catch(() => {}).then(async () => {
      await this.safe(); const lockPath = this.file + '.lock';
      const mine = await this.lock(lockPath), temp = this.file + '.' + randomUUID() + '.tmp';
      try {
        const d = await this.read();
        if (d.events.some(e => ['context_read','investigation','investigate_turn','diagram_read','cli_version','conversation_turn','council_turn'].includes(event.event)?e.id===event.id:e.inkId === event.inkId && e.requestId === event.requestId && e.event === event.event)) return;
        d.events.push(event);
        const f = await open(temp, 'wx', 0o600);
        try { await f.writeFile(JSON.stringify(d, null, 2) + '\n'); await f.sync(); } finally { await f.close(); }
        if (!await this.owns(lockPath, mine)) throw new Error('The ledger lock was taken over; nothing was written.');
        await this.safe(); await retried(() => rename(temp, this.file));
      } finally { await unlink(temp).catch(() => {}); if (await this.owns(lockPath, mine)) await retried(() => unlink(lockPath)).catch(() => {}); } // the event is saved: a lock that cannot be removed now is only left behind (as a crash would leave it)
    });
    this.tail = job; return job;
  }
}

/** Best-effort audit delivery. The strict append API and on-disk schema stay unchanged.
 * Failures are visible, contain no exception text or paths, and never turn a saved reply into a failed turn.
 * Pending events live only in memory (64 per ledger); a restart loses them. Insertion's durable journal
 * deliberately keeps its own pending state until this returns true. Every attempt still uses append's lock. */
export const LEDGER_PENDING_LIMIT=64;
interface PendingAudit {tail:Promise<unknown>;events:LedgerEvent[];users:number}
const pendingAudits=new Map<string,PendingAudit>();
export function appendLedger(store:LedgerStore,event:LedgerEvent):Promise<boolean>{
 const key=store.auditKey;let state=pendingAudits.get(key);if(!state){state={tail:Promise.resolve(),events:[],users:0};pendingAudits.set(key,state);}const queue=state,copy=structuredClone(event);queue.users++;
 const report=(error:unknown,attempt:number,event:LedgerEvent['event'])=>{const e=error as NodeJS.ErrnoException,code=e?.message==='The ledger lock was taken over; nothing was written.'?'lock_taken_over':typeof e?.code==='string'&&/^[A-Z_0-9]{1,30}$/.test(e.code)?e.code:'unknown';
  console.warn('Ledger event could not be saved.',{kind:'ledger_append_failed',event,attempt,code,pending:queue.events.length});};
 const save=async(e:LedgerEvent)=>{for(let attempt=1;attempt<=2;attempt++){try{await store.append(e);return true;}catch(error){report(error,attempt,e.event);}}return false;};
 const job=queue.tail.catch(()=>{}).then(async()=>{
  const saved=await save(copy);
  // A second outage stops the flush; never multiply the wait by the queue size.
  if(saved){for(const e of [...queue.events]){if(!await save(e))break;queue.events.splice(0,1);}}
  else if(!queue.events.some(e=>e.id===copy.id)){queue.events.push(copy);if(queue.events.length>LEDGER_PENDING_LIMIT){queue.events.shift();console.warn('Ledger pending queue full; oldest event dropped.',{kind:'ledger_queue_dropped',dropped:1,pending:queue.events.length});}}
  return saved;
 }).finally(()=>{queue.users--;if(!queue.users&&!queue.events.length)pendingAudits.delete(key);});queue.tail=job;return job;
}
