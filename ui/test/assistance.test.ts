import { mkdtemp, readFile, writeFile, readdir, rm, unlink, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, expect, it } from 'vitest';
import { Assistance } from '../server/assistance.ts';
import { Store } from '../server/store.ts';
import { InkStore } from '../server/ink-store.ts';
import { captureAnchor } from '../shared/anchors.ts';
import type { Provider, Request, Result } from '../server/providers/index.ts';

const roots: string[] = [];
afterEach(async () => { for (const r of roots.splice(0)) await rm(r, { recursive: true, force: true }); });
const note = '# Fixture\n\nThe selected paragraph is useful.\n\nA different paragraph.\n';
async function fixture(validationRecords?: unknown[]) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aitiarch-invoke-test-')); roots.push(root);
  const bytes = Buffer.from('\uFEFF' + note.replace(/\n/g, '\r\n'));
  await writeFile(path.join(root, 'fixture.md'), bytes);
  const calls: { request: Request; resolve: (r: Result) => void }[] = [];
  const provider: Provider = {
    checkAvailability: async () => ({ available: true }),
    invoke: (request, options) => new Promise((resolve, reject) => {
      calls.push({ request, resolve });
      options?.signal?.addEventListener('abort', () => reject(new Error('cancelled')));
    }),
  };
  const store = await Store.open(root), ink = await InkStore.open(root), service = new Assistance(store, ink, provider, undefined,
    { write: async (record: unknown) => { validationRecords?.push(record); } });
  const from = note.indexOf('The selected'), to = from + 'The selected paragraph is useful.'.length;
  const input = { id: 'request-one', path: 'fixture.md', action: 'think' as const, question: '', text: note, from, to };
  const complete = (n = 0) => calls[n].resolve({ id: calls[n].request.id, provider: 'claude', model: null,
    answer: 'Synthetic explanation.', claims: [], usage: { inputTokens: 30, outputTokens: 5 } });
  return { root, bytes, calls, store, ink, service, input, complete };
}
it('freezes context before awaiting and persists pending v2 ink without changing Markdown bytes', async () => {
  const f = await fixture(); const starting = f.service.start(f.input);
  f.input.text = 'mutated'; f.input.from = 0; f.input.question = 'Changed after clicking';
  await starting;
  expect(f.calls[0].request.selection).toBe('The selected paragraph is useful.');
  expect(f.calls[0].request.note).toBe(note);
  expect(f.calls[0].request.question).toBe('');
  const pending = await f.ink.read('fixture.md');
  expect(pending.document.v).toBe(2); expect(pending.document.lastSeenTextHash).toMatch(/^[a-f0-9]{64}$/);
  expect(pending.document.items[0]).toMatchObject({ id: 'request-one', generation: { status: 'pending', action: 'think' },
    originalAnchor: { quote: 'The selected paragraph is useful.', prefix: '# Fixture\n\n', suffix: '\n\nA different paragraph.\n' } });
  expect(await readFile(path.join(f.root, 'fixture.md'))).toEqual(f.bytes);
  f.complete(); await f.service.wait('request-one');
  expect((await f.ink.read('fixture.md')).document.items[0]).toMatchObject({ body: 'Synthetic explanation.', generation: { status: 'complete', provider: 'claude' } });
  expect(await readFile(path.join(f.root, 'fixture.md'))).toEqual(f.bytes);
});
it('marks a newly written initial answer active before notifying thread reconciliation',async()=>{
 const f=await fixture();let reserved=false;let service!:Assistance;
 service=new Assistance(f.store,f.ink,{name:'claude',checkAvailability:async()=>({available:true}),invoke:async r=>({id:r.id,provider:'claude',model:null,answer:'Synthetic.',claims:[],usage:null})},()=>{reserved=reserved||service.activeIds().has(f.input.id);},{write:async()=>{}});
 await service.start(f.input);await service.wait(f.input.id);expect(reserved).toBe(true);
});
it('maps a delayed answer through an external insertion and survives reload', async () => {
  const f = await fixture(); await f.service.start(f.input);
  await writeFile(path.join(f.root, 'fixture.md'), 'An external insertion.\n\n' + note);
  f.complete(); await f.service.wait(f.input.id);
  const fresh = await InkStore.open(f.root), item = (await fresh.read('fixture.md')).document.items[0];
  expect(item.attachment).toEqual({ status: 'attached', from: f.input.from + 24, to: f.input.to + 24 });
  expect(item.originalAnchor.position.from).toBe(f.input.from);
  expect(f.calls[0].request.note).toBe(note);
});
it('preserves a deleted selection as a re-attachable orphan', async () => {
  const f = await fixture(); await f.service.start(f.input);
  await writeFile(path.join(f.root, 'fixture.md'), '# Fixture\n\nA different paragraph.\n');
  f.complete(); await f.service.wait(f.input.id);
  let s = await f.ink.read('fixture.md');
  expect(s.document.items[0]).toMatchObject({ body: 'Synthetic explanation.', attachment: { status: 'orphaned' } });
  s = await f.ink.attach('fixture.md', f.input.id, s.version, s.document.noteVersion!, 11, 33);
  expect(s.document.items[0].anchorHistory).toContainEqual(s.document.items[0].originalAnchor);
});
it('merges two out-of-order answers and deduplicates shown/dismissed ledger events', async () => {
  const f = await fixture(); await f.service.start(f.input);
  await f.service.start({ ...f.input, id: 'request-two', action: 'ask', question: 'Explain?' });
  f.complete(1); f.complete(0); await Promise.all([f.service.wait(f.input.id), f.service.wait('request-two')]);
  expect((await f.ink.read('fixture.md')).document.items.map(i => i.id)).toEqual(['request-one', 'request-two']);
  expect(await f.service.ledger.read()).toEqual({ v: 1, events: [] });
  await Promise.all([f.service.event('fixture.md', f.input.id, 'shown'), f.service.event('fixture.md', f.input.id, 'shown')]);
  await f.service.event('fixture.md', f.input.id, 'dismissed');
  const ledger = await f.service.ledger.read();
  expect(ledger.events.map(e => e.event)).toEqual(['shown', 'dismissed']);
  expect(Object.keys(ledger.events[0]).sort()).toEqual(['at', 'event', 'id', 'inkId', 'note', 'requestId']);
  expect(JSON.stringify(ledger)).not.toContain('Synthetic explanation');
  expect((await f.ink.read('fixture.md')).document.items[0].generation?.dismissed).toBe(true);
  expect(await readFile(path.join(f.root, 'fixture.md'))).toEqual(f.bytes);
});
it('rejects a disabled provider before persisting or invoking', async () => {
  const f = await fixture(); const service = new Assistance(f.store, f.ink, {
    checkAvailability: async () => ({ available: false, code: 'unsupported_cli', message: 'Isolation not verified.' }),
    invoke: async () => { throw new Error('must not run'); },
  });
  await expect(service.start(f.input)).rejects.toMatchObject({ code: 'unsupported_cli' });
  expect((await f.ink.read('fixture.md')).document.items).toEqual([]);
});
it('caps active requests at two and cancelling queued work never calls the provider', async () => {
  const f = await fixture(); await f.service.start(f.input);
  await f.service.start({ ...f.input, id: 'second' }); await f.service.start({ ...f.input, id: 'third' });
  expect(f.calls.length).toBe(2); await f.service.cancel('third');
  f.complete(0); f.complete(1); await Promise.all([f.service.wait('request-one'), f.service.wait('second'), f.service.wait('third')]);
  expect(f.calls.length).toBe(2);
  expect((await f.ink.read('fixture.md')).document.items.find(i => i.id === 'third')?.generation?.status).toBe('cancelled');
});
it('rejects unverified evidence rather than saving a fabricated claim', async () => {
  const f = await fixture(); await f.service.start(f.input);
  f.calls[0].resolve({ id: f.input.id, provider: 'claude', model: null, answer: 'Unverified answer', claims: [{ sourceId: 'fake', quote: 'invented' }], usage: null });
  await f.service.wait(f.input.id);
  expect((await f.ink.read('fixture.md')).document.items[0]).toMatchObject({ generation: { status: 'error' } });
  expect(await readFile(path.join(f.root, 'ink', 'fixture.ink.json'), 'utf8')).not.toContain('Unverified answer');
});
it('does not create prompt, transcript or snapshot files when cache persistence is off', async () => {
  const f = await fixture(); await f.service.start(f.input); f.complete(); await f.service.wait(f.input.id);
  expect((await readdir(f.root)).sort()).toEqual(['fixture.md', 'ink']);
});
it('keeps an answer in memory after a disk failure and retries only persistence', async () => {
  const f = await fixture(); await f.service.start(f.input);
  const lock = path.join(f.root, 'ink/fixture.ink.json.lock'); await writeFile(lock, 'fixture lock');
  f.complete(); await f.service.wait(f.input.id);
  expect(f.service.status(f.input.id).status).toBe('persistence_error');
  await unlink(lock); await f.service.retrySave(f.input.id);
  expect(f.calls.length).toBe(1);
  expect((await f.ink.read('fixture.md')).document.items[0].body).toBe('Synthetic explanation.');
});
it('maps a frozen request when the disk changed before submission', async () => {
  const f = await fixture(); await writeFile(path.join(f.root, 'fixture.md'), 'New.\n\n' + note);
  await f.service.start(f.input); f.complete(); await f.service.wait(f.input.id);
  const item = (await f.ink.read('fixture.md')).document.items[0];
  expect(item.attachment).toEqual({ status: 'attached', from: f.input.from + 6, to: f.input.to + 6 });
  expect(f.calls[0].request.note).toBe(note);
});
it('preserves an answer when the entire note disappears during the call', async () => {
  const f = await fixture(); await f.service.start(f.input); await unlink(path.join(f.root, 'fixture.md'));
  f.complete(); await f.service.wait(f.input.id);
  expect((await f.ink.read('fixture.md')).document.items[0]).toMatchObject({ body: 'Synthetic explanation.', attachment: { status: 'orphaned', reason: 'note-missing' } });
});
it('rejects oversized provider output as an error instead of an unsaveable answer', async () => {
  const f = await fixture(); await f.service.start(f.input);
  f.calls[0].resolve({ id: f.input.id, provider: 'claude', model: null, answer: 'x'.repeat(100001), claims: [], usage: null });
  await f.service.wait(f.input.id);
  expect(f.service.status(f.input.id).status).toBe('error');
  expect((await f.ink.read('fixture.md')).document.items[0].generation?.status).toBe('error');
});
for(const [rule,patch] of [
  ['result_id',{id:'wrong'}],['result_provider',{provider:'codex'}],['answer_type',{answer:12}],
  ['answer_empty',{answer:'  '}],['answer_length',{answer:'x'.repeat(100001)}],
  ['claims_array',{claims:{}}],['claims_count',{claims:Array(33).fill({})}],['model',{model:'invalid model'}],
  ['claim_source',{claims:[{sourceId:'missing',quote:'Private synthetic'}]}],
  ['claim_quote_type',{claims:[{sourceId:'N1',quotation:'Private synthetic'}]}],
  ['claim_quote_empty',{claims:[{sourceId:'N1',quote:' '}]}],
  ['claim_quote_length',{claims:[{sourceId:'N1',quote:'x'.repeat(241)}]}],
  ['claim_quote_exact',{claims:[{sourceId:'N1',quote:'Private synthetic'}]}],
] as const){
  it(`privately records the first failed product rule: ${rule}`,async()=>{
    const records:unknown[]=[];const f=await fixture(records);await f.service.start(f.input);
    f.calls[0].resolve({id:f.input.id,provider:'claude',model:null,answer:'Private synthetic answer',claims:[],usage:null,...patch} as Result);
    await f.service.wait(f.input.id);
    expect(f.service.status(f.input.id).status).toBe('error');
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({rule,counts:{answerLength:expect.any(Number),claimsCount:expect.any(Number),claimIndex:expect.any(Number)}});
    const row=records[0] as {rule:string;counts:Record<string,number>};
    expect(Object.keys(row).sort()).toEqual(['counts','rule']);
    expect(Object.values(row.counts).every(v=>typeof v==='number'&&Number.isFinite(v))).toBe(true);
    expect(JSON.stringify(row)).not.toMatch(/Private synthetic|invalid model|request-one|fixture.md/);
    expect(await readFile(path.join(f.root,'fixture.md'))).toEqual(f.bytes);
  });
}
it('records unexpected product processing exceptions without retaining exception text',async()=>{
  const records:unknown[]=[];const f=await fixture(records);await f.service.start(f.input);
  const result={id:f.input.id,provider:'claude',model:null,claims:[],usage:null,get answer(){throw new Error('PRIVATE_EXCEPTION_SENTINEL');}};
  f.calls[0].resolve(result as unknown as Result);await f.service.wait(f.input.id);
  expect(records).toMatchObject([{rule:'product_processing'}]);
  expect(JSON.stringify(records)).not.toContain('PRIVATE_EXCEPTION_SENTINEL');
});
it('records ink persistence rejection separately from answer validation',async()=>{
  const records:unknown[]=[];const f=await fixture(records);await f.service.start(f.input);
  const lock=path.join(f.root,'ink/fixture.ink.json.lock');await writeFile(lock,'fixture lock');
  f.complete();await f.service.wait(f.input.id);await unlink(lock);
  expect(f.service.status(f.input.id).status).toBe('persistence_error');
  expect(records).toMatchObject([{rule:'ink_persist'}]);
});
it('maps from the latest verified checkpoint rather than an obsolete request snapshot', async () => {
  const f = await fixture(); await f.service.start(f.input);
  const middle = note.replace('selected paragraph', 'chosen paragraph');
  await writeFile(path.join(f.root, 'fixture.md'), middle);
  const s = await f.ink.read('fixture.md'), file = await f.store.read('fixture.md');
  const from = middle.indexOf('The chosen'), to = from + 'The chosen paragraph is useful.'.length;
  await f.ink.checkpoint('fixture.md', s.version, file.version, [{ id: f.input.id, anchor: captureAnchor(middle, from, to), attachment: { status: 'attached', from, to } }]);
  await writeFile(path.join(f.root, 'fixture.md'), middle + '\nCopy follows.\n\nThe chosen paragraph is useful.\n');
  f.complete(); await f.service.wait(f.input.id);
  expect((await f.ink.read('fixture.md')).document.items[0].attachment).toEqual({ status: 'attached', from, to });
});
it('rejects ledger symlinks without overwriting the target', async () => {
  const f = await fixture(); await f.service.start(f.input); f.complete(); await f.service.wait(f.input.id);
  const other = path.join(f.root, 'other.json'); await writeFile(other, 'evidence');
  try { await symlink(other, path.join(f.root, 'ledger.json')); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'EPERM') return; throw e; }
  await expect(f.service.event('fixture.md', f.input.id, 'shown')).rejects.toThrow();
  expect(await readFile(other, 'utf8')).toBe('evidence');
});

it('persists an optional validated diagram and drops an invalid diagram without rejecting the text',async()=>{
 for(const invalid of [false,true]){const f=await fixture();await f.service.start(f.input);const {cicd}=await import('./fixtures/diagrams.ts');
 f.calls[0].resolve({id:f.input.id,provider:'claude',model:null,answer:'Synthetic diagram answer.',claims:[],usage:null,diagram:invalid?{...cicd,nodes:[]}:cicd});await f.service.wait(f.input.id);
 const item=(await f.ink.read('fixture.md')).document.items[0];expect(item.generation?.status).toBe('complete');expect(item.body).toBe('Synthetic diagram answer.');expect(item.diagram).toEqual(invalid?undefined:cicd);expect(item.diagramIssue).toBe(invalid?'no_nodes':undefined);expect(await readFile(path.join(f.root,'fixture.md'))).toEqual(f.bytes);}
});
