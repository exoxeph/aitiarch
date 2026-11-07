# Slice A: invoked Claude product integration

The selection toolbar now offers Think on this (Ctrl/Cmd+Enter) and Ask.... Clicking captures the note, selection and selector in memory. The preview shows the exact redacted packet; Send to Claude is the explicit dispatch action. Editing or changing selection does not alter that packet. This slice supplies the frozen note and selection; decision-source selection and an opt-in transcript chooser from the broader design are not implemented. Transcript context is none; no transcript is discovered, read or transmitted.

Pending and completed answers use the same v2 item and CodeMirror mapping as inline ink, the rail and orphan review. Each item keeps its original selector, generation action/provider/model/timestamp/status and validated evidence. The sidecar retains stable serialization and `lastSeenTextHash`. Completion merges into the latest sidecar. The browser's exact transaction mapping is checkpointed even when an answer arrives without another text edit; a fresh disk diff cannot override that known identity. Ambiguous/deleted anchors preserve answers as orphans. Neither generation nor ledger writes call the Markdown writer. The ordinary editor save path writes only human edits.

The ledger records metadata-only shown/dismissed events, deduplicated across reloads. Visibility requires a completed item intersecting a visible viewport. Dismissal hides inline presentation but retains the answer in Activity. Errors remain visible in ink; timeout/cancellation never automatically rerun inference. A persistence failure retains the completed answer in server memory and offers a save-only retry. That memory cannot survive server termination. Pending work interrupted by restart is preserved and is not automatically retried.

Claude is configured only by an explicit absolute `--claude` executable. Startup requires the help flags and the exact previously canary-tested version, Claude Code 2.1.205. Each production response's structured stream must have empty tools/MCP/plugins, no hook/tool/unknown events, an answer and successful completion. The disposable CLI directory must remain empty. Codex is disabled. Tests inject providers or explicit fake executable paths; none can fall back to an installed provider.

## Automated verification

- Run `npm test` and `npm run typecheck` in `ui/`. The regular suite includes the 13 held-out mapping cases without changing their content or tuning rules. The optional redacted-notebook stress test skips unless the user explicitly supplies `AITIARCH_REDACTED_NOTEBOOK_FIXTURE`; it never searches for a notebook.
- Run `npm run check:invoked` in `ui/` for the disposable browser check: Think, Ask, keyboard invocation, preview without a call, frozen context, edits during a delayed answer, preview-time duplication, orphan preservation, reload, dismissal/ledger and BOM/CRLF preservation. All calls are fake. Generated wide/narrow screenshots stay ignored under `ui/check/out/`.
- Run `npm run check:phase1` for the existing editor/save/live-sync browser regression check. It also operates on disposable fixtures.

## Proposed live Claude check — not run, approval required

Use a new disposable project outside this repo with a synthetic note, no transcript and no real notebook. Configure the previously verified Claude executable. Make **two calls total**, one Think and one Ask. During one call, edit the selected paragraph; for the other, delete it. Verify correct mapping or preserved orphan, dismiss one answer, reload, and inspect ink and ledger plus the human-edited note bytes. No automatic retry or additional call is authorized.

Budget estimate: **about 3,000 input and 300 output tokens per call**, or **about 6,000 input and 600 output tokens for two calls**, plus CLI/system, caching and reasoning overhead. This is an estimate, not an allowance guarantee or a dollar price. Record only usage actually returned by the CLI. Do not run this check until the user explicitly approves its calls. Slice B has not started at this boundary and will have a separate commit and sign-in/live-call gate.

## Recorded fixture results

313 tests passed; one optional redacted-notebook test skipped because no user-supplied fixture was configured. Typecheck and build passed. All 13 held-out mapping cases passed without case or resolver-rule edits. Phase 1 browser check: 28/28 passed. Invoked browser check: four fake calls passed, including save-only retry after reload. Task 2 layout check passed; re-attaching its margin orphan correctly increases the card count from two to three. No live provider call ran.
