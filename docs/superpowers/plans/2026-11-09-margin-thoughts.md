# Invoked margin thoughts implementation plan

Authority: the approved margin-thought request and docs/phase2b-auto-mode-and-handoff.md. Proactive calling and diagram rendering are excluded. Work on design-d3; fake providers only; protected files unchanged.

1. Tests first: pure collision placement, stable side choice, exact previewed AI callout insertion, BOM/CRLF byte diff and undo, mapping above anchor. Add ledger provenance tests.
2. Implement pure helpers. Preserve existing ink v2; derive a stable side from item id (no sidecar migration). Bring-in is an explicit editor transaction after a compare-and-write preview check; add a dedicated ledger provenance event without answer text.
3. Replace wide inline answer widgets with dotted anchor decorations and two quiet margin rails. Measure actual blob heights for collision layout. Narrow layouts use block lists at the paragraph. Pending/error states never show unvalidated text.
4. Open the existing thread component in an accessible mini panel beside the selected blob; retain existing orphan list, drafts, ownership, reveal, dismissal and provider checks. Diagram slot only.
5. Fake-provider browser gates: alignment, collisions, both themes, narrow fallback, keyboard open/close, reattachment, followups, insertion/undo, reload and Markdown bytes. Update old inline-layout expectations to the approved margin behavior. Run full unit suite, typecheck, native loads, held-out mapping and browser suites. Commit explicit paths in small slices; report remaining specification updates.

No dependencies, provider calls, note copying, or automatic Markdown insertion. Stable id-derived sides deliberately avoid a schema change and do not reshuffle after edits; document this difference from the earlier proposal.
