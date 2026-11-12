/** Model data only. SVG/coordinates are exclusively generated locally. */
export type DiagramType='flow'|'layers'|'sequence'|'comparison'|'tree'|'cycle'|'timeline'|'matrix'|'hub'|'pyramid';
export const DIAGRAM_TYPES:readonly DiagramType[]=['flow','layers','sequence','comparison','tree','cycle','timeline','matrix','hub','pyramid'];
/** Kinds drawn from node order alone (no connections, no groups): the app lays them out and draws every line itself. */
export const KIND_RULES:Partial<Record<DiagramType,{min:number;max:number}>>={cycle:{min:3,max:8},timeline:{min:2,max:8},matrix:{min:4,max:4},hub:{min:3,max:9},pyramid:{min:3,max:6}};
export interface DiagramNode {id:string;label:string;kind?:'step'|'decision'|'actor'|'component'|'value';detail?:string}
export interface DiagramEdge {id:string;from:string;to:string;label?:string}
export interface DiagramGroup {id:string;label:string;nodeIds:string[]}
export interface Diagram {version:1;type:DiagramType;title:string;caption:string;nodes:DiagramNode[];edges:DiagramEdge[];focus:string[];groups?:DiagramGroup[];axes?:{x:string;y:string}}
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const keys=(v:unknown,required:string[],optional:string[]=[])=>record(v)&&required.every(k=>Object.hasOwn(v,k))&&Object.keys(v).every(k=>required.includes(k)||optional.includes(k));
const id=(v:unknown):v is string=>typeof v==='string'&&/^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/.test(v);
const text=(v:unknown,max:number):v is string=>typeof v==='string'&&!!v.trim()&&v.length<=max&&!/[<>\u0000-\u001f\u007f]/.test(v)&&!/(?:[a-z][a-z0-9+.-]*:\/\/|www\.|(?:javascript|data|mailto|file):|\[[^\]]*\]\s*\()/i.test(v);
export const DIAGRAM_ISSUE_TEXT = {
  too_large: 'too large', shape: 'unexpected fields', version: 'wrong version', type: 'unknown type', title: 'bad title', caption: 'bad caption',
  no_nodes: 'it has no nodes to draw', node_count: 'too many nodes', edge_count: 'too many connections', focus_count: 'too many steps', node: 'a node is malformed', node_label: 'a node label is too long or unsafe',
  node_detail: 'a node detail is too long or unsafe', node_kind: 'unknown node kind', edge: 'a connection is malformed', edge_label: 'a connection label is too long or unsafe',
  focus: 'bad step list', group: 'bad grouping', comparison: 'a comparison cannot have connections or more than 5 items', tree: 'the tree is not a tree', id: 'duplicate or invalid ids',
  kind: 'this kind of diagram needs a different number of items and cannot have connections or groups', axes: 'the axis labels are malformed',
  // The Skill renderer (shared/skill-diagram.ts): reasons are fixed words, never the skill's own output.
  skill_too_large: 'the skill\'s document is over 300 KB', skill_no_document: 'the skill did not return an HTML document',
} as const;
export type DiagramIssueCode = keyof typeof DIAGRAM_ISSUE_TEXT;
/** What is stored on an item when a diagram was rejected: the old generic value, or a specific code. */
export type DiagramIssue = 'invalid' | DiagramIssueCode;
export const isDiagramIssue = (v: unknown): v is DiagramIssue => v === 'invalid' || (typeof v === 'string' && Object.hasOwn(DIAGRAM_ISSUE_TEXT, v));
export const diagramIssueText = (v: string | undefined): string => (v && v !== 'invalid' && isDiagramIssue(v) ? DIAGRAM_ISSUE_TEXT[v as DiagramIssueCode] : 'invalid format');
/** The one short sentence shown wherever a diagram could not be drawn; issue is a stored reason code or 'layout'. */
export const unavailableText = (issue?: string): string => issue?.startsWith('skill_') ? `Diagram unavailable: ${diagramIssueText(issue)}.`
  : `Diagram unavailable: ${issue === 'layout' ? 'it could not be laid out' : diagramIssueText(issue)}. The text answer is preserved.`;
