import {expect, it} from 'vitest';
import {applyChoice, chatChoiceModel, chipLabel, planChoice} from '../shared/model-choice.ts';
import type {ChatReview} from '../shared/chat.ts';
import type {SetupUpdate, SetupView} from '../shared/setup.ts';

const provider = (id: 'claude'|'codex'|'kiro', compatible: boolean, reason: string) =>
 ({id, label: {claude: 'Claude', codex: 'Codex', kiro: 'Kiro'}[id], path: '/fake/' + id, version: '1.0.0', notices: [], compatible, source: 'default' as const, reason});
const role = (name: SetupView['roles'][number]['role'], current: 'claude'|'codex'|null, capable: ('claude'|'codex'|'kiro')[]) =>
 ({role: name, provider: current, capableProviders: capable, reason: null, source: 'default' as const});
function view(over: Partial<SetupView> = {}): SetupView {
 return {
  ready: true, seen: true, fontSize: null,
  providers: [provider('claude', true, 'Compatible'), provider('codex', true, 'Compatible'), provider('kiro', false, 'Version check failed')],
  roles: [role('normal-chat', 'claude', ['claude', 'codex']), role('invoked', 'claude', ['claude'])],
  models: [{role: 'normal-chat', provider: 'claude', effortSupported: true, selection: {model: 'sonnet', effort: 'medium'}, effective: {model: 'sonnet', effort: 'medium'}}],
  privacy: {mode: 'private', sharedReady: false, notice: 'filesystem-private'},
  ...over,
 };
}
const codexView = () => view({
 roles: [role('normal-chat', 'codex', ['claude', 'codex'])],
 models: [{role: 'normal-chat', provider: 'codex', effortSupported: false, selection: null, effective: {model: null, effort: null}}],
});
const deepFreeze = <T,>(value: T): T => {
 if (value && typeof value === 'object') {Object.freeze(value); for (const item of Object.values(value)) deepFreeze(item);}
 return value;
};

it('lists only compatible providers that have the role capability; others are disabled with the doctor reason', () => {
 const model = chatChoiceModel(view());
 expect(model.groups.filter(g => g.available).map(g => g.id)).toEqual(['claude', 'codex']);
 const kiro = model.groups.find(g => g.id === 'kiro')!;
 expect(kiro.available).toBe(false);
 expect(kiro.reason).toBe('Version check failed');
 expect(kiro.options).toEqual([]);
 const incapable = chatChoiceModel(view({roles: [role('normal-chat', 'claude', ['claude'])]}));
 expect(incapable.groups.find(g => g.id === 'codex')!.available).toBe(false);
});

it('puts Default first for every provider; Claude has the four aliases and a custom ID, Codex custom only, Kiro Default only', () => {
 const groups = chatChoiceModel(view()).groups;
 const claude = groups.find(g => g.id === 'claude')!, codex = groups.find(g => g.id === 'codex')!;
 expect(claude.options.map(o => o.model)).toEqual([null, 'opus', 'sonnet', 'haiku', 'fable']);
 expect(claude.options[0].label).toBe('Default');
 expect(codex.options.map(o => o.model)).toEqual([null]);
 expect(claude.customAllowed && codex.customAllowed).toBe(true);
 const kiroView = view({providers: [provider('kiro', true, 'Compatible')], roles: [role('normal-chat', null, ['kiro'])], models: []});
 const kiro = chatChoiceModel(kiroView).groups[0];
 expect(kiro.options.map(o => o.model)).toEqual([null]);
 expect(kiro.customAllowed).toBe(false);
});

it('hides effort when its CLI transport is unsupported, even when Codex advertises levels', () => {
 expect(chatChoiceModel(view()).effortSupported).toBe(true);
 expect(chatChoiceModel(codexView()).effortSupported).toBe(false);
 const codex=codexView();
 codex.providers.find(p=>p.id==='codex')!.catalog={source:'cli',checkedAt:100,models:[{id:'fake',name:'Fake',default:true,efforts:['medium']}]};
 expect(chatChoiceModel(codex)).toMatchObject({efforts:[],effortReason:'Effort not supported by this Codex version.'});
 const undeclared = view({models: [{role: 'normal-chat', provider: 'claude', effortSupported: false, selection: null, effective: {model: null, effort: null}}]});
 expect(chatChoiceModel(undeclared).effortSupported).toBe(false);
 const kiroOnly = view({providers: [provider('kiro', true, 'Compatible')], roles: [role('normal-chat', null, ['kiro'])], models: []});
 expect(chatChoiceModel(kiroOnly).effortSupported).toBe(false);
});

it('Default is an explicit null override, never an inherit', () => {
 const plan = planChoice(chatChoiceModel(view()), {provider: 'claude', model: null, effort: null});
 expect(plan).toMatchObject({ok: true});
 if (!plan.ok) throw new Error('unreachable');
 expect(plan.updates.at(-1)).toEqual({role: 'normal-chat', provider: 'claude', selection: {model: null, effort: null}});
});

