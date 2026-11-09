// Model-shaped near misses (synthetic: no rejected real spec was ever recorded, and no notebook text is used here).
import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkDiagram, diagramInstruction, diagramIssueText, isDiagramIssue, normalizeDiagram, prepareDiagram, visualizeInstruction, wantsDiagram, VISUALIZE_QUESTION } from '../shared/diagram.ts';
import { captureDiagram, MAX_FILE_BYTES, MAX_SPEC_BYTES } from '../server/diagram-debug.ts';
import { prepareRequest } from '../server/providers/index.ts';

const N = (id: string, label: string, extra: object = {}) => ({ id, label, ...extra });
const E = (id: string, from: string, to: string, label?: string) => ({ id, from, to, ...(label ? { label } : {}) });
const base = (over: object = {}) => ({ version: 1, type: 'flow', title: 'Request flow', caption: 'How a request moves', nodes: [N('a', 'Start'), N('b', 'End')], edges: [E('e1', 'a', 'b')], focus: [], ...over });

const nearMisses: [string, unknown, (d: any) => void][] = [
  ['label over 64 characters', base({ nodes: [N('a', 'x'.repeat(90)), N('b', 'End')] }), (d) => expect(d.nodes[0].label.length).toBe(64)],
  ['arrow characters in a label', base({ nodes: [N('a', 'A -> B => C'), N('b', 'End')] }), (d) => expect(d.nodes[0].label).toBe('A → B → C')],
  ['angle brackets in a label', base({ nodes: [N('a', 'if x < 3 and y > 2'), N('b', 'End')] }), (d) => expect(d.nodes[0].label).not.toMatch(/[<>]/)],
  ['a URL in a label', base({ nodes: [N('a', 'Docs (https://example.test/x) here'), N('b', 'End')] }), (d) => expect(d.nodes[0].label).not.toMatch(/https?:/)],
  ['a markdown link in a label', base({ nodes: [N('a', 'See [the guide](https://example.test)'), N('b', 'End')] }), (d) => expect(d.nodes[0].label).toBe('See the guide')],
  ['unknown top-level field', base({ direction: 'LR', svg: '<svg/>' }), (d) => expect(Object.keys(d)).not.toContain('svg')],
  ['unknown node field', base({ nodes: [{ id: 'a', label: 'A', group: 'g', html: '<b>x</b>' }, N('b', 'B')] }), (d) => expect(d.nodes[0]).toEqual({ id: 'a', label: 'A' })],
  ['duplicate focus ids', base({ focus: ['a', 'a', 'e1'] }), (d) => expect(d.focus).toEqual(['a', 'e1'])],
  ['focus id that does not exist', base({ focus: ['a', 'ghost'] }), (d) => expect(d.focus).toEqual(['a'])],
  ['an id shared by a node and an edge', base({ edges: [E('a', 'a', 'b')] }), (d) => expect(new Set([...d.nodes, ...d.edges].map((x: any) => x.id)).size).toBe(3)],
  ['ids that start with a digit or contain spaces', base({ nodes: [N('1 step', 'A'), N('2 step', 'B')], edges: [E('3', '1 step', '2 step')] }), (d) => expect(d.edges[0].from).toBe(d.nodes[0].id)],
  ['an edge to a node that does not exist', base({ edges: [E('e1', 'a', 'b'), E('e2', 'a', 'nowhere')] }), (d) => expect(d.edges).toHaveLength(1)],
  ['more than 15 nodes', base({ nodes: Array.from({ length: 20 }, (_, i) => N('n' + i, 'Node ' + i)), edges: [E('e1', 'n0', 'n19')] }), (d) => expect(d.nodes).toHaveLength(15)],
  ['more than 25 edges', base({ edges: Array.from({ length: 40 }, (_, i) => E('e' + i, 'a', 'b')) }), (d) => expect(d.edges).toHaveLength(25)],
  ['a tree where a node has two parents', base({ type: 'tree', nodes: [N('r', 'R'), N('a', 'A'), N('b', 'B')], edges: [E('e1', 'r', 'a'), E('e2', 'r', 'b'), E('e3', 'a', 'b')] }), (d) => expect(d.type).toBe('flow')],
  ['a comparison with edges', base({ type: 'comparison', nodes: [N('a', 'A'), N('b', 'B')], edges: [E('e1', 'a', 'b')] }), (d) => expect(d.edges).toEqual([])],
  ['a comparison with 8 items', base({ type: 'comparison', nodes: Array.from({ length: 8 }, (_, i) => N('c' + i, 'Option ' + i)), edges: [] }), (d) => expect(d.type).toBe('layers')],
  ['type spelled as flowchart', base({ type: 'Flowchart' }), (d) => expect(d.type).toBe('flow')],
  ['a caption that is too long', base({ caption: 'c'.repeat(300) }), (d) => expect(d.caption.length).toBe(160)],
  ['missing title and caption', base({ title: undefined, caption: undefined }), (d) => { expect(d.title).toBe('Diagram'); expect(d.caption).toBe('Diagram'); }],
  ['groups that overlap and name missing nodes', base({ groups: [{ id: 'g1', label: 'One', nodeIds: ['a', 'ghost'] }, { id: 'g2', label: 'Two', nodeIds: ['a', 'b'] }] }), (d) => expect(d.groups.flatMap((g: any) => g.nodeIds).sort()).toEqual(['a', 'b'])],
  ['an invalid node kind', base({ nodes: [N('a', 'A', { kind: 'database' }), N('b', 'B')] }), (d) => expect(d.nodes[0].kind).toBeUndefined()],
];

