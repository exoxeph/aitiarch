# Invoked margin thoughts implementation plan

Authority: the approved margin-thought request and docs/phase2b-auto-mode-and-handoff.md. Proactive calling and diagram rendering are excluded. Work on design-d3; fake providers only; protected files unchanged.

1. Tests first: pure collision placement, stable side choice, exact previewed AI callout insertion, BOM/CRLF byte diff and undo, mapping above anchor. Add ledger provenance tests.
2. Implement pure helpers. Preserve existing ink v2; derive a stable side from item id (no sidecar migration). Bring-in is an explicit editor transaction after a compare-and-write preview check; add a dedicated ledger provenance event without answer text.
3. Replace wide inline answer widgets with dotted anchor decorations and two quiet margin rails. Measure actual blob heights for collision layout. Narrow layouts use block lists at the paragraph. Pending/error states never show unvalidated text.
4. Open the existing thread component in an accessible mini panel beside the selected blob; retain existing orphan list, drafts, ownership, reveal, dismissal and provider checks. Diagram slot only.
5. Fake-provider browser gates: alignment, collisions, both themes, narrow fallback, keyboard open/close, reattachment, followups, insertion/undo, reload and Markdown bytes. Update old inline-layout expectations to the approved margin behavior. Run full unit suite, typecheck, native loads, held-out mapping and browser suites. Commit explicit paths in small slices; report remaining specification updates.

No dependencies, provider calls, note copying, or automatic Markdown insertion. Stable id-derived sides deliberately avoid a schema change and do not reshuffle after edits; document this difference from the earlier proposal.

## Completion evidence

- Data/insertion slice: d55492b. Margin/thread UI slice: de4a921.
- 858 unit tests passed, one optional skip; typecheck; 40 native module loads; 13 held-out mapping cases passed (zero wrong attachments).
- Browser checks passed: editor-gates (including Word navigation), threads, phase1 (28/28), ink-mapping, ink-layout, invoked and new thoughts. Fake providers only. New thoughts gate includes preview-race rejection, modal keyboard focus, mini-panel movement and close-on-delete.
- Screenshots: Documents/aitiarch-trial/design-d3/screenshots/margin-thoughts, outside the repo. No new dependency or asset.
- Existing ink v2 stays unchanged. Sides are stable id-derived choices rather than new persisted fields. Narrow fallback is a list under the paragraph. Proactive calls, per-note chat, modes, Earlier history and diagrams remain outside this implementation.
- Markdown saves and ledger appends are sequential, not atomic across files. A ledger failure preserves the saved insertion and shows a notice; there is no ledger-only retry yet. Insertion provenance links through inkId; its requestId identifies the insertion operation.
- Later design/spec synchronization should cover invoked margin placement, id-derived sides, available-editor-width fallback, mini thread panels, the diagram slot and explicit previewed AI callout insertion/ledger provenance. AITIARCH-UI-SPEC.md was not edited.
