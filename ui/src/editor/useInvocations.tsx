import {transient} from '../transient.ts';
import {savedProviderLabel} from '../../shared/threads.ts';
import {selectionLabel} from '../../shared/model-settings.ts';
import {invokedUsageLabel,type InvokedUsage} from '../../shared/invoked-usage.ts';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { EditorView } from '@codemirror/view';
import { captureAnchor } from '../../shared/anchors.ts';
import type { Invocation, Renderer, ReviewedCodexSkill } from '../../shared/invocation.ts';
import { api, ApiError, type InkSnapshot } from '../api.ts';
import type { NoteSession } from './session.ts';
import type { InvokeAction, SelectedSource } from './toolbar.ts';
import { VISUALIZE_QUESTION } from '../../shared/diagram.ts';
import { addInk, removeInk, setInk } from './ink.ts';
import {rememberQuestion} from '../threads/questions.ts';
import {Thinking} from '../ink/streaming.tsx';
import {CodexSkillsReview} from '../skills/CodexSkillsReview.tsx';
import {SkillsReviewList} from '../skills/SkillsReviewList.tsx';
import {SkillPick} from '../skills/SkillPick.tsx';
import {PersonaSwitch} from '../skills/PersonaSwitch.tsx';
import {useNodeSettings} from '../skills/useNodeSettings.ts';
import {NODE_LABEL} from '../skills/skills-model.ts';
import {nodeFor} from '../../shared/node-settings.ts';
import type {SkillsReview} from '../../shared/node-settings.ts';
import {clipboardImages,ImageConfirmation,ImagePicker,ImageThumbnails,useChatImages} from '../chat/ImageAttachments.tsx';
import type {ReviewedImageManifest} from '../../shared/image-attachments.ts';
/** The packet the server sends back has a "skills" entry beside the request; the request itself is everything else. */
const exactRequest=(packet:unknown)=>{const {skills:_skills,review:_review,...rest}=packet as Record<string,unknown>;return rest;};