describe('diagram repair', () => {
  it.each(nearMisses)('strict rejects but repair accepts: %s', (_name, spec, extra) => {
    expect(checkDiagram(spec).ok).toBe(false);
    const r = prepareDiagram(spec);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(checkDiagram(r.diagram).ok).toBe(true); // what comes out always passes the unchanged strict check
      extra(r.diagram);
    }
  });
  it('a diagram that is already valid is returned untouched, with no repair notes', () => {
    const r = prepareDiagram(base());
    expect(r.ok && r.notes).toBeNull();
  });
  it.each([['not an object', 'text'], ['an array', []], ['no nodes array', { version: 1 }], ['empty nodes', base({ nodes: [] })], ['nodes with neither label nor id', base({ nodes: [{}, 5, null] })]])('cannot be repaired: %s', (_n, spec) => {
    const r = prepareDiagram(spec);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(isDiagramIssue(r.code)).toBe(true);
  });
  it('repair only removes or shortens: no markup, links or control characters survive, whatever the input', () => {
    const nasty = ['<script>alert(1)</script>', 'javascript:alert(1)', 'data:text/html;base64,AAAA', 'mailto:a@b.c', 'file:///etc/passwd', 'www.example.test/x', '[x](javascript:y)', 'line\nbreak\u0000nul', 'a<b>c', '<svg onload=y>'];
    for (const label of nasty) {
      const r = prepareDiagram(base({ title: label, caption: label, nodes: [N('a', label, { detail: label }), N('b', label)], edges: [E('e1', 'a', 'b', label)] }));
      if (!r.ok) continue;
      const text = JSON.stringify([r.diagram.title, r.diagram.caption, ...r.diagram.nodes.flatMap((n) => [n.label, n.detail]), ...r.diagram.edges.map((e) => e.label)]);
      expect(text).not.toMatch(/[<>]|\\u0000|\\n/);
      expect(text).not.toMatch(/(?:[a-z][a-z0-9+.-]*:\/\/|www\.|(?:javascript|data|mailto|file):)/i);
    }
  });
  it('the output is at most 16 KiB even for an oversized input', () => {
    const big = base({ nodes: Array.from({ length: 15 }, (_, i) => N('n' + i, 'L'.repeat(64), { detail: 'D'.repeat(200) })), edges: [] });
    const r = prepareDiagram(big);
    expect(r.ok).toBe(true);
    if (r.ok) expect(new TextEncoder().encode(JSON.stringify(r.diagram)).length).toBeLessThanOrEqual(16384);
  });
  it('the rejection reason is a fixed code and a path, never model text', () => {
    const r = checkDiagram(base({ nodes: [N('a', 'x'.repeat(70)), N('b', 'B')] }));
    expect(r).toEqual({ ok: false, code: 'node_label', path: 'nodes[0].label' });
    expect(diagramIssueText('node_label')).toBe('a node label is too long or unsafe');
    expect(diagramIssueText('invalid')).toBe('invalid format');
    expect(diagramIssueText('<svg onload=x>')).toBe('invalid format');
    expect(normalizeDiagram('nope')).toBeNull();
  });
});

