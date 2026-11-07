# Task 3 product integration — Slice A

Implements the approved [invoked AI design](../../phase2a-task3-design.md) and the user's ordered Slice A request. Execute inline, tests first; commit Slice A separately, then stop for live-check approval before Slice B.

## Boundaries

Claude only, using the previously verified isolation profile and version. Codex remains disabled. No automated test discovers or invokes an installed provider. No live call, credential access, real notebook read/write, transcript import, takeaway generation or proactive caller. Markdown changes only through the existing human editor save path.

## Steps

- [x] Add failing service/store tests for frozen inputs, v2 pending ink, completion after edits/deletion, concurrent answers, metadata-only idempotent ledger, safe failures, cancellation and reload. Add generation metadata validation without changing existing v2 readers' behavior for old items. Keep runtime prompts and note snapshots in RAM.
- [x] Implement `Assistance` in `ui/server/assistance.ts` with an injected `Provider`, bounded concurrency and explicit cancellation. Use `InkStore` CAS writes and existing mapping. Add confined atomic ledger operations in `ui/server/ledger-store.ts`. Expose authenticated invocation/status/cancel/event routes in `http.ts`.
- [x] Add failing provider contract tests before enabling the verified Claude version. Production responses use the structured event stream: reject nonempty registries, hooks, tool attempts, unknown events or incomplete results. Preserve the existing fake-CLI contract. An explicit absolute `--claude` executable opts into configuration, not an automatic request.
- [x] Add failing editor/browser checks for toolbar click and Ctrl+Enter, Ask submission, frozen selection, typing during requests, delayed response mapping, orphan rendering, dismissal, reload and unchanged note bytes. Wire pending items into the existing shared CodeMirror mapping. Show the redacted packet and redaction limitations before explicit submission; transcript context remains none in this slice.
- [x] Run all UI tests (including the 13 held-out mapping cases), typecheck, build and disposable-fixture browser checks. Inspect the exact staged diff for private content and generated output. Commit only Slice A code/tests/docs and its accepted isolation prerequisites.
- [x] Stop: propose a disposable live check, roughly 3,000 input and 300 output tokens per call plus CLI/reasoning overhead. No live call until the user approves. Slice B and its separate commit follow only after this stop.

## Review focus

Late responses must merge into the current item rather than an old sidecar. Dirty editor text must keep its transaction mapping when a server snapshot arrives. Disk conflicts must preserve answers and offer persistence retry without repeating inference. A missing note must retain orphan ink. Visibility events must reflect visible completed ink, never background completion. Two simultaneous calls must not overwrite each other. All tests use synthetic disposable roots.
