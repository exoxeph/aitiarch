# Invoked diagrams: verification

All checks used fake providers and synthetic fixtures, never a real or trial note. No live calls. Contract and prompt addition: [diagrams-contract.md](diagrams-contract.md). The production prompt includes the exact schema/limits plus the when-to-draw rule; the existing answer, verbatim quote and ownership rules remain strict.

## Implemented

Five types: flow, layers/architecture, sequence, comparison, tree. Optional validated JSON persists in ink/thread replies. No model SVG is accepted. Invalid diagrams leave the validated answer with an unavailable notice. Browser layout generates escaped local SVG, a focus stepper, larger view and export. Narrow blobs retain those controls. Destroying a source widget closes its larger modal, including on responsive replacement.

Bring to notebook previews a standard Markdown image, saves content-addressed SVG under root/assets, and inserts only on confirmation through the existing editor transaction/compare-and-write. BOM/CRLF survive and one undo restores the original. Text-only Bring uses the same durable intent journal. Ledger failure leaves a persistent notice; next load retries recording, never insertion. Existing identical images cannot prove a newly prepared insertion happened. A verified dead-owner journal lock is recoverable; live or unknown locks remain protected. Unverifiable content stays pending with a notice rather than fabricating provenance. Assets are retained after undo.

## Results

- Unit suite: 886 passed, one optional skip, 58 files. Ran a tracked-source fixture copy with repository-local disposable roots, preserving the credential-placement tests' isolation from their synthetic token paths.
- Typecheck passed. Native Node loaded 43 server modules. All 13 held-out mapping cases passed; zero wrong attachments. Held-out files unchanged.
- Browser: diagrams, editor-gates, threads, phase1, ink-mapping, ink-layout, invoked, thoughts passed. Diagram gate: 12 fake questions, six intended diagrams/six text-only; larger view, focus, export, narrow layout, DOM cleanup, byte identity, ledger failure/reload/repair, and Mermaid reuse.
- Fresh review regressions: crash-owned journal lock recovery; unapplied duplicate insertion never records provenance; unmounted host disposes larger modal. Observed RED then GREEN.

## Initial bundle and deduplication

Measured all entry JS and its recursive static imports, plus entry CSS; gzip each emitted file separately with Node zlib. Baseline built from b69a1a6 before this work. Content-hash filenames can change gzip totals slightly.

| Initial static closure | Raw bytes | Gzip bytes |
| --- | ---: | ---: |
| Before | 959,373 | 313,898 |
| After | 961,593 | 315,328 |
| Delta | +2,220 (0.23%) | +1,430 (0.46%) |

ELK's initial contribution is **zero**. One shared lazy `elk.bundled` chunk is 1,463,405 raw / 447,270 gzip bytes. Build module graph confirms it is outside the initial closure and both diagram and Mermaid ELK paths reach it. Browser test first renders Aitiarch diagrams, then an actual Mermaid `layout: elk` diagram; ELK is not requested again. No separate bundled engine or CDN. Diagram view chunk: 12,989 raw bytes, also lazy.

Reproduce: `npm run build`, then `node check/diagram-bundle.mjs` from ui. The build writes ignored check/out/diagram-build-graph.json. The check proves deduplication even without a saved baseline; an optional ignored check/out/diagram-baseline.json is an array of {file,raw,gzip} rows captured from the earlier build. Missing baseline reports null delta rather than claiming a comparison.

## Reference render timings and screenshots

One local headless Edge run; timings are observations, not a performance guarantee. Initial mixed fixture run's first ELK import plus seven-node flow layout: 152.9 ms; warm layers layout 15.9 ms, sequence 0.5 ms. Each isolated reference below follows reload and includes engine initialization from the browser cache. SVG draw means serialization, DOM parsing and mounting only; larger view includes the click and cached layout.

| Reference | Layout incl. engine wait (ms) | SVG draw (ms) | Open larger (ms) |
| --- | ---: | ---: | ---: |
| CI/CD | 80.4 | 0.6 | 28.2 |
| RAG | 74.7 | 0.7 | 23.8 |
| Request lifecycle | 52.6 | 0.3 | 21.9 |

Screenshots outside the repo: `C:\Users\UseR\Documents\aitiarch-trial\design-d3\screenshots\diagrams\`.
For each prefix `cicd`, `rag`, `request-lifecycle`: `-light.png`, `-dark.png` (app/larger view), `-diagram-light.png`, `-diagram-dark.png` (complete SVG), `-narrow.png`. Fifteen images total; diagram-check.json contains exact paths/timings. Existing regression suite images are in its regression subfolder. Screenshots are never staged.

## Honest limits and licenses

The 6/6 fixture split proves validation/storage/rendering plumbing and prompt presence, not real model judgement about when to draw. No live judgement was measured. There is no measured comparison against Riddled. A seven-node CI/CD pipeline makes parallel checks and a join visible; a RAG diagram explains the preparation/query split; sequence lanes clarify refresh ordering. A definition, wording question, tiny checklist or two simple facts is clearer as prose. Those fake fixtures omit diagrams.

At 680px, full diagrams retain readable 12-18px type; large/wide graphs scroll instead of shrinking labels. Compact margin previews can be too small to read, so use See it larger. Dense 15-node graphs may still be worse than prose; semantic correctness and all possible graph topologies are not proven by these three references. No syntax/algorithm superiority claim.

No new package, font, icon or asset dependency. Reused elkjs 0.12.1 (already installed with Mermaid), dual EPL-2.0 OR GPL-3.0-or-later, using EPL-2.0. SVG geometry and UI are original. Uses installed system Segoe UI/Arial, no font files redistributed or network font requests. Visual guidance only: Cathryn Lavery diagram-design (MIT), credited in the contract; no code/assets installed or copied.
