import { useEffect, useRef, useState, type RefObject } from 'react';
import { EditorView } from '@codemirror/view';
import { captureAnchor } from '../../shared/anchors.ts';
import type { Invocation } from '../../shared/invocation.ts';
import { api, ApiError, type InkSnapshot } from '../api.ts';
import type { NoteSession } from './session.ts';
import type { InvokeAction, SelectedSource } from './toolbar.ts';
import { VISUALIZE_QUESTION } from '../../shared/diagram.ts';
import { addInk, removeInk, setInk } from './ink.ts';
import {rememberQuestion} from '../threads/questions.ts';

interface Draft { input: Invocation; packet?: unknown; error?: string; warnings?: string[] }
interface Running { id: string; status: string; error?: string }
export function useInvocations(path: string, view: RefObject<EditorView | null>, session: RefObject<NoteSession | null>,
  saved: (snapshot: InkSnapshot) => void) {
  const [draft, setDraft] = useState<Draft | null>(null), [jobs, setJobs] = useState<Running[]>([]), [busy, setBusy] = useState(false);
  const [providerLabel,setProviderLabel]=useState('Claude');
  useEffect(()=>{void api.assistance().then(a=>setProviderLabel(a.provider==='chatgpt-plan'?'ChatGPT plan':'Claude')).catch(()=>{});},[]);
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
  const begin = (requested: InvokeAction, source: SelectedSource) => {
    if (draft || !view.current) return;
    // Visualize is an ordinary Ask with a fixed question, so nothing new is stored: the wording itself tells the prompt
    // builder that a diagram was explicitly requested.
    const visualize = requested === 'visualize', action = visualize ? 'ask' : requested;
    const input: Invocation = { id: crypto.randomUUID(), path, action, question: visualize ? VISUALIZE_QUESTION : '', ...source };
    const anchor = captureAnchor(input.text, input.from, input.to);
    view.current.dispatch({ effects: addInk.of({ id: input.id, kind: 'answer', body: 'Review request…', anchor, originalAnchor: anchor,
      attachment: { status: 'attached', from: input.from, to: input.to } }) });
    setDraft({ input });
    if (action === 'think' || visualize) void review(input);
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
      rememberQuestion(path,input.id,input.question||'Think on this');
      merge(snapshot); setJobs(all => [...all, { id: input.id, status: 'pending' }]); setDraft(null);
    } catch (e) { setDraft({ ...draft, error: e instanceof Error ? e.message : 'Invocation failed. No automatic retry.' }); }
    finally { setBusy(false); }
  };
  // The ask/review form lives in the margin blob of the frozen selection (Enter to ask or send, Esc to cancel). The top panel
  // only shows it as a fallback when that blob is not on screen (narrow layout), plus the job status lines.
  const sendRef = useRef<HTMLButtonElement>(null), hasPacket = draft?.packet !== undefined;
  useEffect(() => { if (hasPacket) sendRef.current?.focus(); }, [hasPacket]);
  const asking = !!draft && draft.input.action === 'ask' && !hasPacket && draft.input.question !== VISUALIZE_QUESTION;
  const draftSection = draft ? <section aria-label={`Review ${providerLabel} request`} className="invocation-review"
    onKeyDown={e => {
      if (e.key === 'Escape') { e.stopPropagation(); cancelPreview(); return; }
      if (e.key !== 'Enter' || e.shiftKey || busy) return;
      const target = e.target as HTMLElement;
      if (asking && target.tagName === 'INPUT') { e.preventDefault(); if (draft.input.question.trim()) void review(draft.input); }
      else if (hasPacket && !['BUTTON', 'SUMMARY', 'INPUT'].includes(target.tagName)) { e.preventDefault(); void send(); }
    }}>
    <strong>{draft.input.action === 'think' ? 'Think on this' : draft.input.question === VISUALIZE_QUESTION ? 'Visualize' : `Ask ${providerLabel}`}</strong>
    <p role="status" className="sr-only">{hasPacket ? 'Review ready. Press Enter to send, Escape to cancel.' : asking ? 'Type your question, then press Enter to review it. Escape cancels.' : ''}</p>
    {asking && <label>Question for {providerLabel}<input aria-label={`Question for ${providerLabel}`} placeholder="Ask about this selection…" maxLength={8000} autoFocus
      value={draft.input.question} onChange={e => setDraft({ input: { ...draft.input, question: e.target.value } })} /></label>}
    <blockquote>{draft.input.text.slice(draft.input.from, draft.input.to)}</blockquote>
    {asking && <p className="small muted ask-hint">Enter to ask · Esc to cancel</p>}
    {hasPacket && <details className="what-is-sent"><summary>What will be sent</summary>
      <p className="small muted">The selection is frozen: editing the note will not change this request. {providerLabel === 'Claude' ? 'Claude CLI' : 'ChatGPT plan'} · transcript context: none. Redaction can miss prose secrets, unfamiliar or encoded credentials, and indirect identifiers. Review before sending.</p>
      <details><summary>Exact redacted request</summary><pre>{JSON.stringify(draft.packet, null, 2)}</pre></details></details>}
    {hasPacket && <p className="small muted ask-hint">Enter to send · Esc to cancel</p>}
    {draft.error && <p role="alert">{draft.error}</p>}
    {draft.warnings?.map(warning => <p role="note" key={warning}>{warning}</p>)}
    <div className="attach-actions">{hasPacket
      ? <button ref={sendRef} disabled={busy} onClick={() => void send()}>Send to {providerLabel}</button>
      : <button disabled={busy || (draft.input.action === 'ask' && !draft.input.question.trim())} onClick={() => void review(draft.input)}>Review request</button>}
      <button disabled={busy} onClick={cancelPreview}>Cancel preview</button></div>
  </section> : null;
  const panel = <div className="invocation-panel">
    {jobs.map(j => <div key={j.id} className="invocation-job" data-request-status={j.status}>
      {providerLabel}: {j.status === 'persistence_error' ? 'Answer retained in memory; saving failed.' : j.status}
      {j.error && <span role="alert">{j.error}</span>}
      {['pending', 'queued'].includes(j.status) && <button onClick={() => void api.cancelRequest(j.id).catch(() => setJobs(all => all.map(k => k.id === j.id ? { ...k, error: 'Cancellation could not be confirmed.' } : k)))}>Cancel request</button>}
      {j.status === 'persistence_error' && <button onClick={() => void api.retryInkSave(j.id).then(async () => { merge(await api.ink(path)); setJobs(all => all.map(k => k.id === j.id ? { ...k, status: 'complete' } : k)); }).catch(() => {})}>Retry saving answer (no new call)</button>}
    </div>)}
  </div>;
  return { begin, panel, draftId: draft?.input.id ?? null, draftSection };
}