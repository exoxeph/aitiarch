import {renderToStaticMarkup} from 'react-dom/server';
import {expect, it} from 'vitest';
import {ModelPicker} from '../src/chat/ModelPicker.tsx';
import type {SetupView} from '../shared/setup.ts';

const provider = (id: 'claude'|'codex'|'kiro', compatible: boolean, reason: string) =>
 ({id, label: {claude: 'Claude', codex: 'Codex', kiro: 'Kiro'}[id], path: '/fake/' + id, version: '1.0.0', notices: [], compatible, source: 'default' as const, reason});
const base = (over: Partial<SetupView> = {}): SetupView => ({
 ready: true, seen: true, fontSize: null,
 providers: [provider('claude', true, 'Compatible'), provider('codex', true, 'Compatible'), provider('kiro', false, 'Version check failed')],
 roles: [{role: 'normal-chat', provider: 'claude', capableProviders: ['claude', 'codex'], reason: null, source: 'default'}],
 models: [{role: 'normal-chat', provider: 'claude', effortSupported: true, selection: {model: 'sonnet', effort: 'medium'}, effective: {model: 'sonnet', effort: 'medium'}}],
 privacy: {mode: 'private', sharedReady: false, notice: 'filesystem-private'},
 ...over,
});
const render = (view: SetupView, extra: Record<string, unknown> = {}) => renderToStaticMarkup(<ModelPicker view={view} {...extra}/>);

it('renders one compact chip with the requested choice and an accessible name; the popover is closed by default', () => {
 const html = render(base());
 expect(html).toContain('Claude · Sonnet · Medium');
 expect(html).toContain('aria-haspopup="menu"');
 expect(html).toContain('aria-expanded="false"');
 expect(html).not.toContain('role="menu"');
});

it('the open popover lists Default first, then the Claude aliases, a custom ID, and the Codex group', () => {
 const html = render(base(), {defaultOpen: true});
 expect(html).toContain('role="menu"');
 expect(html.indexOf('>Default<')).toBeLessThan(html.indexOf('>opus<'));
 for (const alias of ['opus', 'sonnet', 'haiku', 'fable']) expect(html).toContain(`>${alias}<`);
 expect(html).toContain('Custom model ID');
 expect(html).toContain('>Codex<');
 expect(html).toContain('starts a fresh conversation');
});

it('shows the Effort section only when the CLI declares it', () => {
 expect(render(base(), {defaultOpen: true})).toContain('>Effort<');
 const undeclared = base({models: [{role: 'normal-chat', provider: 'claude', effortSupported: false, selection: null, effective: {model: null, effort: null}}]});
 expect(render(undeclared, {defaultOpen: true})).not.toContain('>Effort<');
});

it('Codex and Kiro show no Effort section', () => {
 const codex = base({roles: [{role: 'normal-chat', provider: 'codex', capableProviders: ['claude', 'codex'], reason: null, source: 'default'}],
  models: [{role: 'normal-chat', provider: 'codex', effortSupported: false, selection: null, effective: {model: null, effort: null}}]});
 const html = render(codex, {defaultOpen: true});
 expect(html).toContain('Codex · Default');
 expect(html).not.toContain('>Effort<');
 const kiro = base({providers: [provider('kiro', true, 'Compatible')], roles: [{role: 'normal-chat', provider: 'kiro', capableProviders: ['kiro'], reason: null, source: 'default'}],
  models: [{role: 'normal-chat', provider: 'kiro', effortSupported: false, selection: null, effective: {model: null, effort: null}}]});
 const kiroHtml = render(kiro, {defaultOpen: true});
 expect(kiroHtml).not.toContain('>Effort<');
 expect(kiroHtml).not.toContain('Custom model ID');
});

it('lists an unavailable provider disabled with the doctor reason and does not make it selectable', () => {
 const html = render(base(), {defaultOpen: true});
 expect(html).toContain('Version check failed');
 const kiro = html.slice(html.indexOf('Kiro'));
 expect(kiro).toContain('aria-disabled="true"');
});

it('never nests a form: it lives inside the chat composer form, whose submit it must not trigger', () => {
 expect(render(base(), {defaultOpen: true})).not.toContain('<form');
});

it('the chip shows the reported model after an answer, or "model not reported"', () => {
 expect(render(base(), {lastAnswer: {model: 'claude-sonnet-synthetic'}})).toContain('claude-sonnet-synthetic');
 expect(render(base(), {lastAnswer: {model: null}})).toContain('model not reported');
 expect(render(base())).not.toContain('model not reported');
});

it('offers a model filter only above eight models, with Default still first', () => {
 const withModels = (count: number) => base({
  providers: [{...provider('claude', true, 'Compatible'), catalog: {
   source: 'cli', checkedAt: null, models: Array.from({length: count}, (_, index) => ({
    id: `demo-${index}`, name: `Demo ${index}`, default: false, efforts: ['low'],
   })),
  }}],
 });
 expect(render(withModels(8), {defaultOpen: true})).not.toContain('aria-label="Filter models"');
 const html = render(withModels(9), {defaultOpen: true});
 expect(html).toContain('aria-label="Filter models"');
 expect(html.indexOf('>Default<')).toBeLessThan(html.indexOf('>Demo 0<'));
});

it('keeps the effort region present with a reason when no choices can be offered', () => {
 const view = base({models: [{role: 'normal-chat', provider: 'claude', effortSupported: false, selection: null, effective: {model: null, effort: null}}]});
 const html = render(view, {defaultOpen: true});
 expect(html).toContain('aria-label="Effort options"');
 expect(html).toContain('This CLI does not offer effort choices.');
});

it('keeps custom ID fields behind a closed disclosure', () => {
 const html = render(base(), {defaultOpen: true});
 expect(html).toMatch(/<details[^>]*><summary[^>]*>Custom model…<\/summary>.*?Custom model ID for Claude/);
 expect(html).not.toMatch(/<details[^>]*\bopen=""/);
});

it('with no capable provider the chip says AI off and cannot be opened', () => {
 const html = render(base({providers: [], roles: [], models: []}), {defaultOpen: true});
 expect(html).toContain('AI off');
 expect(html).toContain('disabled');
 expect(html).not.toContain('role="menu"');
});
