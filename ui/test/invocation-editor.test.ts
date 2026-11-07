import { EditorState } from '@codemirror/state';
import { expect, it } from 'vitest';
import { freezeInvocation } from '../shared/invocation.ts';
import { inkField, addInk, setInk } from '../src/editor/ink.ts';
import { externalChange } from '../src/editor/session.ts';
const text = 'First paragraph.\n\nSelected sentence.\n\nLast paragraph.\n';
it('maps pending ink through typing and merges an answer without restoring the frozen note', () => {
  const frozen = freezeInvocation({ id: 'frozen', path: 'fixture.md', action: 'think', question: '', text, from: 18, to: 36 });
  const item = { id: frozen.id, kind: 'answer' as const, body: 'Thinking…', anchor: frozen.anchor, originalAnchor: frozen.anchor,
    attachment: { status: 'attached' as const, from: 18, to: 36 } };
  let state = EditorState.create({ doc: text, extensions: [inkField] });
  state = state.update({ effects: addInk.of(item) }).state;
  state = state.update({ changes: { from: 0, insert: 'Typed.\n' } }).state;
  state = state.update({ effects: setInk.of({ items: [{ ...item, body: 'Delayed explanation.' }], trustedText: text }) }).state;
  expect(state.field(inkField).items[0]).toMatchObject({ body: 'Delayed explanation.', attachment: { from: 25, to: 43 } });
  expect(frozen.selection).toBe('Selected sentence.');
  expect(state.doc.toString()).toBe('Typed.\n' + text);
});
it('keeps a delayed answer orphaned after external deletion', () => {
  const frozen = freezeInvocation({ id: 'removed', path: 'fixture.md', action: 'ask', question: 'Explain?', text, from: 18, to: 36 });
  const item = { id: frozen.id, kind: 'answer' as const, body: 'Thinking…', anchor: frozen.anchor, originalAnchor: frozen.anchor,
    attachment: { status: 'attached' as const, from: 18, to: 36 } };
  let state = EditorState.create({ doc: text, extensions: [inkField] });
  state = state.update({ effects: addInk.of(item) }).state;
  state = state.update({ changes: { from: 18, to: 38 }, annotations: externalChange.of(true) }).state;
  state = state.update({ effects: setInk.of({ items: [{ ...item, body: 'Preserved explanation.' }], trustedText: text }) }).state;
  expect(state.field(inkField).items[0]).toMatchObject({ body: 'Preserved explanation.', attachment: { status: 'orphaned' } });
});
it('keeps a preview anchor mapped when a stale unrelated sidecar arrives', () => {
  const f = freezeInvocation({ id: 'preview', path: 'fixture.md', action: 'think', question: '', text, from: 18, to: 36 });
  const item = { id: f.id, kind: 'answer' as const, body: 'Review request…', anchor: f.anchor, originalAnchor: f.anchor,
    attachment: { status: 'attached' as const, from: 18, to: 36 } };
  let state = EditorState.create({ doc: text, extensions: [inkField] });
  state = state.update({ effects: addInk.of(item) }).state;
  state = state.update({ changes: { from: 0, insert: 'New.\n' } }).state;
  state = state.update({ effects: setInk.of({ items: [], trustedText: text }) }).state;
  expect(state.field(inkField).items[0]).toMatchObject({ id: 'preview', attachment: { from: 23, to: 41 } });
});
