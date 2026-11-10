import { lstat, open, readFile, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
export interface LedgerEvent { id: string; inkId: string; requestId: string; note: string; event: 'shown' | 'dismissed' | 'inserted' | 'resolved' | 'reopened' | 'adopted' | 'context_read' | 'chat_started' | 'chat_completed' | 'chat_failed'; at: string; authorship?: 'ai'; insertedBy?: 'human'; moduleId?:'this-note'|'other-notes';sourceHash?:string }
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
      Object.keys(e).sort().join() !== (e.event==='context_read'?'at,event,id,inkId,moduleId,note,requestId,sourceHash':e.event==='inserted'?'at,authorship,event,id,inkId,insertedBy,note,requestId':'at,event,id,inkId,note,requestId') || !['shown', 'dismissed', 'inserted', 'resolved', 'reopened', 'adopted','context_read','chat_started','chat_completed','chat_failed'].includes(e.event) || (e.event==='inserted'&&(e.authorship!=='ai'||e.insertedBy!=='human')) || (e.event==='context_read'&&(!['this-note','other-notes'].includes(e.moduleId??'')||!/^[a-f0-9]{64}$/.test(e.sourceHash??''))) ||
      ![e.id, e.inkId, e.requestId, e.note, e.at].every(v => typeof v === 'string'))) throw new Error('Invalid ledger; original preserved.');
    return d;
  }
  append(event: LedgerEvent): Promise<void> {
    const job = this.tail.catch(() => {}).then(async () => {
      await this.safe(); const lockPath = this.file + '.lock';
      const lock = await open(lockPath, 'wx', 0o600), temp = this.file + '.' + randomUUID() + '.tmp';
      try {
        const d = await this.read();
        if (d.events.some(e => event.event==='context_read'?e.id===event.id:e.inkId === event.inkId && e.requestId === event.requestId && e.event === event.event)) return;
        d.events.push(event);
        const f = await open(temp, 'wx', 0o600);
        try { await f.writeFile(JSON.stringify(d, null, 2) + '\n'); await f.sync(); } finally { await f.close(); }
        await this.safe(); await rename(temp, this.file);
      } finally { await unlink(temp).catch(() => {}); await lock.close(); await unlink(lockPath); }
    });
    this.tail = job; return job;
  }
}
