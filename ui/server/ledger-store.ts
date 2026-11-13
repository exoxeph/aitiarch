import { lstat, open, readFile, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {isAbortCause,type AbortCause} from '../shared/chat.ts';
export interface InvestigationAudit {kind:'mother'|'agent'|'lookup';agent:'claude'|'codex'|null;filesRead:string[];durationMs:number;tokens:number|null;cost:number|null;cancelled:boolean;outcome:'completed'|'failed'|'cancelled'}
export function validInvestigation(v:unknown):v is InvestigationAudit {if(!v||typeof v!=='object'||Array.isArray(v))return false;const x=v as InvestigationAudit;return Object.keys(x).sort().join()==='agent,cancelled,cost,durationMs,filesRead,kind,outcome,tokens'&&['mother','agent','lookup'].includes(x.kind)&&['claude','codex',null].includes(x.agent)&&Array.isArray(x.filesRead)&&x.filesRead.length<=100&&x.filesRead.every(p=>typeof p==='string'&&p.length<=400)&&[x.durationMs,x.tokens??0,x.cost??0].every(n=>typeof n==='number'&&Number.isFinite(n)&&n>=0)&&typeof x.cancelled==='boolean'&&['completed','failed','cancelled'].includes(x.outcome);}
/** One Investigate turn that reached the CLI: what it cost, never what was asked or answered. Counts are null when the CLI reported none (a stopped turn). */
export interface InvestigateTurnAudit {session:string;mode:'investigate';inputTokens:number|null;cachedTokens:number|null;outputTokens:number|null;costUsd:number|null;outcome:string}
const counter=(v:unknown)=>v===null||typeof v==='number'&&Number.isFinite(v)&&v>=0;
export function validInvestigateTurn(v:unknown):v is InvestigateTurnAudit {if(!v||typeof v!=='object'||Array.isArray(v))return false;const x=v as InvestigateTurnAudit;
 return Object.keys(x).sort().join()==='cachedTokens,costUsd,inputTokens,mode,outcome,outputTokens,session'&&x.mode==='investigate'&&typeof x.session==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(x.session)
  &&[x.inputTokens,x.cachedTokens,x.outputTokens,x.costUsd].every(counter)&&typeof x.outcome==='string'&&/^[a-z_]{1,24}$/.test(x.outcome);}
export interface LedgerEvent { id: string; inkId: string; requestId: string; note: string; event: 'shown' | 'dismissed' | 'inserted' | 'resolved' | 'reopened' | 'adopted' | 'context_read' | 'chat_started' | 'chat_completed' | 'chat_failed'|'investigation'|'investigate_turn'; at: string; authorship?: 'ai'; insertedBy?: 'human'; moduleId?:'this-note'|'other-notes'|'claude-sessions'|'codex-sessions';sourceHash?:string;investigation?:InvestigationAudit;turn?:InvestigateTurnAudit;
  /** chat_failed only: why a running request was stopped (a person pressing Stop, the server closing, a stream limit, the budget gate, the page going away). Absent for other failures. */cause?:AbortCause }
interface Ledger { v: 1; events: LedgerEvent[] }
export class LedgerStore {
  private tail: Promise<unknown> = Promise.resolve();
  private file: string;
  constructor(root: string) { this.file = path.join(root, 'ledger.json'); }
  private async safe() {
    try { const s = await lstat(this.file); if (!s.isFile() || s.isSymbolicLink()) throw new Error('Invalid ledger path.'); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  }
  async read(): Promise<Ledger> {
    await this.safe(); let text: string;
    try { text = await readFile(this.file, 'utf8'); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { v: 1, events: [] }; throw e; }
    const d = JSON.parse(text);
    if (d.v !== 1 || !Array.isArray(d.events) || Object.keys(d).sort().join() !== 'events,v' || d.events.some((e: LedgerEvent) =>
      Object.keys(e).sort().join() !== (e.event==='investigation'?'at,event,id,inkId,investigation,note,requestId':e.event==='investigate_turn'?'at,event,id,inkId,note,requestId,turn':e.event==='context_read'?'at,event,id,inkId,moduleId,note,requestId,sourceHash':e.event==='inserted'?'at,authorship,event,id,inkId,insertedBy,note,requestId':e.event==='chat_failed'&&Object.hasOwn(e,'cause')?'at,cause,event,id,inkId,note,requestId':'at,event,id,inkId,note,requestId') || !['shown', 'dismissed', 'inserted', 'resolved', 'reopened', 'adopted','context_read','chat_started','chat_completed','chat_failed','investigation','investigate_turn'].includes(e.event) ||(e.event==='investigation'&&!validInvestigation(e.investigation))||(e.event==='investigate_turn'&&!validInvestigateTurn(e.turn))||(Object.hasOwn(e,'cause')&&!isAbortCause(e.cause))|| (e.event==='inserted'&&(e.authorship!=='ai'||e.insertedBy!=='human')) || (e.event==='context_read'&&(!['this-note','other-notes','claude-sessions','codex-sessions'].includes(e.moduleId??'')||!/^[a-f0-9]{64}$/.test(e.sourceHash??''))) ||
      ![e.id, e.inkId, e.requestId, e.note, e.at].every(v => typeof v === 'string'))) throw new Error('Invalid ledger; original preserved.');
    return d;
  }
  /** Several parts of the app keep their own LedgerStore on the same file. Their appends are serialised by this lock file; one that finds it taken waits its turn (up to about 5 s) instead of failing. */
  private async lock(lockPath: string) {
    for (let tries = 0; ; tries++) {
      try { return await open(lockPath, 'wx', 0o600); }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST' || tries >= 200) throw e; await new Promise(r => setTimeout(r, 25)); }
    }
  }
  append(event: LedgerEvent): Promise<void> {
    if(event.event==='investigation'&&!validInvestigation(event.investigation))return Promise.reject(new Error('Invalid investigation metadata.'));
    if(event.event==='investigate_turn'&&!validInvestigateTurn(event.turn))return Promise.reject(new Error('Invalid Investigate turn metadata.'));
    const job = this.tail.catch(() => {}).then(async () => {
      await this.safe(); const lockPath = this.file + '.lock';
      const lock = await this.lock(lockPath), temp = this.file + '.' + randomUUID() + '.tmp';
      try {
        const d = await this.read();
        if (d.events.some(e => ['context_read','investigation','investigate_turn'].includes(event.event)?e.id===event.id:e.inkId === event.inkId && e.requestId === event.requestId && e.event === event.event)) return;
        d.events.push(event);
        const f = await open(temp, 'wx', 0o600);
        try { await f.writeFile(JSON.stringify(d, null, 2) + '\n'); await f.sync(); } finally { await f.close(); }
        await this.safe(); await rename(temp, this.file);
      } finally { await unlink(temp).catch(() => {}); await lock.close(); await unlink(lockPath); }
    });
    this.tail = job; return job;
  }
}
