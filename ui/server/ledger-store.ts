import { lstat, open, readFile, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {isAbortCause,type AbortCause} from '../shared/chat.ts';
export interface InvestigationAudit {kind:'mother'|'agent'|'lookup';agent:'claude'|'codex'|null;filesRead:string[];durationMs:number;tokens:number|null;cost:number|null;cancelled:boolean;outcome:'completed'|'failed'|'cancelled'}
export function validInvestigation(v:unknown):v is InvestigationAudit {if(!v||typeof v!=='object'||Array.isArray(v))return false;const x=v as InvestigationAudit;return Object.keys(x).sort().join()==='agent,cancelled,cost,durationMs,filesRead,kind,outcome,tokens'&&['mother','agent','lookup'].includes(x.kind)&&['claude','codex',null].includes(x.agent)&&Array.isArray(x.filesRead)&&x.filesRead.length<=100&&x.filesRead.every(p=>typeof p==='string'&&p.length<=400)&&[x.durationMs,x.tokens??0,x.cost??0].every(n=>typeof n==='number'&&Number.isFinite(n)&&n>=0)&&typeof x.cancelled==='boolean'&&['completed','failed','cancelled'].includes(x.outcome);}
export interface LedgerEvent { id: string; inkId: string; requestId: string; note: string; event: 'shown' | 'dismissed' | 'inserted' | 'resolved' | 'reopened' | 'adopted' | 'context_read' | 'chat_started' | 'chat_completed' | 'chat_failed'|'investigation'; at: string; authorship?: 'ai'; insertedBy?: 'human'; moduleId?:'this-note'|'other-notes'|'claude-sessions'|'codex-sessions';sourceHash?:string;investigation?:InvestigationAudit;
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
      Object.keys(e).sort().join() !== (e.event==='investigation'?'at,event,id,inkId,investigation,note,requestId':e.event==='context_read'?'at,event,id,inkId,moduleId,note,requestId,sourceHash':e.event==='inserted'?'at,authorship,event,id,inkId,insertedBy,note,requestId':e.event==='chat_failed'&&Object.hasOwn(e,'cause')?'at,cause,event,id,inkId,note,requestId':'at,event,id,inkId,note,requestId') || !['shown', 'dismissed', 'inserted', 'resolved', 'reopened', 'adopted','context_read','chat_started','chat_completed','chat_failed','investigation'].includes(e.event) ||(e.event==='investigation'&&!validInvestigation(e.investigation))||(Object.hasOwn(e,'cause')&&!isAbortCause(e.cause))|| (e.event==='inserted'&&(e.authorship!=='ai'||e.insertedBy!=='human')) || (e.event==='context_read'&&(!['this-note','other-notes','claude-sessions','codex-sessions'].includes(e.moduleId??'')||!/^[a-f0-9]{64}$/.test(e.sourceHash??''))) ||
      ![e.id, e.inkId, e.requestId, e.note, e.at].every(v => typeof v === 'string'))) throw new Error('Invalid ledger; original preserved.');
    return d;
  }
  append(event: LedgerEvent): Promise<void> {
    if(event.event==='investigation'&&!validInvestigation(event.investigation))return Promise.reject(new Error('Invalid investigation metadata.'));
    const job = this.tail.catch(() => {}).then(async () => {
      await this.safe(); const lockPath = this.file + '.lock';
      const lock = await open(lockPath, 'wx', 0o600), temp = this.file + '.' + randomUUID() + '.tmp';
      try {
        const d = await this.read();
        if (d.events.some(e => ['context_read','investigation'].includes(event.event)?e.id===event.id:e.inkId === event.inkId && e.requestId === event.requestId && e.event === event.event)) return;
        d.events.push(event);
        const f = await open(temp, 'wx', 0o600);
        try { await f.writeFile(JSON.stringify(d, null, 2) + '\n'); await f.sync(); } finally { await f.close(); }
        await this.safe(); await rename(temp, this.file);
      } finally { await unlink(temp).catch(() => {}); await lock.close(); await unlink(lockPath); }
    });
    this.tail = job; return job;
  }
}
