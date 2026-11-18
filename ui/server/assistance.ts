import type {Diagram,DiagramIssue} from '../shared/diagram.ts';
import { randomUUID } from 'node:crypto';
import { mapInkItems } from '../shared/anchor-mapping.ts';
import { freezeInvocation, type Invocation } from '../shared/invocation.ts';
import type { InkItem, Generation } from '../shared/ink.ts';
import { InkStore, type InkSnapshot } from './ink-store.ts';
import { textHash } from './anchor-cache.ts';
import { Store } from './store.ts';
import { normalizeRel, PathError } from './paths.ts';
import { SkillDiagramStore } from './skill-diagram-store.ts';
import { SKILL_DIAGRAM_FAILED_BODY, SKILL_DIAGRAM_MAX_BYTES, extractDocument, skillDiagramBody, skillDiagramFallbackBody, type SkillDiagramRef } from '../shared/skill-diagram.ts';
import { sanitizeSvgDocument } from '../shared/svg-sanitize.ts';
import { appendLedger, LedgerStore } from './ledger-store.ts';
import {validCatalogModelId} from '../shared/models.ts';
import { prepareRequest, ProviderError, redact, type Provider, type Request } from './providers/index.ts';
import { ProductValidationError, validateProductResult, validationCounts, type ValidationLog, type ValidationRecord } from './product-validation.ts';
import { privateValidationLog } from './providers/failure-metrics.ts';
import type { ExtrasFor } from './node-settings.ts';
import { nodeFor, SKILLS_ONLY_WITH_SKILL_RENDERER, type SkillsReview } from '../shared/node-settings.ts';
import type {CouncilCap} from '../shared/council.ts';
import type {InvokedUsage} from '../shared/invoked-usage.ts';
import type {RoleRouting} from './providers/routing.ts';
import {ProviderReviews,type ReviewedInvocation} from './providers/invoked-review.ts';

const invocationFingerprint=(v:Invocation)=>textHash(JSON.stringify([v.id,v.path,v.action,v.question,v.text,v.from,v.to,v.renderer,v.skill]));

