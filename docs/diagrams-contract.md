# Invoked diagrams contract

## Scope and safety
Think and Ask may return an optional diagram alongside the existing answer and claims. No model SVG, HTML, URLs, tools, proactive requests, or live development calls. Invalid diagrams are discarded with a plain notice; a valid text answer remains. Invalid answers or claims still fail under the existing rules. No takeaway, why, failed-reason or reveal rules change.

## JSON v1
The reply has answer (string), claims (the existing exact sourceId/quote objects), and optionally diagram. Diagram has exactly: version:1, type, title, caption, nodes, edges, focus; groups is optional. Unknown fields fail diagram validation.

- type: flow | layers | sequence | comparison | tree. Layers covers architecture.
- title: 1-80 characters; caption: 1-160 characters, one line.
- nodes: 1-15 objects, exactly id and label, optional kind and detail. kind: step | decision | actor | component | value (default component). label: 1-64 characters; detail: 1-120 characters, optional.
- edges: 0-25 objects with exactly id, from, to, optional label (1-48 characters). Endpoints must exist. Sequence edge array order means message order; self messages are supported.
- groups: 0-5 objects with exactly id, label, nodeIds (1-15 existing node IDs). A node belongs to at most one group. Flat groups only.
- focus: 0-25 unique node/edge IDs, in reading order. All IDs use [a-zA-Z][a-zA-Z0-9_-]{0,39}, globally unique across nodes, edges and groups.
- All display strings are plain single-line text: reject markup, angle brackets, controls, Markdown links, URL schemes and www addresses. No layout coordinates, styles, colors, SVG, arbitrary properties or nested rich text from the model. Total JSON limit: 16 KiB.
- Tree must be acyclic, connected, with one root and at most one parent per node. Comparison has no edges and at most five columns. Empty focus is a static overview.

Validated specs persist as an optional diagram on the ink v2 item (or accepted thread reply); old sidecars remain readable without migration. Invalid diagrams never persist. Stable key ordering is unchanged. Diagram content is AI-owned and visibly labeled AI.

## Layout and rendering
Browser-side lazy ELK 0.12.1, already installed via Mermaid; choose its EPL-2.0 license. Import exactly elkjs/lib/elk.bundled.js, shared with Mermaid. No new dependency or network assets. Flow/layers/tree use ELK orthogonal routing and measured, wrapped labels. Sequence uses participant lifelines and ordered messages; comparison uses aligned columns. ELK is lazy for all diagram paths. One local serializer renders validated, bounded geometry as escaped SVG, never model markup.

Grove light/dark tokens; no shadows or rainbow fills; consistent gaps, clean attached arrowheads, masked edge labels, only the current focus step accented. At 680px labels stay readable; larger graphs use a scroll wrapper rather than shrinking text below readable size. In the narrow margin, a compact preview opens the same larger diagram. Stepper controls, caption, accessible title, See it larger and Export SVG accompany it. Focus changes are display-only, with no Markdown changes or extra calls. No animation required; reduced motion is respected.

## Prompt addition (both invoked actions)
"Draw only when a process, system structure, comparison, tree, or ordered sequence is hard to hold in words and a diagram makes it clearer. Otherwise omit diagram. A short list, simple fact, opinion, or wording request normally needs no diagram. Always supply the short plain-language answer and existing verbatim claims. You may add only one diagram using the supplied JSON v1 schema. Never output SVG, HTML, URLs, styles or coordinates. Do not add a diagram merely because one is possible. Diagram labels must distinguish a hypothesis from what the note actually states."

The prompt includes the schema and limits above. Invalid diagram/schema/layout: show the validated answer plus Diagram unavailable; no retry and no provider call. Existing answer/claim and stream validation are not weakened.

## Explicit Bring to notebook and repair
Without a diagram, retain the previewed labeled AI callout. With a diagram, preview a standard Markdown image: ![AI diagram: title](relative/path/to/assets/ai-diagram-HASH.svg). Only after explicit confirmation save the locally generated SVG under <root>/assets/ (normally .aitiarch/assets/) and insert through the normal editor transaction/compare-and-write. Preserve BOM/CRLF and undo the insertion with one Ctrl+Z. No automatic insertion; no anchors added to Markdown. Export SVG is a separate local download.

Before editing, persist an insertion intent under the hidden ink directory, containing operation ID, ink ID, note, timestamp and before/after/inserted-span hashes and offsets. Asset creation is confined, content-addressed and never overwrites a different file. The server regenerates SVG from locally validated geometry and the stored spec; it does not accept SVG text. The same serializer serves download and insertion. No transcript or prompt in assets, intents or ledger.

After compare-and-write succeeds, append the idempotent AI-authored/human-inserted ledger event. Ledger failure never repeats the Markdown insertion: keep the intent and show a persistent pending-record notice. On next note load, verify the intended saved content and retry only the ledger append. If content cannot be verified (conflict, undo or later edit), preserve the intent, show the notice and offer Retry recording; never invent an insertion or overwrite user text. An unchanged pre-insertion hash never counts as proof of insertion, even when an identical image already exists. Journal locks record their owner; only a provably exited owner can be reclaimed. Live or unverifiable locks fail closed and keep the notice. A completed intent remains an audit record. Asset files are retained after undo; never silently delete a referenced or potentially shared asset.

## Evaluation and delivery
Tests first: strict schema boundaries and malicious strings; text fallback for both adapters; 12 synthetic questions (six with intended diagrams, six without); each layout type; bounded geometry and escaping; stepper/keyboard/larger/export; bring-in BOM/CRLF, one undo, stale preview, ledger failure/reload/retry and confinement. The fixture split verifies plumbing and prompt presence, not real model judgement.

Hand-built CI/CD, RAG and request-lifecycle specs pass through the production renderer; save light/dark screenshots outside the repo and report warm/cold render timings. Measure initial JS+CSS raw/gzip, lazy ELK bytes and build graph plus runtime imports for Mermaid/diagram deduplication. Report failures and situations where prose wins, without claiming an untested superiority to another product.

## Visual reference credit
Visual principles consulted, no code/assets installed or copied: Cathryn Lavery, [diagram-design](https://github.com/cathrynlavery/diagram-design), MIT. Borrowed guidance: remove needless connections, restrict focal accents, protect labels from lines, use borders rather than shadows, and prefer prose when a visual adds no understanding. Grove remains our own visual system.