export type DiagramCheck = { ok: true; diagram: Diagram } | { ok: false; code: DiagramIssueCode; path: string };
/** Strict check. The reason is a fixed code and a JSON path, never model text. */
export function checkDiagram(value: unknown): DiagramCheck {
 const no = (code: DiagramIssueCode, path: string): DiagramCheck => ({ ok: false, code, path });
 try {
  if (new TextEncoder().encode(JSON.stringify(value)).length > 16384) return no('too_large', '$');
  if (!keys(value, ['version', 'type', 'title', 'caption', 'nodes', 'edges', 'focus'], ['groups', 'axes'])) return no('shape', '$');
  const d = value as unknown as Diagram;
  if (d.version !== 1) return no('version', 'version');
  if (!DIAGRAM_TYPES.includes(d.type)) return no('type', 'type');
  if (!text(d.title, 80)) return no('title', 'title');
  if (!text(d.caption, 160)) return no('caption', 'caption');
  if (!Array.isArray(d.nodes) || d.nodes.length > 15) return no('node_count', 'nodes');
  if (!d.nodes.length) return no('no_nodes', 'nodes');
  if (!Array.isArray(d.edges) || d.edges.length > 25) return no('edge_count', 'edges');
  if (!Array.isArray(d.focus) || d.focus.length > 25) return no('focus_count', 'focus');
  const ids = new Set<string>(), nodes = new Set<string>();
  const add = (v: unknown) => { if (!id(v) || ids.has(v)) return false; ids.add(v); return true; };
  for (const [i, n] of d.nodes.entries()) {
   if (!keys(n, ['id', 'label'], ['kind', 'detail'])) return no('node', `nodes[${i}]`);
   if (!add(n.id)) return no('id', `nodes[${i}].id`);
   if (!text(n.label, 64)) return no('node_label', `nodes[${i}].label`);
   if (n.kind !== undefined && !['step', 'decision', 'actor', 'component', 'value'].includes(n.kind)) return no('node_kind', `nodes[${i}].kind`);
   if (n.detail !== undefined && !text(n.detail, 120)) return no('node_detail', `nodes[${i}].detail`);
   nodes.add(n.id);
  }
  for (const [i, e] of d.edges.entries()) {
   if (!keys(e, ['id', 'from', 'to'], ['label']) || !nodes.has(e.from) || !nodes.has(e.to)) return no('edge', `edges[${i}]`);
   if (!add(e.id)) return no('id', `edges[${i}].id`);
   if (e.label !== undefined && !text(e.label, 48)) return no('edge_label', `edges[${i}].label`);
  }
  if (new Set(d.focus).size !== d.focus.length || d.focus.some((v) => !id(v) || !ids.has(v))) return no('focus', 'focus');
  if (d.groups !== undefined) {
   if (!Array.isArray(d.groups) || d.groups.length > 5) return no('group', 'groups');
   const grouped = new Set<string>();
   for (const [i, g] of d.groups.entries()) {
    if (!keys(g, ['id', 'label', 'nodeIds']) || !add(g.id) || !text(g.label, 64) || !Array.isArray(g.nodeIds) || !g.nodeIds.length || g.nodeIds.length > 15) return no('group', `groups[${i}]`);
    for (const n of g.nodeIds) { if (!nodes.has(n) || grouped.has(n)) return no('group', `groups[${i}].nodeIds`); grouped.add(n); }
   }
  }
  if (d.type === 'comparison' && (d.edges.length || d.nodes.length > 5)) return no('comparison', 'type');
  const rule = KIND_RULES[d.type];
  if (rule && (d.edges.length || d.groups || d.nodes.length < rule.min || d.nodes.length > rule.max)) return no('kind', 'type');
  if (d.axes !== undefined && (d.type !== 'matrix' || !keys(d.axes, ['x', 'y']) || !text(d.axes.x, 32) || !text(d.axes.y, 32))) return no('axes', 'axes');
  if (d.type === 'tree') {
   if (d.edges.length !== d.nodes.length - 1) return no('tree', 'edges');
   const parents = new Map<string, string>();
   for (const e of d.edges) { if (parents.has(e.to)) return no('tree', 'edges'); parents.set(e.to, e.from); }
   for (const n of nodes) { const seen = new Set<string>(); let at: string | undefined = n; while (at !== undefined) { if (seen.has(at)) return no('tree', 'edges'); seen.add(at); at = parents.get(at); } }
  }
  return { ok: true, diagram: structuredClone(d) };
 } catch { return no('shape', '$'); }
}
export function readDiagram(value: unknown): Diagram | null {
 const r = checkDiagram(value);
 return r.ok ? r.diagram : null;
}
// ---------------------------------------------------------------------------------------------------------------------
// Tolerant normalization. Real model output often misses a limit by a little (a 70 character label, "->" in a label, a
// repeated id, an extra field). The strict check above stays exactly as it was; this step only repairs those near misses
// BEFORE it runs, and it can only remove or shorten things, so what comes out is still plain text with no markup or URLs.
// ---------------------------------------------------------------------------------------------------------------------
export interface NormalizeNotes { relabelled: number; dropped: number; renamed: number; clamped: number; retyped: boolean }
const TYPE_WORDS: Record<string, DiagramType> = {
 flowchart: 'flow', graph: 'flow', process: 'flow', pipeline: 'flow', workflow: 'flow', architecture: 'layers', layer: 'layers', stack: 'layers',
 'sequence-diagram': 'sequence', compare: 'comparison', table: 'comparison', hierarchy: 'tree',
 loop: 'cycle', circular: 'cycle', lifecycle: 'cycle', 'feedback-loop': 'cycle', 'time-line': 'timeline', roadmap: 'timeline', history: 'timeline',
 quadrant: 'matrix', '2x2': 'matrix', grid: 'matrix', mindmap: 'hub', 'mind-map': 'hub', radial: 'hub', spoke: 'hub', 'hub-and-spoke': 'hub', funnel: 'pyramid', ranking: 'pyramid', levels: 'pyramid',
};
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Make one string safe and short enough, or undefined when nothing usable is left. */
export function cleanText(v: unknown, max: number): { value?: string; changed: boolean } {
 if (typeof v !== 'string') return { changed: false };
 let s = v
  .replace(/\[([^\]]*)\]\s*\([^)]*\)/g, '$1')
  .replace(/(?:[a-z][a-z0-9+.-]*:\/\/|www\.)\S*/gi, '')
  .replace(/(?:javascript|data|mailto|file):\S*/gi, '')
  .replace(/<->|<=>|<-->/g, '↔').replace(/-->|->|=>/g, '→').replace(/<--|<-|<=/g, '←')
  .replace(/[<>]/g, '')
  .replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
 if (s.length > max) s = s.slice(0, Math.max(1, max - 1)).trimEnd() + '…';
 return s ? { value: s, changed: s !== v } : { changed: true };
}

