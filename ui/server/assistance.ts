import { randomUUID } from 'node:crypto';
import { mapInkItems } from '../shared/anchor-mapping.ts';
import { freezeInvocation, type Invocation } from '../shared/invocation.ts';
import type { InkItem, Generation } from '../shared/ink.ts';
import { InkStore, type InkSnapshot } from './ink-store.ts';
import { textHash } from './anchor-cache.ts';
import { Store } from './store.ts';
import { normalizeRel } from './paths.ts';
import { LedgerStore } from './ledger-store.ts';
import { prepareRequest, ProviderError, redact, type Provider, type Request } from './providers/index.ts';

interface Job { path: string; controller: AbortController; done: Promise<void>; run: () => Promise<void>; status: 'queued' | 'pending' | 'complete' | 'error' | 'cancelled' | 'persistence_error'; retry?: () => Promise<void> }
export class Assistance {
  readonly ledger: LedgerStore;
  private jobs = new Map<string, Job>();
  private active = 0;
  private writes: Promise<unknown> = Promise.resolve();
  private store: Store;
  private ink: InkStore;
  private provider: Provider;
  private notify: (path: string) => void;
  constructor(store: Store, ink: InkStore, provider: Provider, notify: (path: string) => void = () => {}) {
    this.store = store; this.ink = ink; this.provider = provider; this.notify = notify;
    this.ledger = new LedgerStore(store.rootReal);
  }
  availability() { return this.provider.checkAvailability(); }
  preview(input: Invocation) {
    const frozen = freezeInvocation(input);
    return prepareRequest({ id: frozen.id, action: frozen.action, question: frozen.question,
      selection: frozen.selection, note: frozen.text, decisions: [], turns: [] });
  }
  private serial<T>(fn: () => Promise<T>): Promise<T> { const p = this.writes.catch(() => {}).then(fn); this.writes = p; return p; }
  private async mutate(path: string, before: string, change: (items: InkItem[], text: string | null) => InkItem[]): Promise<InkSnapshot> {
    return this.serial(async () => {
      for (let attempt = 0; attempt < 8; attempt++) {
        const snapshot = await this.ink.read(path);
        let note: Awaited<ReturnType<Store['read']>> | null;
        try { note = await this.store.read(path); } catch (e) { if ((e as { status?: number }).status !== 404) throw e; note = null; }
        const previous = await this.ink.lastSeenText(path, snapshot.document.lastSeenTextHash);
        // A successful editor checkpoint is authoritative. Otherwise map the
        // hash-verified last-seen snapshot; without it use strict search.
        const document = { ...snapshot.document, noteVersion: note?.version ?? null, lastSeenTextHash: note ? textHash(note.text) : null,
          items: change(!note ? snapshot.document.items.map(item => ({ ...item, attachment: { status: 'orphaned' as const, reason: 'note-missing' as const } }))
            : snapshot.document.noteVersion === note.version ? snapshot.document.items : mapInkItems(previous ?? '', note.text, snapshot.document.items), note?.text ?? null) };
        try { const version = await this.ink.write(path, document, snapshot.version); this.notify(path); return { document, version }; }
        catch (e) { if (!/conflict|busy/i.test(String(e)) || attempt === 7) throw e; await new Promise(r => setTimeout(r, 10 * (attempt + 1))); }
      }
      throw new Error('Ink persistence conflict.');
    });
  }
  async start(input: Invocation): Promise<InkSnapshot> {
    const frozen = freezeInvocation(input), path = normalizeRel(frozen.path);
    if (this.jobs.has(frozen.id)) throw new Error('Request ID already exists.');
    const availability = await this.provider.checkAvailability();
    if (!availability.available) throw new ProviderError(availability.code, availability.message);
    const request: Request = { id: frozen.id, action: frozen.action, question: frozen.question, selection: frozen.selection,
      note: frozen.text, decisions: [], turns: [] };
    // Transcript context stays none. Optional source selection is a later slice;
    // never discover a user's global sessions or transmit one implicitly.
    const packet = prepareRequest(request);
    const pending: InkItem = { id: frozen.id, kind: 'answer', body: 'Thinking…', originalAnchor: frozen.anchor, anchor: frozen.anchor,
      attachment: { status: 'attached', from: frozen.from, to: frozen.to }, generation: { requestId: frozen.id, action: frozen.action,
        provider: 'claude', model: null, createdAt: new Date().toISOString(), status: 'pending', evidence: [], dismissed: false } };
    // Map the newly captured item too if disk changed after the click.
    const snapshot = await this.mutate(path, frozen.text, (items, text) => {
      if (items.some(i => i.id === frozen.id)) throw new Error('Request ID already exists.');
      return [...items, text === null ? { ...pending, attachment: { status: 'orphaned' as const, reason: 'note-missing' as const } }
        : text === frozen.text ? pending : mapInkItems(frozen.text, text, [pending])[0]];
    });
    // The first write requires the current note range. When it changed before
    // submission, retrying via the normal mapping is handled below in mutate.
    const controller = new AbortController();
    let finish!: () => void;
    const job: Job = { path, controller, status: 'queued', done: new Promise(resolve => { finish = resolve; }), run: async () => {
      let body = '', status: Generation['status'] = 'complete', model: string | null = null, evidence: Generation['evidence'] = [];
      try {
        if (controller.signal.aborted) throw new ProviderError('cancelled');
        const result = await this.provider.invoke(request, { signal: controller.signal });
        if (controller.signal.aborted) throw new ProviderError('cancelled');
        if (result.id !== frozen.id || result.provider !== 'claude' || typeof result.answer !== 'string' || !result.answer.trim() ||
            result.answer.length > 100000 || !Array.isArray(result.claims) || result.claims.length > 32 ||
            !(result.model === null || (typeof result.model === 'string' && /^[\w.:-]{1,100}$/.test(result.model)))) throw new ProviderError('invalid_response');
        body = redact(result.answer); model = result.model;
        evidence = result.claims.map(value => {
          const c = value as { sourceId: string; quote: string };
          const text = c?.sourceId === 'N1' ? packet.data.note : packet.data.decisions.find(d => d.id === c?.sourceId)?.text;
          if (!text || typeof c.quote !== 'string' || !c.quote.trim() || c.quote.length > 240 || !text.includes(c.quote)) throw new ProviderError('invalid_response');
          return { sourceId: c.sourceId, sourceHash: textHash(text), quote: c.quote };
        });
      } catch (e) {
        status = controller.signal.aborted ? 'cancelled' : 'error';
        body = status === 'cancelled' ? 'Request cancelled. No automatic retry.' : e instanceof ProviderError ? e.message : 'Request failed. No automatic retry.';
        evidence = []; model = null;
      }
      const persist = async () => {
        await this.mutate(path, frozen.text, items => items.map(i => i.id === frozen.id ? { ...i, body,
          generation: { ...i.generation!, status, model, evidence } } : i));
        job.status = status; job.retry = undefined;
      };
      try { await persist(); } catch { job.status = 'persistence_error'; job.retry = persist; }
      finally { job.run = async () => {}; finish(); }
    } };
    this.jobs.set(frozen.id, job); this.pump(); return snapshot;
  }
  private pump() {
    for (const job of this.jobs.values()) if (this.active < 2 && job.status === 'queued') {
      job.status = 'pending'; this.active++;
      void job.run().finally(() => { this.active--; this.pump(); });
    }
  }
  status(id: string) { const j = this.jobs.get(id); if (!j) throw new Error('Request not found or interrupted by server restart.'); return { id, path: j.path, status: j.status }; }
  wait(id: string) { return this.jobs.get(id)?.done ?? Promise.reject(new Error('Request not found.')); }
  async retrySave(id: string) { const j = this.jobs.get(id); if (!j?.retry) throw new Error('No persistence retry available.'); await j.retry(); }
  async cancel(id: string) {
    const j = this.jobs.get(id); if (!j) throw new Error('Request not found.');
    j.controller.abort();
    if (j.status === 'queued') { j.status = 'pending'; await j.run(); }
  }
  async event(note: string, id: string, event: 'shown' | 'dismissed') {
    const s = await this.ink.read(note), item = s.document.items.find(i => i.id === id);
    if (!item?.generation || item.generation.status !== 'complete') throw new Error('Completed ink not found.');
    if (event === 'dismissed') {
      const current = await this.store.read(note).catch(() => null);
      await this.mutate(note, current?.text ?? '', items => items.map(i => i.id === id ? { ...i, generation: { ...i.generation!, dismissed: true } } : i));
    }
    await this.ledger.append({ id: randomUUID(), inkId: id, requestId: item.generation.requestId, note, event, at: new Date().toISOString() });
  }
}