describe('Visualize and explicit drawing words', () => {
  it.each([['draw this'], ['Please diagram the flow'], ['visualize it'], ['Visualise the steps'], ['sketch the idea'], ['make a flowchart'], ['flow-chart of it'], [VISUALIZE_QUESTION]])('%s is an explicit request', (q) => expect(wantsDiagram(q)).toBe(true));
  it.each([['What is the risk?'], ['redrawn pages'], ['Explain the update'], ['']])('%s is not', (q) => expect(wantsDiagram(q)).toBe(false));
  const req = (question: string, selection: string, action: 'think' | 'ask' = 'ask') => ({ id: 'r1', action, question, selection, note: 'Note text', decisions: [], turns: [] });
  it('the Visualize question, or drawing words in the question or the selection, switch to the required-diagram wording', () => {
    expect(prepareRequest(req(VISUALIZE_QUESTION, 'Some text')).instruction).toContain(visualizeInstruction);
    expect(prepareRequest(req('Can you sketch this?', 'Some text')).instruction).toContain(visualizeInstruction);
    expect(prepareRequest(req('', 'Please draw the architecture here.', 'think')).instruction).toContain(visualizeInstruction);
    expect(prepareRequest(req('What does this mean?', 'Some text')).instruction).toContain(diagramInstruction);
    expect(prepareRequest(req('What does this mean?', 'Some text')).instruction).not.toContain(visualizeInstruction);
  });
  it('both wordings keep the safety rules', () => {
    for (const text of [diagramInstruction, visualizeInstruction]) {
      expect(text).toContain('Never output SVG, HTML, URLs');
      expect(text).toContain('15 nodes');
      expect(text).toContain('no < or > characters');
    }
  });
});

describe('opt-in debug capture', () => {
  const dirs: string[] = [];
  afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
  const tmp = () => { const d = mkdtempSync(path.join(os.tmpdir(), 'aitiarch-dbg-')); dirs.push(d); return path.join(d, 'sub', 'diagrams.jsonl'); };
  it('writes nothing unless AITIARCH_DEBUG_DIAGRAMS=1', () => {
    const file = tmp();
    captureDiagram({ kind: 'rejected', code: 'node_count', path: 'nodes', raw: { a: 1 } }, file, {});
    captureDiagram({ kind: 'rejected', code: 'node_count', path: 'nodes', raw: { a: 1 } }, file, { AITIARCH_DEBUG_DIAGRAMS: '0' });
    expect(existsSync(file)).toBe(false);
  });
  it('writes one JSON row with the code, path and raw spec when enabled', () => {
    const file = tmp();
    captureDiagram({ kind: 'rejected', code: 'node_label', path: 'nodes[0].label', raw: { nodes: [] } }, file, { AITIARCH_DEBUG_DIAGRAMS: '1' });
    const row = JSON.parse(readFileSync(file, 'utf8').trim());
    expect(row).toMatchObject({ kind: 'rejected', code: 'node_label', path: 'nodes[0].label', raw: { nodes: [] }, truncated: false });
    expect(typeof row.at).toBe('string');
  });
  it('caps one spec and the whole file', () => {
    const file = tmp();
    const env = { AITIARCH_DEBUG_DIAGRAMS: '1' };
    captureDiagram({ kind: 'rejected', raw: { x: 'y'.repeat(MAX_SPEC_BYTES * 2) } }, file, env);
    const first = JSON.parse(readFileSync(file, 'utf8').trim());
    expect(first.truncated).toBe(true);
    expect(Buffer.byteLength(first.raw)).toBeLessThanOrEqual(MAX_SPEC_BYTES);
    for (let i = 0; i < 80; i++) captureDiagram({ kind: 'repaired', raw: { i, pad: 'p'.repeat(8000) } }, file, env);
    expect(readFileSync(file).length).toBeLessThanOrEqual(MAX_FILE_BYTES + 20000);
    const rows = readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(rows.at(-1).raw.i).toBe(79); // newest rows are kept
  });
  it('never throws, even when the folder cannot be created', () => {
    const d = mkdtempSync(path.join(os.tmpdir(), 'aitiarch-dbg-')); dirs.push(d);
    writeFileSync(path.join(d, 'blocker'), 'x');
    expect(() => captureDiagram({ kind: 'rejected', raw: {} }, path.join(d, 'blocker', 'diagrams.jsonl'), { AITIARCH_DEBUG_DIAGRAMS: '1' })).not.toThrow();
  });
});