interface Draft { input: Invocation; packet?: unknown; error?: string; warnings?: string[];providerLabel?:string }
interface Running { id: string; status: string; error?: string;usage?:InvokedUsage;notice?:string }
export function useInvocations(path: string, view: RefObject<EditorView | null>, session: RefObject<NoteSession | null>,
  saved: (snapshot: InkSnapshot) => void) {
  const [draft, setDraft] = useState<Draft | null>(null), [jobs, setJobs] = useState<Running[]>([]), [busy, setBusy] = useState(false);
  const [availableProviderLabel,setProviderLabel]=useState('Claude');
  const [imageNotice,setImageNotice]=useState(''),[imagesConfirmed,setImagesConfirmed]=useState(false);
  const isVisualize = !!draft && draft.input.question === VISUALIZE_QUESTION;
  const imageDraft=useChatImages(path,setImageNotice,'invoked',!!draft&&!isVisualize);
  const imageIds=imageDraft.images.map(image=>image.id);
  const reviewedImages=(draft?.packet as {review?:{images?:ReviewedImageManifest}}|undefined)?.review?.images?.images??[];
  const reviewedSkills=(draft?.packet as {review?:{codexSkills?:ReviewedCodexSkill[]}}|undefined)?.review?.codexSkills??[];
  const imagesReviewed=imageIds.length===reviewedImages.length&&imageIds.every((id,i)=>id===reviewedImages[i].id);
  const canSendImages=imagesReviewed&&!imageDraft.loading&&(!imageIds.length||imagesConfirmed&&imageDraft.support.available);
  const providerLabel=draft?.providerLabel??availableProviderLabel;
  useEffect(()=>{void api.assistance().then(a=>setProviderLabel(savedProviderLabel(a.provider??'claude'))).catch(()=>{});},[]);
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
            setJobs(all => all.map(j => j.id === job.id ? { ...j, status: result.status,usage:result.usage,notice:result.notice } : j));
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
    if(imageDraft.loading)return;
    setImagesConfirmed(false);
    // A revision always starts a new review of the original editor selection.
    const {imageIds:_previousImages,reviewId:_previousReview,...frozen}=input;
    input={...frozen,...(!isVisualize&&imageIds.length?{imageIds}:{})};
    setBusy(true);
    try {
      const availability = await api.assistance(input.renderer);
      if (!availability.available) throw new Error(availability.message ?? 'Claude is unavailable.');
      const packet = await api.previewInvocation(input);
      const reviewed=(packet as {review?:{id:string;provider:string}}).review;
      if (mounted.current){setDraft({ input:{...input,...(reviewed?{reviewId:reviewed.id}:{})}, packet, warnings: availability.warnings,providerLabel:savedProviderLabel(reviewed?.provider??availability.provider??'claude') });}
    } catch (e) { if (mounted.current) setDraft({ input, error: e instanceof Error ? e.message : 'Context preview failed.' }); }
    finally { if (mounted.current) setBusy(false); }
  };
  const begin = (requested: InvokeAction, source: SelectedSource, options?: { renderer?: Renderer }) => {
    if (draft || !view.current) return;
    // Visualize is an ordinary Ask with a fixed question, so nothing new is stored: the wording itself tells the prompt
    // builder that a diagram was explicitly requested.
    const visualize = requested === 'visualize', action = visualize ? 'ask' : requested;
    const input: Invocation = { id: crypto.randomUUID(), path, action, question: visualize ? VISUALIZE_QUESTION : '', ...source, ...(visualize && options?.renderer ? { renderer: options.renderer } : {}) };
    const anchor = captureAnchor(input.text, input.from, input.to);
    view.current.dispatch({ effects: addInk.of({ id: input.id, kind: 'answer', body: 'Review request…', anchor, originalAnchor: anchor,
      attachment: { status: 'attached', from: input.from, to: input.to } }) });
    setDraft({ input });
    // Attention moves to this review: popovers left open elsewhere (the note's "..." menu) close so they never cover it.
    window.dispatchEvent(new CustomEvent('invocation-begin'));
    if (action === 'think' || visualize) void review(input);
  };
  const cancelPreview = () => { if (draft && view.current) view.current.dispatch({ effects: removeInk.of(draft.input.id) }); imageDraft.clear();setImageNotice('');setImagesConfirmed(false);setDraft(null); };
  useEffect(()=>{if(!draft)return;return transient(()=>document.querySelector<HTMLElement>('.ink-surface[data-note-path='+JSON.stringify(path)+'] .invocation-review'),cancelPreview,180,()=>busy||(draft.input.action==='ask'&&draft.input.question!==VISUALIZE_QUESTION&&!!draft.input.question.trim()));},[draft,busy,path]);
  const send = async () => {
    if (!draft?.packet || busy || !canSendImages) return;
    const input = {...draft.input,...(imageIds.length?{confirmImages:true}:{}),...(reviewedSkills.length?{confirmSkills:true}:{})};
    setBusy(true);
    try {
      // Save only the human's current draft through the existing byte-preserving
      // path; the frozen request itself is never rewritten to match that draft.
      await session.current?.flush();
      if (session.current?.status !== 'saved') throw new Error('Save or resolve this note before sending.');
      const snapshot = await api.invoke(input);
      rememberQuestion(path,input.id,input.question||'Think on this');
      merge(snapshot); setJobs(all => [...all, { id: input.id, status: 'pending' }]); imageDraft.clear();setImageNotice('');setImagesConfirmed(false);setDraft(null);
    } catch (e) { setDraft({ input:draft.input, error: e instanceof Error ? e.message : 'Invocation failed. No automatic retry.' }); }
    finally { setBusy(false); }
  };
  // The ask/review form lives in the margin blob of the frozen selection (Enter to ask or send, Esc to cancel). The top panel
  // only shows it as a fallback when that blob is not on screen (narrow layout), plus the job status lines.
  const sendRef = useRef<HTMLButtonElement>(null), hasPacket = draft?.packet !== undefined&&imagesReviewed;
  const reviewedCap=(draft?.packet as {review?:{cap?:{unit:string;amount:number}|null}}|undefined)?.review?.cap;
  const modelNotice=(draft?.packet as {review?:{modelNotice?:string}}|undefined)?.review?.modelNotice;
  const stepNode = draft ? nodeFor(draft.input.action, draft.input.question) : 'ask', persona = useNodeSettings(stepNode);
  // Visualize only: who draws the diagram. Skill needs a skill attached to the Visualize step (Settings); Built-in is always there and the default.
  const renderer = draft?.input.renderer ?? 'builtin';
  const [codexSkill,setCodexSkill]=useState(false);
  const [visualizeSkills, setVisualizeSkills] = useState(0);
  useEffect(() => { if (!isVisualize) return; let off = false; void api.nodes().then(r => { if (!off) setVisualizeSkills(r.nodes.visualize.skills.length); }).catch(() => {});
    void api.assistance('skill').then(r=>{if(!off)setCodexSkill(r.available&&r.provider==='codex');}).catch(()=>{});
    return () => { off = true; }; }, [isVisualize, draft?.input.id]);
  const chooseRenderer = (next: 'builtin' | 'skill') => { if (!draft || busy || next === renderer) return; const { skill: _drop, ...rest } = draft.input, input: Invocation = { ...rest, renderer: next }; setDraft({ input }); void review(input); }; // a pick belongs to the Skill renderer only
  const pickSkill = (id: string) => { if (!draft || busy) return; const input: Invocation = { ...draft.input, renderer: 'skill', skill: id }; setDraft({ input }); void review(input); };
  useEffect(() => { if (hasPacket) sendRef.current?.focus(); }, [hasPacket]);
  const asking = !!draft && draft.input.action === 'ask' && draft.packet===undefined && !isVisualize;
  const draftSection = draft ? <section aria-label={`Review ${providerLabel} request`} className="invocation-review" data-frozen-selection={draft.input.text.slice(draft.input.from, draft.input.to)}
    onPaste={e=>{
      const files=clipboardImages(e.clipboardData);
      if(isVisualize||!files.length)return;
      e.preventDefault();
      e.stopPropagation();
      if(!busy){setImagesConfirmed(false);void imageDraft.add(files);}
    }}
    onDragOver={e=>{if(!isVisualize&&e.dataTransfer.types.includes('Files'))e.preventDefault();}}
    onDrop={e=>{
      const files=clipboardImages(e.dataTransfer);
      if(isVisualize||!files.length)return;
      e.preventDefault();
      e.stopPropagation();
      if(!busy){setImagesConfirmed(false);void imageDraft.add(files);}
    }}
    onKeyDown={e => {
      if (e.key === 'Escape') { e.stopPropagation(); if(!busy&&!(draft.input.action==='ask'&&draft.input.question!==VISUALIZE_QUESTION&&draft.input.question.trim()))cancelPreview(); return; }
      if (e.key !== 'Enter' || e.shiftKey || busy) return;
      const target = e.target as HTMLElement;
      if (asking && target.tagName === 'INPUT') { e.preventDefault(); if (draft.input.question.trim()) void review(draft.input); }
      else if (hasPacket && !['BUTTON', 'SUMMARY', 'INPUT'].includes(target.tagName)) { e.preventDefault(); void send(); }
    }}>
    {/* The dot is where the arrow from the selected text lands, as on a finished thought. The selection itself is not repeated here. */}
    <div className="thought-meta invoke-head"><span className="thought-dot" aria-hidden="true" /><strong>{draft.input.action === 'think' ? 'Think on this' : draft.input.question === VISUALIZE_QUESTION ? 'Visualize' : `Ask ${providerLabel}`}</strong></div>
    <p role="status" className="sr-only">{hasPacket ? 'Review ready. Press Enter to send, Escape to cancel.' : asking ? 'Type your question, then press Enter to review it. Escape cancels.' : ''}</p>
    {asking && <label>Question for {providerLabel}<input aria-label={`Question for ${providerLabel}`} placeholder="Ask about this selection…" maxLength={8000} autoFocus
      value={draft.input.question} onChange={e => setDraft({ input: { ...draft.input, question: e.target.value } })} /></label>}
    {!isVisualize&&<ImagePicker draft={imageDraft} disabled={busy}/>}
    {imageNotice&&<p role="status" className="small muted">{imageNotice}</p>}
    {imageIds.length>0&&(hasPacket?<><ImageConfirmation checked={imagesConfirmed} onChange={setImagesConfirmed} images={imageDraft.images}/>
      <button type="button" disabled={busy} onClick={()=>{imageDraft.clear();setImagesConfirmed(false);}}>Remove attached images</button></>:
      <ImageThumbnails images={imageDraft.images} onRemove={busy?undefined:id=>{setImagesConfirmed(false);imageDraft.remove(id);}}/>)}
    {isVisualize && <fieldset className="persona-switch renderer-switch" disabled={busy}>
      <legend className="persona-legend">Who draws it</legend>
      <div className="persona-options">
        <label className="persona-option"><input type="radio" name="renderer" value="builtin" checked={renderer === 'builtin'} onChange={() => chooseRenderer('builtin')} aria-describedby="renderer-line" /><span className="persona-seg">Built-in</span></label>
        <label className="persona-option"><input type="radio" name="renderer" value="skill" checked={renderer === 'skill'} disabled={visualizeSkills === 0 && !codexSkill} onChange={() => chooseRenderer('skill')} aria-describedby="renderer-line" /><span className="persona-seg">Skill</span></label>
      </div>
      <p className="persona-line" id="renderer-line">{codexSkill ? 'Codex draws a still image using built-in drawing instructions.' : renderer === 'skill' ? 'A skill you attached to Visualize draws it as a still image. Only a cleaned copy of its drawing is kept; nothing it sends can run.' : visualizeSkills === 0 ? 'The app draws it from a short spec. To draw with a skill, attach one to Visualize in Settings.' : 'The app draws it from a short spec.'}</p>
    </fieldset>}
    {isVisualize && renderer === 'skill' && !codexSkill && <SkillPick review={(draft.packet as { skills?: SkillsReview } | undefined)?.skills} disabled={busy} onPick={pickSkill} />}
    {!(isVisualize && renderer === 'skill') && <PersonaSwitch id={'step-' + stepNode} label={`How ${NODE_LABEL[stepNode]} works with you`} value={persona.persona} kept={persona.kept} disabled={busy}
      onChange={p => void persona.choose(p).then(saved => { if (saved && hasPacket) void review(draft.input); })} />}
    {persona.failed && <p role="alert" className="small">That choice could not be saved. Nothing was changed.</p>}
    {asking && <p className="small muted ask-hint">Enter to ask · Esc to cancel</p>}
    {hasPacket && <details className="what-is-sent"><summary>What will be sent</summary>
      <p className="small muted">The selection is frozen: editing the note will not change this request. {providerLabel === 'Claude' ? 'Claude CLI' : providerLabel} · transcript context: none. Redaction can miss prose secrets, unfamiliar or encoded credentials, and indirect identifiers. Review before sending.</p>
      <SkillsReviewList review={(draft.packet as { skills?: SkillsReview }).skills} />
      <details><summary>Exact redacted request</summary><pre>{JSON.stringify(exactRequest(draft.packet), null, 2)}</pre></details></details>}
    {hasPacket && <p className="small muted">{providerLabel} · {selectionLabel((draft.packet as {review?:{modelSettings?:import('../../shared/setup.ts').ModelEffort}}).review?.modelSettings)}. This request uses a fresh CLI context.</p>}
    {hasPacket&&<CodexSkillsReview skills={reviewedSkills}/>}
    {hasPacket && modelNotice && <p className="small muted">{modelNotice}</p>}
    {hasPacket && <p className="small muted ask-hint">{canSendImages?'Enter to send · Esc to cancel':'Confirm the reviewed images before sending.'}</p>}
    {hasPacket&&reviewedCap&&<p className="small muted">{providerLabel} allowance for this request: {reviewedCap.amount.toLocaleString()} {reviewedCap.unit}. Usage is reported after the turn; if it is not reported, the full allowance is charged conservatively. Another request needs a new review.</p>}
    {draft.error && <p role="alert">{draft.error}</p>}
    {draft.warnings?.map(warning => <p role="note" key={warning}>{warning}</p>)}
    <div className="attach-actions">{hasPacket
      ? <button ref={sendRef} disabled={busy||!canSendImages} onClick={() => void send()}>Send to {providerLabel}{reviewedSkills.length?' with reviewed skills':''}</button>
      : <button disabled={busy || imageDraft.loading || (draft.input.action === 'ask' && !draft.input.question.trim())} onClick={() => void review(draft.input)}>Review request</button>}
      <button disabled={busy} onClick={cancelPreview}>Cancel preview</button></div>
  </section> : null;
  const panel = <div className="invocation-panel">
    {jobs.map(j => <div key={j.id} className="invocation-job" data-request-status={j.status}>
      {providerLabel}: {j.status === 'persistence_error' ? 'Answer retained in memory; saving failed.' : ['pending', 'queued'].includes(j.status) ? <Thinking label={j.status === 'queued' ? 'Queued' : 'Thinking'} /> : j.status}
      {j.error && <span role="alert">{j.error}</span>}
      {['pending', 'queued'].includes(j.status) && <button onClick={() => void api.cancelRequest(j.id).catch(() => setJobs(all => all.map(k => k.id === j.id ? { ...k, error: 'Cancellation could not be confirmed.' } : k)))}>Cancel request</button>}
      {j.status === 'persistence_error' && <button onClick={() => void api.retryInkSave(j.id).then(async () => { merge(await api.ink(path)); setJobs(all => all.map(k => k.id === j.id ? { ...k, status: 'complete' } : k)); }).catch(() => {})}>Retry saving answer (no new call)</button>}
      {j.usage&&<span className="small muted">{invokedUsageLabel(j.usage)}</span>}
      {j.notice&&<span role="status">{j.notice}</span>}
    </div>)}
  </div>;
  return { begin, panel, draftId: draft?.input.id ?? null, draftSection };
}