interface Job { path: string; controller: AbortController; done: Promise<void>; run: () => Promise<void>; status: 'queued' | 'pending' | 'complete' | 'error' | 'cancelled' | 'persistence_error'; retry?: () => Promise<void>;usage?:InvokedUsage;notice?:string }
export class Assistance {
  readonly ledger: LedgerStore;
  /** Saved skill diagrams (the Skill renderer). */
  readonly skillDiagrams: SkillDiagramStore;
  private jobs = new Map<string, Job>();
  private starting = new Set<string>();
  private active = 0;
  private writes: Promise<unknown> = Promise.resolve();
  private store: Store;
  private ink: InkStore;
  private provider: Provider;
  private notify: (path: string) => void;
  private readonly validationLog:ValidationLog;
  private readonly routing?:RoleRouting;
  private reviews:ProviderReviews;
  private skillReviews:ProviderReviews;
  constructor(store: Store, ink: InkStore, provider: Provider, notify: (path: string) => void = () => {}, validationLog:ValidationLog=privateValidationLog(), extras?: ExtrasFor,routing?:RoleRouting) {
    this.routing=routing;
    this.reviews=new ProviderReviews('invoked',routing,provider);
    this.skillReviews=new ProviderReviews('skill-diagram',routing,provider);
    this.validationLog=validationLog;this.extras=extras;
    this.store = store; this.ink = ink; this.provider = provider; this.notify = notify;
    this.ledger = new LedgerStore(store.rootReal);
    this.skillDiagrams = new SkillDiagramStore(store.rootReal);
  }
  /** The Skill renderer needs Claude, and a skill attached to Visualize that actually loaded. Refused before anything is sent. */
  private checkSkillRenderer(renderer: string | undefined, request: Request,providerName=this.provider.name) {
    if (renderer !== 'skill') return;
    if (providerName && providerName !== 'claude') throw new PathError(409, 'skill_renderer', 'The Skill renderer works with Claude only for now. Use the Built-in renderer.');
    if (!request.skills) throw new PathError(409, 'skill_renderer', 'Attach a skill to Visualize in Settings first, then choose Skill.');
  }
  /** What the model's reply becomes: a saved document, or a fixed reason. None of the model's own words are kept. */
  private async acceptSkillDiagram(result: Awaited<ReturnType<Provider['invoke']>>, id: string, skills: string[]) {
    if (result.id !== id || typeof result.answer !== 'string') throw new ProviderError('invalid_response');
    const model = result.model === null || (typeof result.model === 'string' && /^[\w.:-]{1,100}$/.test(result.model)) ? result.model : null;
    const failed = (code: DiagramIssue) => ({ body: SKILL_DIAGRAM_FAILED_BODY, model, skillDiagram: undefined as SkillDiagramRef | undefined, diagramIssue: code as DiagramIssue | undefined });
    const document = extractDocument(redact(result.answer));
    if (!document) return failed('skill_no_document');
    // A static image is the product: only the sanitizer's rebuilt svg is kept. The page itself is saved (for a click-only interactive version) only when no valid svg could be made.
    const svg = sanitizeSvgDocument(document);
    if (svg.ok) return { body: skillDiagramBody(skills), model, skillDiagram: await this.skillDiagrams.saveSvg(svg.svg) as SkillDiagramRef | undefined, diagramIssue: undefined as DiagramIssue | undefined };
    // No image could be made. The page itself can be kept for the click-only interactive version, but only if it fits the 300 KB the store allows.
    if (Buffer.byteLength(document) > SKILL_DIAGRAM_MAX_BYTES) return failed('skill_too_large');
    return { body: skillDiagramFallbackBody(skills, svg.reason), model, skillDiagram: { ...await this.skillDiagrams.saveHtml(document), why: svg.reason } as SkillDiagramRef | undefined, diagramIssue: undefined as DiagramIssue | undefined };
  }
  async availability(renderer?:string|null) {
    try{const selection=await (renderer==='skill'?this.skillReviews:this.reviews).selection();
      if(selection?.provider.id==='codex')return {available:true,provider:'codex'};
      return { ...await this.provider.checkAvailability(), provider:this.provider.name??'claude' };
    }catch(e){return {available:false,provider:'unavailable',code:'unsupported_cli',message:e instanceof PathError?e.message:'Provider settings could not be verified. No provider was selected.'};}
  }
  private extras?: ExtrasFor;
  /** The node's persona goes on every request; its skills only when something loaded. Names are what gets recorded on the answer. */
  private async withExtras(base: Request, pick?: string): Promise<{ request: Request; names: string[]; review: SkillsReview | null }> {
    if (!this.extras) return { request: base, names: [], review: null };
    const node = nodeFor(base.action, base.question), e = await (node === 'visualize' && base.render === 'skill' ? this.extras(node, { id: pick }) : this.extras(node));
    // Skills attached to Visualize belong to the Skill renderer. The Built-in renderer draws from the app's own JSON spec and carries none of them.
    if (node === 'visualize' && base.render !== 'skill') return { request: { ...base, persona: e.persona }, names: [],
      review: e.review ? { loaded: [], skipped: [], missing: [], note: SKILLS_ONLY_WITH_SKILL_RENDERER } : null };
    return { request: { ...base, persona: e.persona, ...(e.skills.loaded.length ? { skills: e.skills } : {}) }, names: e.names, review: e.review };
  }
  async preview(input: Invocation): Promise<ReturnType<typeof prepareRequest> & { skills?: SkillsReview;review?:{id:string;provider:string;cap:CouncilCap|null;modelSettings:import('../shared/setup.ts').ModelEffort;modelNotice?:string} }> {
    const frozen = freezeInvocation(input);
    const reviews=frozen.renderer==='skill'?this.skillReviews:this.reviews;
    const selected=await reviews.selection();
    const { request, review } = await this.withExtras({ id: frozen.id, action: frozen.action, question: frozen.question,
      selection: frozen.selection, note: frozen.text, decisions: [], turns: [], ...(frozen.renderer === 'skill' ? { render: 'skill' as const } : {}) }, frozen.skill);
    this.checkSkillRenderer(frozen.renderer, request,selected?.provider.id==='codex'?'codex':this.provider.name);
    const packet = prepareRequest(request);
    // The instruction in the packet is the exact text; "skills" beside it says what was loaded, skipped or not installed.
    const prepared=review?{...packet,skills:review}:packet;
    if(!selected)return prepared;
    return {...prepared,review:reviews.issue(selected,invocationFingerprint(frozen),packet)};
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
    if (this.jobs.has(frozen.id)||this.starting.has(frozen.id)) throw new Error('Request ID already exists.');
    const { request, names } = await this.withExtras({ id: frozen.id, action: frozen.action, question: frozen.question, selection: frozen.selection,
      note: frozen.text, decisions: [], turns: [], ...(frozen.renderer === 'skill' ? { render: 'skill' as const } : {}) }, frozen.skill);
    // Transcript context stays none. Optional source selection is a later slice;
    // never discover a user's global sessions or transmit one implicitly.
    const packet = prepareRequest(request);
    const reviews=frozen.renderer==='skill'?this.skillReviews:this.reviews;
    let provider=this.provider,reviewed:ReviewedInvocation|undefined;
    if(this.routing){
      reviewed=await reviews.consume(frozen.reviewId,invocationFingerprint(frozen),packet);
      provider=reviews.provider(reviewed,this.ledger,{id:frozen.id,requestId:frozen.id,note:path},(usage,notice)=>{job.usage=usage;if(notice)job.notice=notice;});
    }
    this.checkSkillRenderer(frozen.renderer,request,provider.name);
    const availability = await provider.checkAvailability();
    if (!availability.available) throw new ProviderError(availability.code, availability.message);
    const pending: InkItem = { id: frozen.id, kind: 'answer', body: 'Thinking…', originalAnchor: frozen.anchor, anchor: frozen.anchor,
      attachment: { status: 'attached', from: frozen.from, to: frozen.to }, generation: { requestId: frozen.id, action: frozen.action,
        provider: provider.name??'claude', model: null, createdAt: new Date().toISOString(), status: 'pending', evidence: [], dismissed: false, ...(names.length ? { skills: names } : {}) } };
    // Map the newly captured item too if disk changed after the click.
    if(this.jobs.has(frozen.id)||this.starting.has(frozen.id))throw new Error('Request ID already exists.');
    this.starting.add(frozen.id);
    const snapshot = await this.mutate(path, frozen.text, (items, text) => {
      if (items.some(i => i.id === frozen.id)) throw new Error('Request ID already exists.');
      return [...items, text === null ? { ...pending, attachment: { status: 'orphaned' as const, reason: 'note-missing' as const } }
        : text === frozen.text ? pending : mapInkItems(frozen.text, text, [pending])[0]];
    }).catch(e=>{this.starting.delete(frozen.id);throw e;});
    // The first write requires the current note range. When it changed before
    // submission, retrying via the normal mapping is handled below in mutate.
    const controller = new AbortController();
    let finish!: () => void;
    const job: Job = { path, controller, status: 'queued', done: new Promise(resolve => { finish = resolve; }), run: async () => {
      let body = '', status: Generation['status'] = 'complete', model: string | null = null, evidence: Generation['evidence'] = [];
      let diagram:Diagram|undefined,diagramIssue:DiagramIssue|undefined,skillDiagram:SkillDiagramRef|undefined;
      let resultReceived=false,result:Awaited<ReturnType<Provider['invoke']>>|undefined;
      const record=async(row:ValidationRecord)=>{try{await this.validationLog.write(row);}catch{/* Metrics never change acceptance or persistence. */}};
      try {
        if (controller.signal.aborted) throw new ProviderError('cancelled');
        if(reviewed)await reviews.assert(reviewed);
        result = await provider.invoke(request, { signal: controller.signal });resultReceived=true;
        if (controller.signal.aborted) throw new ProviderError('cancelled');
        if (request.render === 'skill') {
          const selection=reviewed?.provider.selection;
          const saved=await appendLedger(this.ledger,{id:randomUUID(),inkId:frozen.id,requestId:frozen.id,note:path,
            event:'skill_diagram_turn',at:new Date().toISOString(),skillTurn:{model:selection?.model??null,effort:selection?.effort??null,
              reportedModel:validCatalogModelId(result.model)?result.model:null}});
          if(!saved)job.notice='The Skill diagram ledger entry is queued for retry.';
          ({ body, model, skillDiagram, diagramIssue } = await this.acceptSkillDiagram(result, frozen.id, names));
        }
        else ({body,model,evidence,diagram,diagramIssue}=validateProductResult(result,frozen.id,packet.data,redact,textHash,provider.name??'claude'));
      } catch (e) {
        if(e instanceof ProductValidationError)await record(e.record);
        else if(e instanceof ProviderError&&e.validation)await record(e.validation);
        else if(resultReceived&&!controller.signal.aborted)await record({rule:'product_processing',counts:validationCounts(result)});
        status = controller.signal.aborted ? 'cancelled' : 'error';
        body = status === 'cancelled' ? 'Request cancelled. No automatic retry.' : e instanceof ProviderError||e instanceof ProductValidationError||e instanceof PathError ? e.message : 'Request failed. No automatic retry.';
        evidence = []; model = null;
      }
      const persist = async () => {
        try {
          await this.mutate(path, frozen.text, items => items.map(i => i.id === frozen.id ? { ...i, body,
            ...(diagram?{diagram}:{}),...(skillDiagram?{skillDiagram}:{}),...(diagramIssue?{diagramIssue}:{}), generation: { ...i.generation!, status, model, evidence } } : i));
        }catch(error){await record({rule:'ink_persist',counts:validationCounts(result)});throw error;}
        job.status = status; job.retry = undefined;
      };
      try { await persist(); } catch { job.status = 'persistence_error'; job.retry = persist; }
      finally { job.run = async () => {}; finish(); }
    } };
    this.jobs.set(frozen.id, job); this.starting.delete(frozen.id);this.pump(); return snapshot;
  }
  private pump() {
    for (const job of this.jobs.values()) if (this.active < 2 && job.status === 'queued') {
      job.status = 'pending'; this.active++;
      void job.run().finally(() => { this.active--; this.pump(); });
    }
  }
  status(id: string) { const j = this.jobs.get(id); if (!j) throw new Error('Request not found or interrupted by server restart.'); return { id, path: j.path, status: j.status,...(j.usage?{usage:j.usage}:{}),...(j.notice?{notice:j.notice}:{}) }; }
  activeIds() { return new Set([...this.starting,...[...this.jobs].filter(([,j])=>['queued','pending','persistence_error'].includes(j.status)).map(([id])=>id)]); }
  async close() {for(const id of this.activeIds())await this.cancel(id);await Promise.allSettled([...this.jobs.values()].map(j=>j.done));}
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
    await appendLedger(this.ledger,{ id: randomUUID(), inkId: id, requestId: item.generation.requestId, note, event, at: new Date().toISOString() });
  }
}
