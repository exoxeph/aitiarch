# Phase 2a: Invoked AI Implementation Plan

> **Status:** Approved with amendments: execute Task 1 only, then report tie-break rules and results and stop before Task 2.
> **For agentic workers:** Use superpowers:executing-plans after approval. Execute the tasks in order, with a failing test before each implementation increment.

**Goal:** Persist and display explicitly requested AI ink without changing human markdown, losing ink, or attaching it to the wrong text.

**Architecture:** Extend the existing Node/React/CodeMirror UI with a separate ink store and pure anchoring functions. Adapt the Python prototype's requested-assistance pipeline to accept explicit notebook roots and selected-source snapshots, with Claude and Codex behind one provider interface. Keep note saves on the existing byte-preserving compare-and-write path.

**Tech Stack:** Existing TypeScript, Node, React, CodeMirror, Vitest, Playwright, Python standard library, and the user's installed authenticated CLIs.

**Spec:** [AITIARCH-UI-SPEC.md](../../../AITIARCH-UI-SPEC.md), confirmed in this conversation. BRIEF.md and NOTES.md supply historical context and privacy constraints.

## Global constraints

- Build Phase 2a only. No proactive caller, boundary-triggered checks, scheduling, or intervention experiment work.
- Root is the project's `.aitiarch` folder; default `./.aitiarch`, `--root` overrides. Never copy notes into this repo or nest another `.aitiarch` beneath the selected root.
- Markdown stays byte-exact. Anchors and ids exist only in sidecars. AI display, re-anchoring, ledger updates, and settings must not write source markdown.
- AI never writes the human's takeaway, Why, or failed-reason. Only explicit human edits and submitted human text may change markdown.
- One pretty-printed JSON sidecar per note, stable key order. Flattened markdown export is decided but outside Phase 2a.
- All tests and checks use synthetic fixture copies in temporary directories. Never open or modify the real notebook during development checks.
- Use the existing requested-assistance grounding checks and failure preservation. No API keys, transcript transmission, hook installation, or frozen experiment changes.
- Per-note proactivity defaults Off. Invoked assistance must work while proactivity is Off.
- Human-owned open decisions remain open. Fake-data layout work reuses the existing theme; it does not settle final ink color, visual identity or diagram theme-variable names.

## Existing code conflicts and gaps

1. `ui/server/main.ts` already selects the correct root; `prototype/aitiarch.py` instead takes a repo root and appends `.aitiarch` for sources, runs and usage. Directly passing the UI root would produce the forbidden second `.aitiarch`.
2. `selected_sources()` is hardcoded to `notebook.md` and line ranges. UI invocation needs arbitrary root-relative notes, precise selections and a frozen request snapshot. A delayed response must retain its original anchor even after selection, note or text changes.
3. The prototype's `ask()` invokes Claude only. Codex hooks and transcript readers do not provide a Codex requested-answer adapter. Add that adapter while sharing prompt/evidence validation and preserving the existing CLI entry point.
4. The UI watcher/API currently handles markdown changes only; JSON sidecar changes, ledger, threads and modes have no routes/events or rendering yet. These are additions, not reasons to replace the Phase 1 save/sync implementation.
5. The UI writes `root/ui-state.json` but does not ensure it is git-ignored for an arbitrary selected project. Existing prototype installation ignores the whole notebook; do not run installation or change the user's note-tracking policy. Propose a one-time notice listing exact ignore lines; no automatic edits to project Git files. The notice is deferred to the UI task.
6. The spec and older notes/docs still contain historical Phase 1 wording (for example editor/save decisions left unchecked and block ids listed as future work in `ui/README.md`). Follow recorded Phase 1 decisions and the confirmed anchoring policy; update relevant run instructions without reopening settled decisions.
7. Rechecked: `phase-1` points to `531e370`. Work on branch `phase-2`; do not change tags or rewrite Git history.

## Review focus

- Indistinguishable duplicates: context/position hints may be insufficient; preserve unresolved ink as orphaned rather than guess an attachment.
- Concurrent changes: late answers, external edits, unsaved typing and sidecar updates must retain identity and must not overwrite unrelated work.
- Storage reliability: malformed sidecars, failed writes and external sidecar edits must preserve the last valid data and surface an error; never silently replace data with an empty store.
- Root confinement: nested notes, same basenames, Windows case/path handling, junctions and symlinks must not collide or escape the selected root.
- Reload/reconnect: threads, shown/dismissed state, human commitment and modes must persist; replaying events must not duplicate ink or ledger records.

## Task 1: Ink store, anchoring and re-anchoring — no AI or UI

**Files:** Create `ui/shared/ink.ts`, `ui/shared/anchors.ts`, `ui/server/root.ts`, `ui/server/ink-store.ts`; extend `ui/server/paths.ts` and store helpers only where required. Create `ui/test/anchors.test.ts`, `ui/test/ink-store.test.ts`, `ui/test/root.test.ts`.