it('switching provider writes the role assignment first, then the selection for that provider', () => {
 const plan = planChoice(chatChoiceModel(view()), {provider: 'codex', model: null, effort: null});
 if (!plan.ok) throw new Error('expected ok');
 expect(plan.updates).toEqual([
  {role: 'normal-chat', provider: 'codex'},
  {role: 'normal-chat', provider: 'codex', selection: {model: null, effort: null}},
 ]);
 expect(plan.startsFresh).toBe(true);
});

it.each(['', '--model x', '../etc', 'a b', 'x;rm', '-bad', 'a'.repeat(101)])('refuses invalid custom ID %j with a notice and no write', async id => {
 const writes: SetupUpdate[] = [];
 const outcome = await applyChoice(chatChoiceModel(view()), {provider: 'claude', model: id, effort: null}, async update => {writes.push(update); return view();});
 expect(outcome.ok).toBe(false);
 if (outcome.ok) throw new Error('unreachable');
 expect(outcome.notice).toMatch(/model ID/);
 expect(writes).toEqual([]);
});

it('refuses effort the CLI did not declare and effort for Codex; refuses a provider that is not available', async () => {
 const writes: SetupUpdate[] = [];
 const save = async (update: SetupUpdate) => {writes.push(update); return view();};
 expect((await applyChoice(chatChoiceModel(codexView()), {provider: 'codex', model: null, effort: 'high'}, save)).ok).toBe(false);
 const undeclared = view({models: [{role: 'normal-chat', provider: 'claude', effortSupported: false, selection: null, effective: {model: null, effort: null}}]});
 expect((await applyChoice(chatChoiceModel(undeclared), {provider: 'claude', model: 'sonnet', effort: 'high'}, save)).ok).toBe(false);
 expect((await applyChoice(chatChoiceModel(view()), {provider: 'kiro', model: null, effort: null}, save)).ok).toBe(false);
 expect(writes).toEqual([]);
});

it('a changed choice invalidates a pending review without rewriting it; the same choice writes nothing', async () => {
 const pending = deepFreeze<ChatReview>({reviewId: 'r', requestId: 'q', path: 'synthetic.md', question: 'Synthetic?', selection: '', sources: [], historyPairs: 0, omittedPairs: 0,
  instruction: 'Synthetic rules.', history: [], estimatedTokens: 10, requiresConfirmation: true, provider: 'claude', modelSettings: {model: 'sonnet', effort: 'medium'}});
 const writes: SetupUpdate[] = [];
 const save = async (update: SetupUpdate) => {writes.push(update); return view();};
 const changed = await applyChoice(chatChoiceModel(deepFreeze(view())), {provider: 'claude', model: 'opus', effort: 'medium'}, save);
 expect(changed).toMatchObject({ok: true, invalidates: true});
 expect(writes).toHaveLength(1);
 expect(pending.modelSettings).toEqual({model: 'sonnet', effort: 'medium'});
 const same = await applyChoice(chatChoiceModel(view()), {provider: 'claude', model: 'sonnet', effort: 'medium'}, save);
 expect(same).toMatchObject({ok: true, invalidates: false});
 expect(writes).toHaveLength(1);
});

it('changing the choice makes no network request and calls only the injected setup write', async () => {
 const original = globalThis.fetch;
 let requests = 0;
 globalThis.fetch = (() => {requests++; return Promise.reject(new Error('no network in this test'));}) as typeof fetch;
 try {
  const writes: SetupUpdate[] = [];
  const outcome = await applyChoice(chatChoiceModel(view()), {provider: 'codex', model: 'gpt-synthetic', effort: null}, async update => {writes.push(update); return codexView();});
  expect(outcome.ok).toBe(true);
  expect(requests).toBe(0);
  expect(writes.map(w => 'selection' in w ? 'model' : 'provider')).toEqual(['provider', 'model']);
 } finally {globalThis.fetch = original;}
});

it('a failed write reports the notice and does not claim success', async () => {
 const outcome = await applyChoice(chatChoiceModel(view()), {provider: 'claude', model: 'opus', effort: null}, async () => {throw new Error('The assigned provider changed. Reopen setup and try again.');});
 expect(outcome).toEqual({ok: false, notice: 'The assigned provider changed. Reopen setup and try again.'});
});

it('the chip names the requested choice and, after an answer, the reported model or "model not reported"', () => {
 expect(chipLabel(chatChoiceModel(view()))).toBe('Claude · Sonnet · Medium');
 expect(chipLabel(chatChoiceModel(codexView()))).toBe('Codex · Default');
 expect(chipLabel(chatChoiceModel(view()), {model: 'claude-sonnet-synthetic'})).toContain('claude-sonnet-synthetic');
 expect(chipLabel(chatChoiceModel(view()), {model: null})).toContain('model not reported');
 expect(chipLabel(chatChoiceModel(view()), null)).not.toContain('model not reported');
 expect(chipLabel(chatChoiceModel(view({providers: [], roles: [], models: []})))).toBe('AI off');
});
