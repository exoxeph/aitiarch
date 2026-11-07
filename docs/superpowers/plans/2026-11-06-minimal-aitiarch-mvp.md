# Minimal Aitiarch MVP proposal

**Defaults and dogfood repository approved 2026-11-07; implementation authorized.**
The minimal local prototype is now installed; see NOTES.md and prototype/README.md.
The first actual accepted-decision edit has two locally corroborated hook matches
and Claude-reported receipt; human usefulness remains ungraded. Approved defaults are distinguished from deferred
long-term features below; the user's personal rationale is not inferred.
The approved offline validation work is complete. Prompt A remains the current
experimental baseline; prompt B is not adopted. Proactive margin comments remain
experimental and disabled by default in the proposed MVP. No second LLM gate.

Subsequent explicit approval (2026-11-07): repository-local Codex advisory hook
parity was requested and implemented for this dogfood repo. Exact accepted-record
delivery is verified through the installed extension's bundled app-server after
manual trust and a Windows command fix. Fresh VS Code chat UI behavior, CLI-exec
coverage and usefulness remain unverified. This updates the earlier parity
deferral below without authorizing broader product features. See NOTES.md.

## Current approval checkpoint

The user approved the recommended defaults, with the clarifications recorded
here. The user selected `<project>`. Inspection found no existing
`.aitiarch` notebook. Use `.aitiarch/notebook.md` and `.aitiarch/decisions/` there;
preserve unrelated untracked site work. Do not substitute the Aitiarch directory.
Prompt experiments are frozen and evidence is preserved in the verified external
archive. No prototype transcript transmission is authorized.

| Status / choice | Approved default or remaining input | Cost to reverse |
|---|---|---|
| Approved: dogfood repository | `<project>`, `.aitiarch/notebook.md`, `.aitiarch/decisions/`; no existing notebook found. | Low initially; path links require updating when moving later. |
| Portable decision record contract | One Markdown file per decision, filename as its identifier; minimal status and literal repo-relative path list; human-readable decision and human-only Why. No database or full schema. | Medium once many records exist: metadata/link migration. |
| Storage and Git boundary | Preserve the existing notebook's tracking policy. Keep newly generated private artifacts local and ignored; track new canonical decision files only after explicit approval. Never add raw transcripts to Git. | Low before publishing; disclosure after a push can be irreversible. |
| AI context/transcript boundary | Requested assistance uses only explicitly selected notebook/decision passages via the installed Claude CLI. Transcript reading is explicit and local; transcript transmission remains off unless separately authorized. | Low to broaden later; information already transmitted cannot be recalled. |
| Canonical write authority | AI returns drafts/alternatives; the user edits and records the accepted decision and Why in Markdown. No automatic canonical writes or generated human rationale. | Medium to add automated writes later: acceptance and stale-write protection needed. |

All five defaults and the actual paths are approved. Approval does not authorize transcript
transmission. If transcript-assisted remote inference is desired, approve that
scope separately; do not infer consent from selecting a local session.

Approved reversible implementation defaults: reuse the Node hook and Python
reader, an existing editor plus small local command, and exact declared path
matches. Keep the hook advisory,
quote recorded accepted decisions, never generate margin opinions in the hook.
Use provisional Windows targets of p95 <=100 ms launch and <=5 ms lookup body,
then measure on the real corpus; these are not established guarantees.

After the actual paths are confirmed, implement only Write -> Ask AI -> Compare alternatives -> Record
human decision -> Edit code -> Resurface decision. Compare alternatives in plain
Markdown. Collect minimal local/manual evidence of useful or irrelevant
resurfacing and whether the user can later explain/defend the choice. This is
real developer use, not another synthetic prompt experiment.

## Smallest practical workflow

Use the existing Markdown editor and Claude Code. The developer writes planning
notes, asks for explanations or draft alternatives when useful, records their own
decision and Why, and later receives the original decision excerpt when Claude
Code edits an explicitly linked path. An explicitly selected coding session can
supply additional context when the developer requests it.

