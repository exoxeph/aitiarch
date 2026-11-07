# Phase 2a Task 4: threads, takeaway and Skip

Status: human decisions incorporated; Slice A data layer implemented, Slice B UI awaits review. No live calls are authorized by this document. Sources: **[Spec]** = UI spec/brief, **[Code]** = existing code, **[Decision]** = the human's approved Task 4 choices, **[New]** = implementation detail or future UI proposal.

## Scope and ownership

**[Spec + Decision]** A thread is one selection's ink item, its initial answer and followups, with human takeaway/history. Invoked answers remain inline; an expanded thread uses the margin/panel (full-width on narrow screens). Proactive notes remain Phase 2b, and decision-card Peek remains Phase 3. No metadata, anchors, ids, questions or AI-generated text is added to Markdown.

**[Spec]** The human alone writes the takeaway, Why and failed-reason. The AI must never write, suggest, pre-fill or edit them. Human textboxes start empty; there is no AI-generated suggestion or summary-to-takeaway shortcut. Ordinary answers remain visible after strict validation. Only the separate closing summary is withheld.

**[Decision: supersedes the older spec's Skip rule]** A closing summary becomes revealable after the user submits a takeaway **OR explicitly clicks Skip takeaway**. Skip reveals an existing validated closing summary; if none exists it permits an explicitly requested summary, without automatically making a provider call. Closing the panel alone is not Skip. There is no Peek button in Task 4 and no hard gate on continuing work. T0/T1/T2/unclassified threads all share this closing-summary rule. Separately, the spec's future proposed-T2 decision recommendation waits for a human pick/Why or logged Peek; Task 4 does not implement or infer that tiered decision flow.

**[Code]** The current prototype's `new_decision` creates an empty human-written Why section; current UI metadata helpers are read-only. No decision files are rewritten by Task 4. Current provider prompts and answer validators remain unchanged in Slice A. Structural write boundaries can prevent AI output from entering human fields; they cannot prove the semantics of all free-form AI prose. Slice B must preserve the prompt prohibition and provide no owned-field suggestion UI.

## Final Slice A storage and migration

**[Code + Decision]** Keep outer ink `v:2`, note/version/hash fields, existing initial body/generation and anchors. Add optional `thread` on an ink item. One existing `ink/<relative-note>.ink.json` sidecar, never a separate thread file. JSON uses existing recursive alphabetical key order and chronological arrays. Existing 8 MiB sidecar limit remains.

**[New]** `ThreadStore.read` projects older v2 items as empty thread schemaVersion 1 in memory without rewriting disk. The first explicit thread mutation lazily persists that record through InkStore's lock, compare-and-write, note/hash checks and atomic replacement. Existing non-thread items remain unchanged. There is no ink-v1 reader or v1 migration. Unsupported nested schema versions and unknown fields fail closed; older binaries cannot read new thread-bearing files and must not overwrite them.

### Field names, types and synthetic examples

**[Code + New]** The existing outer shape remains `{v:2, note:string, noteVersion:string|null, lastSeenTextHash:string|null, items:InkItem[]}`; existing version/hash values are 64-hex strings. An item gains this exact nested record:

```json
{
  "dismissed": false,
  "followups": [],
  "providerConfirmations": [],
  "schemaVersion": 1,
  "summary": { "reply": null, "revealedAt": null },
  "takeaway": {
    "events": [
      { "action": "skip", "at": "2026-11-08T00:01:00.000Z", "text": null }
    ],
    "state": "skipped",
    "text": null,
    "updatedAt": "2026-11-08T00:01:00.000Z"
  }
}
```

**[New]** Thread field types:

| Field | Type/constraint |
| --- | --- |
| schemaVersion | literal 1 |
| dismissed | boolean, also mirrored to existing initial generation.dismissed |
| followups | ThreadReply[], at most 100 |
| providerConfirmations | `{at:string, from:"claude"|"chatgpt-plan", to:"claude"|"chatgpt-plan"}[]`, distinct providers, at most 100 |
| summary.reply | ThreadReply or null |
| summary.revealedAt | timestamp string or null; only valid for a completed summary |
| takeaway.events | `{action:"submit"|"skip"|"reopen", at:string, text:string|null}[]`, at most 1,000 |
| takeaway.state | "untouched", "submitted" or "skipped" |
| takeaway.text | exact human-submitted string or null; at most 100,000 characters |
| takeaway.updatedAt | latest action timestamp or null |

**[New]** A submit event requires non-blank human text, preserved character-for-character, with no comprehension/quality check. Skip/reopen events require null text. The current state/text/time must agree with the action history; fabricated inconsistent snapshots are rejected. Reopen records undo without deleting the earlier submission/Skip timestamp. Already seen summaries cannot be made unseen: revealedAt survives reopening. Skip preserves private drafts.

**[Code + New]** ThreadReply has exact required keys `{body:string, generation:Generation, id:string, parentId:string}` and optional `{failure:{code:ThreadFailure}}`. Each reply's generation.requestId equals its own id; the initial response id is the ink item id. Parent links must resolve to the initial response or another response without a cycle; dispatch requires an already completed parent, including a completed closing summary. Existing Generation keys/types remain:

```json
{
  "action": "ask",
  "createdAt": "2026-11-08T00:02:00.000Z",
  "dismissed": false,
  "evidence": [],
  "model": null,
  "provider": "claude",
  "requestId": "reply-fixture-2",
  "status": "pending"
}
```

**[Code]** action is think/ask; provider is claude/chatgpt-plan; model is null or a bounded model identifier; status is pending/complete/error/cancelled. Evidence uses existing `{sourceId:string, sourceHash:string, quote:string}` for N1/D1?D8 note/decision sources, at most 32 quotes of at most 240 characters. No agent transcript sources are added. body is a validated accepted answer, at most 100,000 characters. Pending/error/cancelled followups have EMPTY body and evidence; the UI renders safe status labels instead of partial model text. Initial historical error items retain their existing representation.

**[New]** Fixed ThreadFailure codes: unavailable, disabled, hourly_cap, usage_limit, validation, interrupted, protocol, timeout, cancelled, provider_error, persistence. Arbitrary error text or extra fields cannot enter this record. Provider responses are strictly projected into answer/generation fields, never assigned wholesale into a thread or human draft.

### Drafts: private ui-state, never ink

**[Decision]** Human drafts live ONLY in git-ignored `ui-state.json`. No draft field is accepted in the tracked thread schema. Human followup questions remain memory-only; do not serialize them, assembled prompts, credentials, external transcripts or raw provider results.

**[New]** Existing UI state v1/tabs/active gains optional `threadDrafts`, an object keyed by SHA-256(note-relative-path + NUL + inkId). Each value has exactly `{inkId:string, note:string, revision:string, text:string, updatedAt:string}`. Example values are inkId `thread-fixture-1`, note `fixture.md`, random revision id, exact human text `Half typed`, and an ISO timestamp. Updates require the previous revision (null for new); mismatches are visible conflicts, not last-writer-wins. At most 1,000 drafts, each at most 100,000 characters; the complete UI-state file is bounded at 2 MiB.

**[Code + New]** Shared UiStateStore preserves drafts during ordinary tab saves. Writes reject links/hardlinks, malformed existing state and unsafe paths; lock and atomically replace the file. Git must verify that both `ui-state.json` AND its atomic temporary path are ignored. Otherwise persistence remains off and reports this exact suggested line: `/ui-state.json*` (covers temporary files too). No ignore file is edited. UI must keep an unsaved draft locally and surface this notice, rather than silently claiming a save. Draft reads are local only. A submitted takeaway does not silently erase a concurrently edited draft; clearing/replacing a draft is a separate explicit revision-checked action in Slice B.

### Ledger

**[Code + New]** Retain exact ledger v1 `{v:1, events:[]}` and each event's `{at,event,id,inkId,note,requestId}` keys. event stays shown/dismissed, timestamps are strings, ids are opaque ids, note is a relative path. Deduplication now uses inkId + requestId + event, allowing multiple accepted responses in one thread. No takeaway, reason, prompt, question, token or model output text enters the ledger.

**[New]** shown is emitted only when a completed accepted response is displayed; a hidden summary is not shown merely because it arrived. Dismiss records completed responses, hides and preserves the thread, and Restore retains ledger history. Confirmed Delete removes the entire selected ink item/thread and its private draft; ledger history remains without content. A late result cannot recreate a deleted thread. Sidecar deletion and draft cleanup are two files: if cleanup fails, report ?Thread deleted; private draft cleanup pending?, never resurrect data or resend a request.

## Human UI behavior (Slice B, not implemented yet)

**[Decision + New]** A takeaway is first submitted to the sidecar. Separate ?Insert my takeaway into note? shows an exact preview, then applies a normal human editor transaction through existing compare-and-write. A pure data-layer preview helper exists; no automatic insertion or new UI was built in Slice A. Its fixture test uses a real editor transaction plus Store.write and verifies BOM/CRLF and surrounding bytes. Stale versions and orphan anchors reject insertion. No metadata or hidden linkage is inserted. Markdown undo only undoes that explicit edit, not the sidecar history; undoing a thread action appends reopen. No automatic reinsertion follows undo.

**[Decision]** The panel starts a blank human-only takeaway box, offers Submit, explicit Skip takeaway, Reopen, Dismiss/Restore, and a separate confirmed Delete. Drafts survive reload when saved. Skip is distinguishable from merely closing or untouched state. A stored answer whose question was not persisted shows: ?Question text was kept in memory only and is unavailable after reload.? No bare answer pretending the question is available.

**[Decision + New]** Provider choice is pinned per request. The existing server selects one provider at startup; Slice A adds no provider dropdown. Before the first new transition between providers in a thread, show one line naming the old/new provider and exactly what the reviewed request sends; require confirmation. Record that directed transition once. Current data-layer notice describes selected note and in-memory question, with no human drafts or external transcript. Slice B must keep that description in sync with its actual request builder; adding prior-answer context requires a reviewed, truthful notice. Never reroute a pending request, relabel history or fall back automatically to another provider.

## Orphans, edits and concurrency

**[Spec + Code]** Keep existing mapping/search and shared attachment result for inline, margin and Activity. Candidates-then-selected-text re-attachment remains unchanged; reject a stale selection, capture the new anchor and retain original/history. Do not tune rules against anchoring holdouts.

**[Decision + New]** Orphaning/deletion of note text preserves all replies, submitted takeaways, Skip history and private drafts. Display orphan/has-takeaway/skipped badges independently. Primary derived status order: dismissed, orphaned, has_takeaway, skipped, open. Re-attachment changes only anchoring. Overlapping threads keep independent ids/data; deleting one leaves the other. External Claude Code/Codex edits use existing note sync; half-typed takeaway belongs to ui-state and cannot be overwritten by note remapping. Same-draft revision conflicts require human resolution. Dismissal survives late completion; confirmed deletion prevents resurrection.

## Failures for both providers

**[Code + New]** Previous accepted answers and human work remain available on every failure. No partial answer becomes accepted. Slice A provides fixed per-reply failure records; Slice B must map actual adapter outcomes to these records and labels without weakening adapter checks.

| Case | Claude CLI | ChatGPT-plan |
| --- | --- | --- |
| Disabled/unavailable | Explain missing CLI/login or unverified isolation; keep question draft | Explain flag/connection/model/storage requirement; no implicit sign-in or refresh |
| Hourly cap | No existing Claude product hourly cap; do not invent one | Local cap reached, no request sent and no auto-increase |
| Remote usage limit | Safe provider error, possibly generic classification | Documented plan-limit message, no retry or billing fallback |
| Validation rejection | Fixed failed rule, empty failed-reply body | Same; response.completed alone is insufficient |
| Tab closed | Server may still finish; reopen persisted result/status | Same; no quota refund assumed |
| Server stopped during loading | Reconcile abandoned pending to interrupted; never rerun automatically | Same; only reconcile ids known not active |
| CLI/stream format changed | Fail capability/event/schema checks; no auto-allowlist | Reject first unknown event/field/item; no auto-allowlist |
| Deadline/cancel | Existing process-tree cleanup rules | Existing abort/deadline rules; remote charge may still occur |
| Save failure | Retain validated answer in memory and offer save-only retry | Same; never repeat inference to recover persistence |

**[New]** Data layer never invokes a provider. Runtime active-id reconciliation, provider availability/errors, cancellation, persistence-retry wiring, notices and question placeholders belong to Slice B. A browser polling failure alone is not proof that a server job was interrupted.

## Tests and review boundary

**[Decision + New]** Every slice starts with failing tests; all tests use synthetic fixture copies and fake providers only. Normal suite includes thread ownership evaluation cases. The initial seven cases were authored during implementation: they are adversarial regression cases, NOT an independently human-authored holdout result. Human cases can be added separately to that evaluation set without changing/tuning against their text. Existing anchoring holdouts remain untouched and run via the existing regression suite.

Slice A test groups: legacy v2 read/lazy migration/stable serialization; unsupported thread schema/unknown fields/history consistency; exact human submit/Skip/reopen; ignored-only draft storage, temporary coverage, reload, stale draft revision and corrupt-state preservation; HTTP tab-save preservation; dismiss/restore/confirmed delete; orphan/re-attachment/missing-note survival; overlapping-thread isolation/stale sidecar actions; provider pinning/first-transition confirmation; summary permission/reveal/ledger per-response deduplication; both providers ? eleven failure codes; interrupted reconciliation/late deletion completion; valid result preserving human fields; seven ownership attacks; normal editor insertion preserving BOM/CRLF plus stale/conflict/orphan refusal. Full suite, typecheck and native Node server-module load are required.

Slice B tests to write first: blank-human-box/no-suggestion; Skip reveals summary; insert preview/cancel/apply/undo; revision conflict and ignore notice; provider-change confirmation and truthful payload; question-lost placeholder; failure states for both fake providers; no automatic requests; navigation/reload/draft preservation; all data boundaries through authenticated HTTP routes.

UI fixture checklist for Slice B: keyboard/focus/accessibility; margin/panel/narrow-screen layout; scroll/typing with overlapping threads; close versus Skip; submit/Skip/reopen/restore/delete confirmation; summary reveal; external edit while half-typed; orphan candidates and stale selection; provider badges/first-transition confirmation; failure/save-only retry. Screenshots use disposable fixtures only and remain untracked.

Stop after Slice A commit and show the actual JSON shape, test results and differences. Wait for human approval before Slice B. No live provider check, real notebook access or unrelated commit is part of either automated slice.