**Boundary:** Pure `captureAnchor(text, from, to)` and `resolveAnchor(text, anchor)` functions operate on the editor's LF-normalized text and use UTF-16 positions consistently with CodeMirror. Results distinguish attached ranges from orphaned ink. Store methods consume root-relative note paths and persist ink separately; they never call the markdown writer. Nested note paths retain their directories under `ink/` to avoid basename collisions.

- [ ] First add `anchors.test.ts`: capture a selected quote with prefix/suffix/position; assert resolution after an edit, deletion, paragraph move and duplicate insertion. Run `npm test -- test/anchors.test.ts` in `ui/` and observe failure before implementation.
- [ ] Implement quote/context/position matching, including closest-match recovery for edited text. Keep unresolved or indistinguishable cases orphaned, retaining ink id, content and original anchor. Test complete note deletion and subsequent restoration without deleting its sidecar.
- [ ] Before implementing persistence, add failing tests for round-trip JSON, stable serialization, nested same-name notes, concurrent/stale writes, malformed existing JSON and failed atomic replacement. Implement validated, version-checked sidecar writes with Windows-compatible atomic replacement; reject traversal and junction escapes.
- [ ] Verify source bytes for LF, CRLF+BOM and mixed-ending fixtures before/after every ink operation. Extend tree/path fixtures to prove private artifacts remain hidden and no nested `.aitiarch` is created. Do not edit Git files automatically. Centralize UI/ink root selection in one shared resolver; the later prototype bridge must consume the canonical root without appending another `.aitiarch`. Keep legacy hook/prototype behavior covered by its existing tests.
- [ ] Deliverable: passing `npm test -- test/anchors.test.ts test/ink-store.test.ts test/root.test.ts test/paths.test.ts test/store.test.ts` and `npm run typecheck`; persisted ink works without AI or browser code.

## Task 2: Inline and margin rendering with fake ink

**Files:** Create `ui/src/editor/ink.ts`, `ui/src/ink/InkBlock.tsx`, `ui/src/ink/MarginRail.tsx`, `ui/src/ink/OrphanList.tsx`, `ui/check/ink-layout.mjs`; modify `ui/src/editor/EditorPane.tsx`, `ui/src/App.tsx`, `ui/src/styles.css`, `ui/src/api.ts`, `ui/server/http.ts`, `ui/server/watch.ts`. Extend `ui/test/http.test.ts`; create `ui/test/ink-view.test.ts`.

**Boundary:** Views consume persisted ink plus resolved anchor ranges. Inline ink uses CodeMirror decorations/widgets and never enters its document. Fake margin data exercises future balloon layout without implementing proactive generation.

- [ ] Start with a failing browser fixture: fake inline answer below its paragraph, two colliding margin balloons, a narrow viewport and an orphan list; assert unchanged markdown and cursor position.
- [ ] Add read-only ink API/events and display inline/margin/orphan views. Keep fixture injection confined to test tooling; no production fake entries.
- [ ] Add failing tests before handling typing, external edits, scrolling, wrapping, rail visibility, reload and reconnect. Anchor geometry follows the displayed editor document; conflicts must not cause a guessed attachment. Sidecar events update views without becoming document edits or save triggers.
- [ ] Verify fake-data layout in a real browser at wide and narrow widths and run relevant HTTP/view tests plus typecheck. Retain screenshots for layout review; final visual identity remains undecided.
- [ ] Deliverable: inspectable layout with fake data, no model calls.

## Task 3: Invoked CLI assistance and shown/dismissed ledger

**Files:** Modify `prototype/aitiarch.py`; create `prototype/providers.py`, `prototype/ui_bridge.py`, `prototype/tests/test_providers.py`, `prototype/tests/test_ui_bridge.py`, `ui/server/assistance.ts`, `ui/server/ledger-store.ts`, `ui/test/assistance.test.ts`, `ui/test/ledger.test.ts`; extend toolbar/editor/API/HTTP/watcher files and existing prototype tests.

**Boundary:** A shared requested-assistance entry accepts an explicit notebook root, question and selected-source snapshot. Provider adapters accept the same request and return the same validated answer envelope. Preserve `ask(repo, question, lines, ...)` as the legacy CLI wrapper. Node invokes the Python bridge with structured stdin and argument arrays, never shell-interpolated question text.

- [ ] Start with failing tests that invoke a fake executable through the actual bridge and assert exact selected context, correct overridden root, private artifacts at that root, and identical output handling for Claude/Codex.
- [ ] Refactor the existing pipeline for root/selection inputs and one provider interface; reuse its grounding checks, raw/partial-response preservation, private run records and usage logging. Inspect installed CLI help before implementing each adapter's isolated, tool-free headless invocation. Keep current authentication; no API-key setup.
- [ ] Add failing tests before wiring Think on this, Ask and Ctrl/Cmd+Enter. Persist an invocation anchor/snapshot before launching; switching tabs, editing or deleting that text during a call must not redirect its answer to a new selection. Returned unresolved ink stays in the orphan list.
- [ ] Add failing tests for missing CLI, timeout, malformed/ungrounded output, process failure and duplicate completion. Show useful errors; never display rejected output as valid ink or automatically rerun calls.
- [ ] Add ledger tests before recording shown/dismissed ink. Record shown when actually presented, retain stable ids across reloads, and make dismissal/replayed events idempotent. Usage is not a substitute for the ledger; no suppression engine is added.
- [ ] Verify both adapters with fake executables, existing prototype regressions and UI tests. No live provider calls are needed for automated regressions.
- [ ] Deliverable: both invoked actions use one provider interface and persist answers/ledger without editing markdown.