Recommended approach: existing editor + small local commands + advisory hook.
It reuses the transcript and hook spikes without requiring a new interface,
server, database, daemon, or agent protocol. A command-line-only workflow is even
simpler but leaves more manual copying; a dedicated extension would improve
convenience at the cost of packaging and UI work. Neither alternative is selected.

## Proposed scope and ownership

- One local Markdown planning notebook, plus one Markdown file per decision,
  following the brief's existing files-as-record principle. Suggested locations
  are now approved as `.aitiarch/notebook.md` and `.aitiarch/decisions/` within
  the selected dogfood repository.
- The user writes or explicitly confirms a decision. Why is human-written and may
  remain blank. AI may explain evidence and draft decision statements or
  alternatives on request, but must never generate the human's rationale or
  convert an assistant proposal into an accepted decision.
- Start with ordinary editor saves for canonical records. The assistance command
  returns suggestions without automatically rewriting the notebook or Why.
  Adding an automated canonical writer later would require stale-write handling;
  this proposal does not assume multi-user collaboration or eliminate external
  editor conflicts.
- Use explicit human-marked acceptance and path links for resurfacing eligibility.
  The minimal marker/path notation still needs approval. Do not build the brief's
  full tier/confidence/relationship/branch/merge schema.
- On-demand assistance uses ordinary answering/explaining instructions, source
  attribution and uncertainty. Do not apply prompt A's proactive 55-word cap,
  prompt B, or suppression/defer policy to requested explanations.
- Resurfacing quotes a small recorded excerpt with its source path/status. It
  does not generate a new margin opinion, assert an unrecorded Why, reopen the
  decision, or ask a question on every edit.

## Minimal implementation sequence after approval

| Step | Work and dependencies | Completion check |
|---|---|---|
| 1. Real notebook | User selects a dogfood repository, notebook location and minimal accepted/path notation. Create only the agreed Markdown examples; manually record a few actual decisions. No transcript-to-decision mining. | The user can create, edit and read records without Aitiarch; proposed text and accepted human decisions remain distinguishable. |
| 2. Requested assistance | Add a small command/Claude Code invocation wrapper using the installed CLI. It takes a user-selected paragraph and optionally selected source excerpts; returns explanation or draft without saving canonical Why. No service or automatic calls. | One real explanation and one draft are useful to the developer; source references resolve; declining/applying a draft is explicit and preserves human rationale. |
| 3. Context bridge | Reuse `spike/transcripts.py` read-only adapters. Require explicit provider/session selection when conversations compete; show the selected ID and excerpt before including it in a requested AI interaction. Keep snapshots local and ignored. | Two sessions in one repo cannot silently swap; malformed/compacted content keeps existing diagnostics; excerpts have provider/session/source-line/snapshot references. No transcript is treated as an accepted decision. |
| 4. Claude resurfacing | Adapt `spike/pre-tool-use.cjs` from one fixture to the agreed small accepted-record set and explicit paths. Return quoted `additionalContext` for Edit/Write. Missing/malformed records and misses produce no context and no permission decision. No LLM or transcript scan on the hook path. | Known path hit includes the correct record; unrelated paths and proposals do not surface; malformed data never denies an edit; Windows launch/body timing is measured on the real corpus. |
| 5. Real use | Use this loop for two working days on the chosen repo. Record manual useful/irrelevant/missed resurfacing observations, interrupted flow and time spent recording. | The developer can name an actual saved lookup or avoided repeat, inspect noise counts and decide whether to continue. Expand only after reviewing this evidence. |

Implementation file layout is deliberately small: Markdown records in the
approved location; one assistance wrapper and one advisory hook; the existing
transcript module reused rather than rewritten; targeted integration tests. Exact
runtime/package layout follows the choices below. Do not scaffold it now.

