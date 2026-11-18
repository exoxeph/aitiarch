import {renderToStaticMarkup} from 'react-dom/server';
import {expect, it} from 'vitest';
import {SetupPreferences} from '../src/setup/SetupPreferences.tsx';
import type {SetupView} from '../shared/setup.ts';

const view: SetupView = {
 ready: true, seen: true, fontSize: 18,
 providers: [{id: 'claude', label: 'Claude', path: '/fake/claude', version: '1.0.0', notices: [], compatible: true, source: 'default', reason: 'Compatible'}],
 roles: [{role: 'normal-chat', provider: 'claude', capableProviders: ['claude'], reason: null, source: 'default'}],
 models: [{role: 'normal-chat', provider: 'claude', effortSupported: true, selection: null, effective: {model: null, effort: null}}],
 privacy: {mode: 'private', sharedReady: false, notice: 'filesystem-private'},
};

it('Settings keeps only the editor font size and points to the chat box for the model', () => {
 const html = renderToStaticMarkup(<SetupPreferences view={view} onChange={() => {}}/>);
 expect(html).toContain('Choose the model in the chat box');
 expect(html).toContain('Font size');
 expect(html).toContain('min="14"');
 expect(html).toContain('max="24"');
 for (const word of ['Models and effort', 'Effort', 'Custom ID', 'Inherit provider', 'Save model']) expect(html).not.toContain(word);
});