## Task 4: Threads and human takeaway with commit-before-reveal

**Files:** Create `ui/src/ink/Thread.tsx`, `ui/server/threads.ts`, `ui/test/threads.test.ts`; extend sidecar types/store, assistance routes, editor integration and fixture browser checks.

**Boundary:** Before building this task, show the exact thread file shape for human review. Thread replies persist in the note sidecar. A human takeaway submission is saved using the existing compare-and-write path before AI summary generation/reveal is permitted. The AI summary remains separate ink and never fills the human text field.

- [ ] Start with a failing test that attempts summary retrieval before durable human submission; assert it is unavailable through the server, not just hidden in the browser.
- [ ] Add persisted thread replies, a blank human-only Write takeaway form and an explicit Skip takeaway action recording skipped in the thread sidecar. Skipping never silently inserts text or reveals the AI summary. Keep Why and failed-reason outside model-generated fields; enforce the ownership restriction in the shared prompt as well as UI routing.
- [ ] Add failing tests for reload before/after commitment, duplicate submit, note edit/deletion during submit, save failure and summary failure. Reveal only after the human text is durably saved; never silently overwrite a conflicting paragraph or append the takeaway twice.
- [ ] Verify the inserted bytes are exactly the human submission plus required insertion delimiters; all unrelated bytes, BOM and line endings remain intact. Summary/replies stay sidecar-only.
- [ ] Deliverable: reload-safe threads and server-enforced commit-before-reveal with no AI-authored takeaway.

## Task 5: Per-note mode, default Off

**Files:** Create `ui/src/ink/NoteMode.tsx`, `ui/test/note-mode.test.ts`; extend sidecar metadata/store, HTTP/client API and top bar.

**Boundary:** Persist mode in each note's sidecar, separate from markdown and tab state. Keep the spec's mode names, but make unavailable proactive choices visibly unavailable during Phase 2a.

- [ ] Start with failing tests that an unset note is Off, mode survives reload, settings are independent per note, and invoked AI remains available while Off.
- [ ] Implement the per-note control and persistence. Add a test that setting non-Off values through a crafted request cannot activate proactive generation in Phase 2a. Do not implement any proactive caller.
- [ ] Verify changing mode leaves markdown byte-identical and does not erase existing ink, threads or ledger state.
- [ ] Deliverable: persistent per-note mode with default Off and no unprompted calls.

## Task 6 (final): Phase 2a check and user-run instructions

**Files:** Create `ui/check/phase2a.mjs`, `ui/check/phase2a-fixture.mjs`; add `check:phase2a` and fixture commands to `ui/package.json`; update `ui/README.md` with exact commands and expected results.

- [ ] First write the failing end-to-end assertion for five invoked questions producing five stable ink ids tied to known fixture paragraphs.
- [ ] Run the real server/browser against temporary fixture copies. Exercise both provider adapters with deterministic fake CLIs by default. Edit one anchored paragraph, move another, duplicate quoted text, delete another, and leave one unchanged. Check every ink id is accounted for exactly once as attached to the intended text or listed as orphaned. Do not guess an indistinguishable duplicate.
- [ ] Reload/reconnect and verify ink identity, threads, ledger, mode and expected markdown bytes. Check both LF and CRLF+BOM fixtures, plus the mixed-ending byte-preservation regression. Fail on missing ink or any incorrect attachment.
- [ ] Document a separate explicit live CLI mode and manual five-question walkthrough using a disposable fixture. Select Claude or Codex explicitly; never use the real notebook. Distinguish deterministic correctness results from real-provider quality and availability.
- [ ] Final verification: in `ui/`, run `npm test`, `npm run typecheck`, `npm run check:phase1`, then `npm run check:phase2a`. Run `python -m unittest discover -s prototype/tests` from the repo root. Record actual results and any remaining limitations; no success claim based on historical Phase 1 results.
- [ ] Deliverable: the five-question check passes, with reports/screenshots and instructions the human can run themselves. Phase 2b remains unbuilt.

## Approval checkpoint

Task list approved with the amendments above. Task 1 must report wrong attachments (required zero), unnecessary orphans and the exact tie-break rules before stopping. Try prefix/suffix and position before declaring ambiguity. Task 2 requires the next instruction. No real notebook operations or provider calls during Task 1; no Git history or tag changes.