Basic hook correctness does not depend on the assistance wrapper or transcript
bridge being complete. Neither the hook nor requested assistance depends on
proactive margin intelligence. The entire proposed workflow can operate with
proactive generation absent.

## Dependencies and existing evidence

- Existing Markdown editor/VS Code and installed Claude Code CLI with working
  model access for explicitly requested assistance. No new account/provider
  integration is proposed. Ordinary remote AI assistance still transmits supplied
  context; local storage does not mean offline inference.
- The current spikes use Python's standard library for transcript parsing and
  Node for the dependency-free hook. Locally observed: Python 3.11.9 and Node
  v24.19.0. Reusing both is the recommended low-rewrite option, pending runtime
  approval; an all-Node port is an alternative with more parser regression work.
- Claude Edit/Write context delivery was verified previously. No user hook
  settings are changed until the implementation is approved. Future integration
  should re-check the installed hook contract and test its actual launch command.
- Previous one-file Windows shell-launched Node measurements were 72.10 ms median
  and 77.46 ms p95; live read/match body was about 0.95 ms. Proposed p95 <=100 ms
  launch and <=5 ms body budgets remain provisional and require review. Full
  dispatcher overhead and a real multi-record corpus are not yet measured.
- Transcript storage/freshness and explicit older-session selection were verified
  previously for Claude and Codex. Newest modification time is a heuristic, not
  the user's intent; exact post-compaction model context is not reconstructed.
  Large-history scans must stay outside the edit hook.
- Canonical notes may be versioned if the user wants. Raw sessions, snapshots,
  extracted private evidence and local experiment outputs stay ignored. Nothing
  sends a complete session automatically. A selected transcript excerpt goes to
  a model only in an explicit user-requested action with that scope visible.

## Clarifications and remaining input

| Choice | Current status | Alternative / consequence |
|---|---|---|
| Dogfood repo and notebook location | Approved: `<project>`, `.aitiarch/notebook.md`, `.aitiarch/decisions/`; no existing notebook found | Running across many repos first adds relevance and privacy ambiguity. |
| Minimal record notation | Approved: one Markdown file per decision, explicit acceptance/path list, human-written Why. Use the smallest portable notation; no full schema. | The fixture format is evidence, not a mandate to implement the brief's draft schema. |
| Invocation surface and runtime | Approved: existing editor/Claude Code plus a tiny wrapper, Node hook and Python bridge | Dedicated extension and runtime consolidation are deferred. |
| Transcript sharing boundary | Local reading is separate from transmission. No provider transmission without separate explicit authorization. | Selecting a local session or requesting a local read does not authorize uploading excerpts. |
| Hook launch/budget and relevance | Approved starting point: exact declared paths; p95 <=100ms launch / <=5ms body remain provisional measurement budgets | These are not demonstrated production guarantees. Broader matching/indexing waits for real-use evidence. |

Repository license/distribution, build-from-scratch versus adopting another
project, Codex hook parity, default tiers and sensitive-path policy remain the
human-owned open choices in BRIEF.md. This proposal does not settle them or
accelerate Codex parity. Before sharing/installing beyond the chosen local repo,
review licensing and configuration boundaries.

## Explicitly deferred

No custom UI, MCP server, database, embeddings, automatic decision extraction,
full schema, tier enforcement, learning quizzes, cross-machine sync, scheduling,
second model gate or new proactive experiment. The actual dogfood paths are confirmed; only the minimal local hook configuration
is installed. No new dependencies or deferred features are authorized. Adding these is not
required to observe useful real developer behavior.

The actual dogfood repository path is confirmed and implementation authorized. The original
Riddled-style web notebook, inline AI assistance, branching and learning features
remain long-term vision; they are outside this workflow prototype. Human-owned
decisions and reasoning remain human-owned; AI is available when asked and
otherwise quiet. Real-use observations must be collected during actual developer
work, never manufactured by treating regression fixtures as dogfood evidence.