/**
 * Repair a model-supplied diagram. Returns null only when there is nothing to draw (not an object, or no usable node).
 * Unknown fields are dropped, text is cleaned and shortened, ids are made valid and unique, counts are clamped, references
 * to things that no longer exist are removed, and a "tree" or "comparison" that breaks its own rules becomes a plain flow
 * or layers diagram instead of being rejected.
 */
export function normalizeDiagram(raw: unknown): { value: unknown; notes: NormalizeNotes } | null {
 if (!isObj(raw) || !Array.isArray(raw.nodes)) return null;
 const notes: NormalizeNotes = { relabelled: 0, dropped: 0, renamed: 0, clamped: 0, retyped: false };
 const text2 = (v: unknown, max: number) => { const r = cleanText(v, max); if (r.changed && typeof v === 'string') notes.relabelled++; return r.value; };
 const used = new Set<string>();
 const fresh = (v: unknown, fallback: string): string => {
  let base = (typeof v === 'string' ? v : '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!base) base = fallback; if (!/^[a-zA-Z]/.test(base)) base = 'n' + base;
  base = base.slice(0, 36);
  let out = base, k = 2;
  while (used.has(out)) out = `${base}_${k++}`;
  if (out !== v) notes.renamed++;
  used.add(out); return out;
 };
 const map = new Map<string, string>(); // original id -> final id (first one wins)
 const nodes: DiagramNode[] = [];
 for (const n of raw.nodes) {
  if (!isObj(n)) { notes.dropped++; continue; }
  if (nodes.length >= 15) { notes.clamped++; continue; }
  const label = text2(n.label, 64) ?? text2(n.id, 64);
  if (!label) { notes.dropped++; continue; }
  const finalId = fresh(n.id, 'n' + (nodes.length + 1));
  if (typeof n.id === 'string' && !map.has(n.id)) map.set(n.id, finalId);
  const node: DiagramNode = { id: finalId, label };
  if (typeof n.kind === 'string' && ['step', 'decision', 'actor', 'component', 'value'].includes(n.kind)) node.kind = n.kind as DiagramNode['kind'];
  const detail = n.detail === undefined ? undefined : text2(n.detail, 120);
  if (detail) node.detail = detail;
  nodes.push(node);
 }
 if (!nodes.length) return null;
 const nodeIds = new Set(nodes.map((n) => n.id));
 const edges: DiagramEdge[] = [];
 for (const e of Array.isArray(raw.edges) ? raw.edges : []) {
  if (!isObj(e) || typeof e.from !== 'string' || typeof e.to !== 'string') { notes.dropped++; continue; }
  const from = map.get(e.from), to = map.get(e.to);
  if (!from || !to || !nodeIds.has(from) || !nodeIds.has(to)) { notes.dropped++; continue; }
  if (edges.length >= 25) { notes.clamped++; continue; }
  const finalId = fresh(e.id, 'e' + (edges.length + 1));
  if (typeof e.id === 'string' && !map.has(e.id)) map.set(e.id, finalId);
  const edge: DiagramEdge = { id: finalId, from, to };
  const label = e.label === undefined ? undefined : text2(e.label, 48);
  if (label) edge.label = label;
  edges.push(edge);
 }
 let groups: DiagramGroup[] | undefined;
 if (Array.isArray(raw.groups)) {
  const grouped = new Set<string>();
  groups = [];
  for (const g of raw.groups) {
   if (!isObj(g) || !Array.isArray(g.nodeIds)) { notes.dropped++; continue; }
   if (groups.length >= 5) { notes.clamped++; continue; }
   const members: string[] = [];
   for (const m of g.nodeIds) { const f = typeof m === 'string' ? map.get(m) : undefined; if (f && nodeIds.has(f) && !grouped.has(f) && !members.includes(f)) members.push(f); }
   const label = text2(g.label, 64);
   if (!members.length || !label) { notes.dropped++; continue; }
   members.forEach((m) => grouped.add(m));
   const finalId = fresh(g.id, 'g' + (groups.length + 1));
   if (typeof g.id === 'string' && !map.has(g.id)) map.set(g.id, finalId);
   groups.push({ id: finalId, label, nodeIds: members.slice(0, 15) });
  }
  if (!groups.length) groups = undefined;
 }
 const focus: string[] = [];
 for (const f of Array.isArray(raw.focus) ? raw.focus : []) {
  const finalId = typeof f === 'string' ? map.get(f) : undefined;
  if (finalId && used.has(finalId) && !focus.includes(finalId)) { if (focus.length < 25) focus.push(finalId); else notes.clamped++; } else notes.dropped++;
 }
 const word = typeof raw.type === 'string' ? raw.type.trim().toLowerCase() : '';
 let type: DiagramType = (DIAGRAM_TYPES as readonly string[]).includes(word) ? (word as DiagramType) : TYPE_WORDS[word] ?? 'flow';
 if (type !== raw.type) notes.retyped = true;
 if (type === 'comparison' && (edges.length || nodes.length > 5)) { type = 'layers'; edges.length = 0; notes.retyped = true; }
 // Cycle, timeline, matrix, hub and pyramid are drawn from node order: connections and groups are dropped, and a wrong item count becomes plain layers.
 const rule = KIND_RULES[type];
 if (rule) {
  if (nodes.length < rule.min || nodes.length > rule.max) { type = 'layers'; notes.retyped = true; }
  notes.dropped += edges.length; edges.length = 0; groups = undefined;
 }
 let axes: { x: string; y: string } | undefined;
 if (type === 'matrix' && isObj(raw.axes)) { const x = text2(raw.axes.x, 32), y = text2(raw.axes.y, 32); if (x && y) axes = { x, y }; }
 if (type === 'tree') {
  const parents = new Map<string, string>();
  let ok = edges.length === nodes.length - 1;
  for (const e of edges) { if (parents.has(e.to)) ok = false; parents.set(e.to, e.from); }
  if (ok) for (const n of nodeIds) { const seen = new Set<string>(); let at: string | undefined = n; while (at !== undefined) { if (seen.has(at)) { ok = false; break; } seen.add(at); at = parents.get(at); } }
  if (!ok) { type = 'flow'; notes.retyped = true; }
 }
 const title = text2(raw.title, 80) ?? 'Diagram';
 const caption = text2(raw.caption, 160) ?? title;
 const value: Record<string, unknown> = { version: 1, type, title, caption, nodes, edges, focus, ...(groups ? { groups } : {}), ...(axes ? { axes } : {}) };
 // Over 16 KiB: shed detail text first, then shorten labels, then drop trailing nodes.
 const size = () => new TextEncoder().encode(JSON.stringify(value)).length;
 if (size() > 16384) { for (const n of nodes) delete n.detail; notes.clamped++; }
 if (size() > 16384) { for (const n of nodes) n.label = n.label.slice(0, 32); notes.clamped++; }
 return { value, notes };
}

export type DiagramPrepared =
 | { ok: true; diagram: Diagram; notes: NormalizeNotes | null }
 | { ok: false; code: DiagramIssueCode; path: string; notes: NormalizeNotes | null };
/** What the server does with a model diagram: try it as sent, then repair and retry; report a precise reason if neither works. */
export function prepareDiagram(raw: unknown): DiagramPrepared {
 const strict = checkDiagram(raw);
 if (strict.ok) return { ok: true, diagram: strict.diagram, notes: null };
 const fixed = normalizeDiagram(raw);
 if (!fixed) return { ok: false, code: strict.code, path: strict.path, notes: null };
 const again = checkDiagram(fixed.value);
 return again.ok ? { ok: true, diagram: again.diagram, notes: fixed.notes } : { ok: false, code: again.code, path: again.path, notes: fixed.notes };
}

/** Words that mean "draw this": a selection or a question containing one is treated as an explicit Visualize request. */
export const DRAW_WORDS = /\b(draw|diagram|visuali[sz]e|visuali[sz]ation|sketch|flow\s?-?chart|flow\s?-?diagram)\b/i;
export const wantsDiagram = (...texts: string[]): boolean => texts.some((t) => DRAW_WORDS.test(t));
export const VISUALIZE_QUESTION = 'Visualize the selected text as a diagram.';

const SCHEMA = `{"version":1,"type":"flow|layers|sequence|comparison|tree|cycle|timeline|matrix|hub|pyramid","title":"plain text","caption":"one line","nodes":[{"id":"n1","label":"plain text","kind":"step|decision|actor|component|value","detail":"optional plain text"}],"edges":[{"id":"e1","from":"n1","to":"n2","label":"optional plain text"}],"focus":["n1"],"groups":[{"id":"g1","label":"plain text","nodeIds":["n1"]}],"axes":{"x":"matrix only","y":"matrix only"}}`;
const RULES = `Diagram JSON uses exactly these fields and no others: ${SCHEMA}
Make it small and readable: usually 4 to 8 nodes, never more than 12. Node labels are short plain phrases of at most 40 characters (the hard limit is 64); edge labels at most 30. Write labels as plain words: no < or > characters, no arrows such as -> or =>, no markdown, no links. A label that is a hypothesis, not something the note states, starts with "Maybe:".
Ids are short ASCII like n1, e1, g1: they start with a letter, use only letters, digits, underscore or hyphen, and every id is unique across nodes, edges and groups. Edges refer to node ids that exist. Optional parts (kind, detail, edge label, groups) may be left out; focus may be empty. Hard limits: 15 nodes, 25 edges, 5 flat non-overlapping groups, 25 unique focus ids, title 80, caption 160, detail 120 characters, 16 KiB in total.
Types: flow = steps with arrows; layers = stacked parts; sequence = actors with messages in order; comparison = at most 5 items and no edges; tree = one root, every other node has exactly one parent, no cycles (use flow if the structure is not a strict tree).
Pick the shape that fits the idea, not always flow. These five need no edges and no groups: the app draws every line from the order of the nodes. cycle = 3 to 8 steps that repeat in a loop, in order; timeline = 2 to 8 events in time order (put the date or stage in the label, one line in detail); matrix = exactly 4 nodes in the order top-left, top-right, bottom-left, bottom-right, plus "axes":{"x":"label of the horizontal axis","y":"label of the vertical axis"}; hub = one central idea as the first node and 2 to 8 related ideas around it; pyramid = 3 to 6 levels from the top (smallest, most important) to the bottom (widest, foundation).`;
export const diagramInstruction = `Diagram (optional). Add a diagram only when a process, system structure, comparison, tree or ordered sequence is hard to hold in words and a picture makes it clearer. A short list, a simple fact, an opinion or a wording request needs none: leave diagram out.
Never output SVG, HTML, URLs, styles or coordinates. The diagram never replaces the short answer, and the claims stay verbatim as required above.
${RULES}`;
/** Used instead of the optional wording when the reader explicitly asked for a diagram (Visualize, or drawing words). */
export const visualizeInstruction = `The reader explicitly asked for a diagram. Put a diagram in this response (the diagram field is required) and keep the answer text to one or two plain sentences that say what the diagram shows. If the content truly cannot be drawn, leave the diagram out and say why in one short clause.
Never output SVG, HTML, URLs, styles or coordinates. The claims stay verbatim as required above.
${RULES}`;