import { useEffect, useRef, useState, type RefObject } from 'react';
import { EditorView } from '@codemirror/view';
import { captureAnchor } from '../../shared/anchors.ts';
import type { Invocation } from '../../shared/invocation.ts';
import { api, ApiError, type InkSnapshot } from '../api.ts';
import type { NoteSession } from './session.ts';
import type { SelectedSource } from './toolbar.ts';
import { addInk, removeInk, setInk } from './ink.ts';

interface Draft { input: Invocation; packet?: unknown; error?: string; warnings?: string[] }
interface Running { id: string; status: string; error?: string }
export function useInvocations(path: string, view: RefObject<EditorView | null>, session: RefObject<NoteSession | null>,
  saved: (snapshot: InkSnapshot) => void) {
  const [draft, setDraft] = useState<Draft | null>(null), [jobs, setJobs] = useState<Running[]>([]), [busy, setBusy] = useState(false);
  const mounted = useRef(true), liveSaved = useRef(saved); liveSaved.current = saved;
  const merge = (snapshot: InkSnapshot) => {
    if (!mounted.current || !view.current) return;
    const trustedText = snapshot.document.noteVersion === session.current?.base.version ? session.current.base.text : null;
    view.current.dispatch({ effects: setInk.of({ items: snapshot.document.items, trustedText }) });
    liveSaved.current(snapshot);
  };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let cancelled = false;
    void api.ink(path).then(async snapshot => {
      const restored = await Promise.all(snapshot.document.items.filter(i => i.generation?.status === 'pending').map(async i => {
        try { return { id: i.id, status: (await api.requestStatus(i.id)).status }; }
        catch (e) { return { id: i.id, status: e instanceof ApiError && e.status === 404 ? 'interrupted' : 'pending', error: 'Status unavailable; no inference was rerun.' }; }
      }));
      if (!cancelled) setJobs(current => [...current, ...restored.filter(j => !current.some(c => c.id === j.id))]);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [path]);
  useEffect(() => {
    let cancelled = false, polling = false;
    const poll = async () => {
      if (polling) return; polling = true;
      try {
        for (const job of jobs.filter(j => ['pending', 'queued', 'persistence_error'].includes(j.status))) {
          try {
            const result = await api.requestStatus(job.id);
            if (cancelled) return;
            setJobs(all => all.map(j => j.id === job.id ? { ...j, status: result.status } : j));
            if (['complete', 'error', 'cancelled'].includes(result.status)) merge(await api.ink(path));
          } catch (e) { if (!cancelled) setJobs(all => all.map(j => j.id === job.id ? { ...j,
            status: e instanceof ApiError && e.status === 404 ? 'interrupted' : j.status,
            error: 'Request status unavailable. Saved ink is preserved; no inference was rerun.' } : j)); }
        }
      } finally { polling = false; }
    };
    const timer = setInterval(() => void poll(), 300); return () => { cancelled = true; clearInterval(timer); };
  }, [jobs, path]);
  const review = async (input: Invocation) => {
    setBusy(true);
    try {
      const availability = await api.assistance();
      if (!availability.available) throw new Error(availability.message ?? 'Claude is unavailable.');
      const packet = await api.previewInvocation(input);
      if (mounted.current) setDraft({ input, packet, warnings: availability.warnings });
    } catch (e) { if (mounted.current) setDraft({ input, error: e instanceof Error ? e.message : 'Context preview failed.' }); }
    finally { if (mounted.current) setBusy(false); }
  };
  const begin = (action: 'think' | 'ask', source: SelectedSource) => {
    if (draft || !view.current) return;
    const input: Invocation = { id: crypto.randomUUID(), path, action, question: '', ...source };
    const anchor = captureAnchor(input.text, input.from, input.to);
    view.current.dispatch({ effects: addInk.of({ id: input.id, kind: 'answer', body: 'Review request…', anchor, originalAnchor: anchor,
      attachment: { status: 'attached', from: input.from, to: input.to } }) });
    setDraft({ input });
    if (action === 'think') void review(input);
  };
  const cancelPreview = () => { if (draft && view.current) view.current.dispatch({ effects: removeInk.of(draft.input.id) }); setDraft(null); };
  const send = async () => {
    if (!draft?.packet || busy) return;
    const input = draft.input;
    setBusy(true);
    try {
      // Save only the human's current draft through the existing byte-preserving
      // path; the frozen request itself is never rewritten to match that draft.
      await session.current?.flush();
      if (session.current?.status !== 'saved') throw new Error('Save or resolve this note before sending.');
      const snapshot = await api.invoke(input);
      merge(snapshot); setJobs(all => [...all, { id: input.id, status: 'pending' }]); setDraft(null);
    } catch (e) { setDraft({ ...draft, error: e instanceof Error ? e.message : 'Invocation failed. No automatic retry.' }); }
    finally { setBusy(false); }
  };
  const panel = <div className="invocation-panel">
    {draft && <section aria-label="Review Claude request" className="invocation-review">
      <strong>{draft.input.action === 'think' ? 'Think on this' : 'Ask Claude'}</strong>
      <div className="small muted">Selection frozen at click. Editing the note will not change this request.</div>
      <blockquote>{draft.input.text.slice(draft.input.from, draft.input.to)}</blockquote>
      {draft.input.action === 'ask' && !draft.packet && <label>Question for Claude<input aria-label="Question for Claude" maxLength={8000}
        value={draft.input.question} onChange={e => setDraft({ input: { ...draft.input, question: e.target.value } })} /></label>}
      <p className="small muted">Claude CLI · transcript context: none. Redaction can miss prose secrets, unfamiliar or encoded credentials, and indirect identifiers. Review before sending.</p>
      {draft.packet !== undefined && <details><summary>Exact redacted request</summary><pre>{JSON.stringify(draft.packet, null, 2)}</pre></details>}
      {draft.error && <p role="alert">{draft.error}</p>}
      {draft.warnings?.map(warning => <p role="note" key={warning}>{warning}</p>)}
      <div className="attach-actions">{draft.packet !== undefined
        ? <button disabled={busy} onClick={() => void send()}>Send to Claude</button>
        : <button disabled={busy || (draft.input.action === 'ask' && !draft.input.question.trim())} onClick={() => void review(draft.input)}>Review request</button>}
        <button disabled={busy} onClick={cancelPreview}>Cancel preview</button></div>
    </section>}
    {jobs.map(j => <div key={j.id} className="invocation-job" data-request-status={j.status}>
      Claude: {j.status === 'persistence_error' ? 'Answer retained in memory; saving failed.' : j.status}
      {j.error && <span role="alert">{j.error}</span>}
      {['pending', 'queued'].includes(j.status) && <button onClick={() => void api.cancelRequest(j.id).catch(() => setJobs(all => all.map(k => k.id === j.id ? { ...k, error: 'Cancellation could not be confirmed.' } : k)))}>Cancel request</button>}
      {j.status === 'persistence_error' && <button onClick={() => void api.retryInkSave(j.id).then(async () => { merge(await api.ink(path)); setJobs(all => all.map(k => k.id === j.id ? { ...k, status: 'complete' } : k)); }).catch(() => {})}>Retry saving answer (no new call)</button>}
    </div>)}
  </div>;
  return { begin, panel };
}
