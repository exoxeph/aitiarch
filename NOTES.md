# Feasibility experiments — 2026-11-06

## Before the first push

Scrub git history of the original NOTES.md content, including the commit behind
the phase-1 tag, before this repo is published anywhere. Do not rewrite history
now. The byte-exact original is retained locally in git-ignored NOTES.private.md.

This public copy paraphrases message text and omits generated answer excerpts,
session identifiers, transcript filesystem paths and identifying local paths.
Decisions, results, timings, test counts and conclusions remain recorded below.

## Phase 1 web UI — decisions and status (2026-11-07)

The earlier "no UI yet / on hold" statements in BRIEF.md and below are historical. The user approved the
Phase 1 task list of `AITIARCH-UI-SPEC.md`; source lives in `ui/` (see `ui/README.md`).

**Decisions made by the user (not by the agent):**
- Editor engine: CodeMirror 6 live preview. Markdown is the canonical file and stays byte-exact; no
  markdown→document→markdown conversion. Minimal decorations now; tables and polish after Phase 2.
- Obsidian compatibility: nice-to-have, not a requirement. Plain wikilinks and frontmatter only; no
  `^block-ids` until Phase 2.
- Saving: autosave with a short debounce; every save is compare-and-write against the last version the
  editor saw, never a blind overwrite.
- CRLF/BOM: detected on load, re-emitted exactly, with tests. Properties panel is read-only in Phase 1.
- File watching: `fs.watch` plus a polling fallback.
- UI source lives in the Aitiarch repo (`git init` done; nothing committed). `.aitiarch` lives in each
  project's repo; notes are never copied here. Default root `./.aitiarch` under the current directory;
  `--root` overrides it (tests, other folders such as `<project>/.aitiarch`).
- "Don't know yet" on a failed mark is written `~~text~~ {failed: ?}`.
- Open-tab state: `ui-state.json` inside the root's `.aitiarch` folder (should be git-ignored).
- Build bundle: not committed for now.
- **Deferred, not Phase 1:** decide which parts of `.aitiarch` a normal user commits (notebook, decisions)
  versus ignores (usage, runs, measurements, backups, `ui-state.json`).

**Verified (2026-11-07, this machine, Windows 11, Node 24.19, Edge via Playwright):**
- `npm run check:phase1`: 28/28 scenarios. While a browser types in one paragraph, a separate process
  edits another; text, cursor and on-disk bytes were exactly right in all 24 runs (20 LF, 4 CRLF+BOM). The
  outside edit appeared in the editor after min 39 / median 51 / p95 54 / max 56 ms (limit 1000 ms).
  Same-paragraph edits show a conflict marker and pause saving (checked: nothing overwritten; Keep mine and
  Take theirs both leave the right bytes). Opening and browsing a mixed-line-ending, BOM, mermaid-bearing
  note changes no bytes and does not touch the file; an edit there changes only the edited bytes.
- One extra pass used Claude Code's real Edit tool while the browser typed 126 characters: text, cursor and
  disk were all correct; the change appeared 39 ms after it reached disk.
- 101 unit/HTTP/real-server tests and `tsc --noEmit` pass. Mutation checks: reverting CRLF handling,
  removing the conflict pause, and replacing the merge with a naive whole-document overwrite each made the
  relevant tests or the check fail, as they should.
- Found only by running the real server: Node's native TypeScript mode rejects constructor parameter
  properties, which vitest accepts. Fixed, and a test now boots `node server/main.ts` directly.

**Limits and open items (honest):**
- No filesystem offers an atomic compare-and-swap. The server re-checks right before the atomic rename and
  verifies after; the race window is tiny, not zero.
- Latency was measured on warm, local, small notes. Not measured: very large notes, network drives, other
  OSes/browsers, and VS Code's embedded browser.
- Not built (later phases): block ids, margin/ink/threads, AI actions, agent diagrams, decision cards,
  branches, track changes, outline/backlinks.
- License review pending: direct dependencies are MIT/Apache-2.0 (+ DOMPurify MPL-2.0 OR Apache-2.0).
  Transitive: `elkjs` (EPL-2.0 OR GPL-3.0, via Mermaid), `lightningcss` (MPL-2.0, build-time), `khroma`
  (no license field), `robust-predicates` (Unlicense). Matters for the still-open project-license decision.

## Current prototype status - 2026-11-07

The minimal no-custom-UI dogfood prototype is installed locally in
the selected project repository: notebook `.aitiarch/notebook.md`, decision directory
`.aitiarch/decisions/`, and an advisory Edit/Write hook in local Claude settings.
No existing notebook was found. At installation, all 227 tracked site files and
the pre-existing Git status were unchanged. The user's subsequent Claude Code
test changed only `src/pages/index.astro` (two insertions/two deletions), as
verified with Git diff. New local files are ignored; this agent made no commits
or pushes.
The Riddled-style web notebook, inline assistance, branching and learning remain
long-term vision, outside this workflow prototype.

See [prototype instructions](prototype/README.md) and the
[approved plan](docs/superpowers/plans/2026-11-06-minimal-aitiarch-mvp.md).
The commands support writing in the existing editor, previewing/sending selected
notebook passages for requested explanations or comparisons, making a blank
proposed record for the human to edit, resurfacing accepted records, local-only
explicit-session reading and manual feedback. Neither accepted decisions nor
human Why are auto-written. The user has now recorded and accepted the first
real decision, `homepage-story.md`; its rationale is preserved without editing.

### Codex integration and resurfacing verification - 2026-11-07

Implemented the requested Codex adapter in `prototype/codex-pre-tool-use.cjs`
and an idempotent local installer, `prototype/install_codex.py`. The Claude
adapter and Codex adapter share the existing bounded, exact accepted-record
lookup. Decision format, human Why, baseline prompts and frozen experiments are
unchanged. No transcript is opened by the hook, no provider/API client was added,
and proactive model comments remain disabled. Native apply_patch add/update/
delete/move headers support multiple files, Windows separators/absolute paths
and nested working directories. Outside paths and junction escapes cannot match.
Shell writes do not trigger this adapter. Existing limits remain: first 100
sorted short records, at most two matches / 6,000 record characters. This is not
a complete interception or security boundary.

Installed versions: CLI **0.160.0**, VS Code `openai.chatgpt`
**26.1021.22027**, extension-bundled Codex **0.164.0-alpha.11.1**. Read-only
app-server checks on both binaries discovered the project hook with no config
warnings/errors. The project was already trusted. The user reviewed/trusted the
initial definition through `/hooks`; this was independently observed as
`trustStatus: trusted`. No agent-written global trust/config changes or bypass
flags were used. [Official hook documentation](https://learn.chatgpt.com/docs/hooks)
documents project `.codex/hooks.json`, `tool_input.command`, advisory
`additionalContext`, Windows command overrides and exact-definition review.

**Preserved failures and Windows fix:** the initial extension-binary
`codex exec --ephemeral --json --no-daemon` path completed the intended small
edit, but emitted no hook event and the model reported no context. This is a
failed resurfacing test, not a success. Its cause is not established; discovery
and trust must not be substituted for runtime coverage. A subsequent app-server
diagnostic used a native identical-line/no-op patch: the hook fired, but the
runtime reported `hook exited with code 1`, duration **576ms**, with no Node
usage event. Running its exact command through PowerShell reproduced a parser
error: a quoted executable needs the `&` call operator. The installer now sets
the documented `commandWindows` override to `&` plus the quoted command. A new
regression reproduced the missing override, then passed with the exact command
executed by PowerShell. The changed hash was independently marked `modified`;
the user then approved the corrected definition again. Metadata independently
confirmed `trusted` for the new hash. No failed outputs were overwritten.
The app-server diagnostic agent additionally read
its installed mandatory skill; it did not report reading a decision file.

**Successful delivery, with limits:** the recovery through the extension's
bundled **app-server** completed a real native apply_patch invocation against the
linked homepage. Runtime `hook/completed` reports **completed**, **384ms**;
the local `codex-hook` log reports **2.4966ms** parse/lookup, `matched: true`,
`context_emitted: true`, record `homepage-story.md`. Runtime context and local
emission have the same SHA-256, and the context contains the exact complete
accepted record, including untouched human Why. The receiving model quoted the
advisory opening and named the record without reading files in this recovery
turn. This verifies emitted context, runtime acceptance and reported receipt
separately. It does **not** establish respect for the decision or usefulness.
The actual VS Code chat UI was not driven; its installed app-server binary was
tested directly. A fresh independent extension conversation remains worthwhile.

There were **three native smoke attempts**, preserved separately: the initial
CLI edit/no hook; app-server intended no-op/launch failure; corrected app-server
intended no-op/successful delivery. Only the initial label edit is retained.
The recovery model also added two indentation spaces despite the no-op request.
Byte verification caught this; its raw output and resulting source were retained
locally, and the two spaces were restored after verifying the exact difference.
Thus even this small test demonstrates why hook delivery and model compliance
must remain separate. No additional inference is needed for this task. The
CLI-exec coverage failure remains unresolved, not papered over by the successful
app-server result. No hook-trust or permission bypass was used.

**Local checks:** **26 prototype tests** pass, including eight Codex tests;
**57 frozen spike tests** pass, including existing grounding checks. Both Node
files pass syntax checks. Tests cover multi-file operations, both move endpoints,
Windows/absolute/nested paths, malformed/oversized input, unrelated/proposed/
empty/wildcard decisions, junction containment, exact record line endings,
advisory-only output, local configuration preservation and private backup/log
exclusions. Review found and fixed a standalone-installer privacy gap: backups
and logs now receive a `.git/info/exclude` entry even without earlier prototype
initialization. This was reproduced by a failing ignore assertion before fixing.

**Portfolio edit/checks:** the one persistent edit shortens only the outer
story region label to describe engineering work and its outcomes (paraphrased). Exact
bytes match the pre-smoke file with that one substitution. Of **237 baseline
files** hashed, only `src/pages/index.astro` changed; the accepted record,
notebook, Claude settings and pre-existing work stayed unchanged. Astro check:
**0 errors, 0 warnings, 4 existing hints** about `window.__frames` in untouched
`scripts/perf-runtime.mjs`. Vitest: **59/59**, 11 files. npm printed a redundant
`--run` argument warning; the test script itself is already `vitest run`.
Build, Playwright and content lint were not run; no push is planned.

**Timing, not usefulness:** all probes are local, tagged `technical-probe`,
and make no model calls or edits. First report: 20 fresh processes per case;
actual accepted-record hit Node direct median/p95 **45.12/50.54ms**, Git Bash
**110.38/171.88ms**; actual hit body across 41 probes **1.70/3.42ms**. The second
report adds the real Windows PowerShell command, with tests/site checks running
during portions of measurement. Actual hit PowerShell median/p95
**453.37/594.93ms** (20 samples); miss **609.85/903.64ms**. Under that load,
actual hit Node direct **99.60/166.22ms**, Git Bash **164.63/197.36ms**;
temporary-hit body across 60 samples **5.97/9.88ms**. These are warm-cache,
nearest-rank p95 measurements, not a representative performance study. The old
100ms launch / 5ms body target is not met reliably on this Windows route.
Retain the 2-second fail-open timeout; a **proposed, unapproved** operating
budget is 1 second launch and 10ms body p95 for this small local corpus, subject
to actual-use measurements. Do not silently reuse the earlier sub-50ms guess
or the faster direct-Node number as VS Code latency.

All new evidence is local and ignored under dogfood
`.aitiarch/measurements/codex-integration/` (baseline hashes, discovery/trust
states, exact direct-probe input/output, frozen smoke events, PowerShell failure
and verification). Timing reports remain `.aitiarch/measurements/hook-probes-*`.
Private raw smoke output was not committed. The smoke prompt requests only a
source edit; no transcript context was supplied. Existing transcript bridge and
assistance evidence/citation validators are unchanged. Fresh-session independent
VS Code test instructions are in `prototype/README.md`; actual model receipt and
human usefulness remain separate questions from hook emission.

### First live decision resurfacing - 2026-11-07

The user supplied Claude Code's report of an actual edit of the linked homepage
file. The local hook log independently corroborates **two live matches**, both
with `error: false`: lookup/body times **3.6925ms** and **2.5266ms**. Their UTC
timestamps are 2026-11-06 18:46:38.070 and 18:46:53.173 (2026-11-07 in Dhaka).
These measure the lookup body, not process launch, dispatcher time or total edit
latency. The requested section/aria-label edit is present in the actual source.

Claude reports that each attempt received Aitiarch's advisory header followed
by the full accepted decision record, including the original human Why and
alternatives. Exact receipt is attributed to that user-supplied Claude report;
this verification did not read or transmit a session transcript. It saved a
private observation and current decision hash under
`.aitiarch/measurements/first-live-resurfacing.json` and did not edit the record.

The first edit was reportedly denied by a separate fact-forcing gate; the next
succeeded. The message matches the enabled ECC plugin's GateGuard hook:
`pre:edit-write:gateguard-fact-force` is registered for Edit/Write/MultiEdit,
its installed source requests supporting facts (paraphrased), and it returns
`permissionDecision: deny`. Aitiarch's inspected source returns only advisory
additionalContext or `{}`. This identifies a matching installed blocking hook,
not an independently captured runtime trace of that plugin. No hook/plugin
settings were changed or disabled.

Claude reports Astro check 0 errors/0 warnings plus 4 unrelated hints, Vitest
59/59 and a successful 10-page build. It explicitly did not run Playwright or
content lint. These are Claude-reported checks; they were not rerun during this
documentation-only verification and must not be described as the full site gate.

**What this establishes:** Aitiarch executed and matched on two real edit attempts;
the receiving agent reports seeing the recorded text. **Still unproven:** added
usefulness, reduced confusion or improved decisions. Claude had already read the
record manually, so this cannot demonstrate incremental recall benefit. There
is no human usefulness grade yet. The next natural-use observation should come
from ordinary work in a fresh session without manually mentioning the decision;
do not manufacture another edit just to accumulate successful hook events.

### First actual requested assistance and technical measurements

The user requested an assessment of whether the homepage communicates the
portfolio story clearly (paraphrased). The request and a labeled copy of the locally
rendered homepage were added to the notebook without recording a decision or
rationale. The existing dev server at port 4440 was reused; site code was not
changed. Desktop/mobile screenshots and the captured copy remain local.

One requested Claude CLI invocation sent only selected notebook lines 10:334
(7,291 characters), not coding-agent transcripts or screenshots. It completed in
**30,679.029ms**, passed mechanical grounding/display checks, and returned
**$0.073011** cost metadata. Usage: Sonnet 5 input 2, cache creation 4,535,
output 2,830; Haiku 4.5 input 3,275, output 14; no cache-read tokens reported.
These are returned CLI usage/costs, not an invoice or proof of a single internal
provider inference. No retries/rerolls or new margin experiments occurred.

The generated answer excerpt is omitted; this paragraph paraphrases the finding.
The assessment connected the page's verification theme and repeated
failure/check/result/limit structure to narrative coherence; visitor
understanding remains untested. This is advisory interpretation, not the user's
judgment or an accepted design decision. Source existence and exact quotes do
not prove every interpretation: the assessment treated the résumé/contact CTA
as a thematic return despite the absence of a literal final thesis sentence.
No final usefulness grade or human feedback has been invented.

The original request, raw response, validation, usage and readable `answer.md`
are retained in the selected project's private `.aitiarch/runs/` directory. Model output does not
rewrite the notebook or human rationale. Requested assistance has no proactive
suppression policy, 55-word cap or mandatory question ending.

Technical hook probes used 20 fresh processes per launch/case, warm caches:

| Probe | Median ms | Nearest-rank p95 ms |
|---|---:|---:|
| Actual installed repo, miss, direct Node | 37.43 | 41.43 |
| Actual installed repo, miss, Git Bash | 74.85 | 80.75 |
| Temporary synthetic record, hit, direct Node | 39.98 | 41.80 |
| Temporary synthetic record, hit, Git Bash | 75.40 | 79.64 |
| Temporary hit lookup body, 40 samples | 1.99 | 2.31 |

These meet the provisional <=100ms launch / <=5ms body budgets in these probes.
They do not measure Claude dispatcher overhead, a real accepted-decision corpus,
or user benefit. Forty miss events in the actual repo are explicitly labeled
technical probes; fixture hits never become human decisions. The one assistance
event is separate. At that setup checkpoint human feedback count was zero and
accepted-record receipt was unobserved. The subsequent real decision/edit/hook
test is recorded above; usefulness remains ungraded.

### Validation, privacy and remaining limits

**18 prototype regressions, all 57 historical regressions, and all 59 site unit
tests pass.** Node syntax checks pass. Failures observed during development were
fixed before the provider call: Windows CRLF fixture comparison, malformed model
reference types, empty claims bypass, transcript claim labeling, timeout partial
output preservation and implicit CLI startup context. The independent code
review identified the empty-claims bypass and implicit-context risk; regressions
now pin both. Original prompts/experimental source and archived outputs remain
unchanged. Diagnostic/evidence checks are retained; semantic entailment remains
a review responsibility.

Requested calls run with a replacement system prompt, safe mode, disabled
auto-memory, tools/MCP/skills disabled, no session persistence, and an isolated
temporary cwd. Installed CLI help and current official documentation were checked:
[CLI safe mode](https://code.claude.com/docs/en/cli-reference) and
[auto-memory control](https://code.claude.com/docs/en/memory#enable-or-disable-auto-memory).
This preserves authentication while avoiding ordinary project context discovery;
managed policy still applies. No packet-level audit of provider internals is
claimed. Reading a selected session locally never authorizes uploading it. No
transcript upload feature, proactive model caller, second gate, UI or MCP exists.

Source lives under `prototype/`, using Python standard library, installed Node
and Git for local ignore setup. No dependencies were installed. Start a fresh
Claude Code session in the dogfood repository to ensure the local hook setting
loads. Resurfacing is literal-path/accepted-status only, at most two short records;
it is not semantic relevance, tiering or Codex hook parity. Source-path relocation
would require updating the local hook command. Continue with actual human use
and feedback rather than further synthetic prompt optimization.

## Approval record - 2026-11-07

The user approved the recommended defaults for the small no-custom-UI dogfooding
prototype. Local-first Markdown, human-written rationale, advisory-only hooks,
disabled proactive comments, Node hooks and Python transcript reading are approved.
Use an existing editor and small local command, one Markdown record per decision,
minimal explicit status/literal path links, and human canonical edits. Preserve
the existing notebook's Git policy; keep new private artifacts local and ignored.
No canonical decision files are to be published without explicit approval.

The user then selected the project repository. Inspection found no existing
`.aitiarch` notebook. The approved notebook is `.aitiarch/notebook.md`; decision
records go in `.aitiarch/decisions/` there. Preserve unrelated untracked site assets.
Implementation of the approved loop is authorized; do not request the approved
defaults again. No personal decision rationale is inferred from that approval.

Local transcript reading does not authorize sending its contents to a provider.
Requested assistance may use explicitly selected notebook/decision passages;
transcript transmission remains off unless separately and explicitly authorized.
AI can draft alternatives/explanations, never the human's rationale. Evidence,
quotation and citation checks remain. Initial archive/documentation checks made no model calls; subsequent prototype
setup and requested assistance are recorded above. Prompt experiments remain frozen; A stays baseline.

The broader Riddled-style web notebook, inline AI assistance, branching and
learning features remain long-term vision. The prototype validates only the
underlying workflow and does not abandon that vision.

Archive accessibility was rechecked before these documentation updates: all 326
original files, ZIP CRC/member hashes, the embedded manifest and 125 historical
integrity entries verified. The archive is a readable ordinary directory on G:,
outside the active project; persistence against drive loss is not established.
See [ARCHIVE.md](ARCHIVE.md). Its immutable originals remain intact; current
approval annotations intentionally differ from the cleanup-time document hashes.

## Historical checkpoint - prompt experiments frozen, approvals then pending

At the user's instruction, prompt experiments are frozen. No further sampling,
prompt changes, regrading, evidence rewriting or model-gating experiments are
planned. A remains the preserved experimental baseline; proactive comments remain
disabled. Historical v3 run, independent AI review, analysis and validation replay
are retained. Current hash verification confirms all 108 run files, 12 analysis
files and 10 replay integrity entries unchanged. No model calls were made.

The user approved moving toward a minimal no-custom-UI dogfooding prototype,
conditional on remaining architectural decisions. This is not implementation
approval. The dogfood repository is unselected and transcript transmission is
unauthorized. The MVP proposal now has a concise decision checkpoint with proposed
defaults and reversal costs; these are AI recommendations, not human decisions
or invented human rationale.

The intended loop is Write -> Ask AI -> Compare alternatives -> Record human
decision -> Edit code -> Resurface the recorded decision. Ordinary local Markdown,
human-only Why, advisory-only hooks, and existing evidence/quotation/citation
checks remain constraints. No UI, graph, branching system, advanced MCP, hook
installation or prototype scaffolding was implemented in this turn.

[Decision checkpoint and existing MVP proposal](docs/superpowers/plans/2026-11-06-minimal-aitiarch-mvp.md).

## Final v3 validation complete - MVP proposal awaits review

The user approved Option 2 and the targeted offline validation improvement is
complete. No model calls were made. The revised validator separates blocking
evidence/structure errors from diagnostic compliance failures. A missing or
empty silence_reason remains recorded, is never fabricated, and does not alone
block a grounded warning. Actual evidence, exact quotes, source IDs, citations,
required structure and settled-decision checks remain enforced. All grounding
errors are collected even after a diagnostic failure. Semantic entailment and
usefulness are not proven by these mechanical checks.

All 40 frozen outputs were replayed without editing originals:

| Measure | A original -> revised | B original -> revised |
|---|---|---|
| Eligible SHOWs | 8/10 -> 8/10 | 0/10 -> 8/10 |
| Outputs passing display validation | 18/20 -> 18/20 | 10/20 -> 18/20 |
| Diagnostic compliance failures retained | 0 | 10 |
| Non-SHOWs remaining invisible | 10/10 | 10/10 |

Every remaining rejection is preserved: A R09 lacks bracketed E1/N1; A R31
lacks bracketed E1; B R16 has two non-verbatim quotes and therefore no audited
exact support for those inline citations; B R17 lacks inline [N1]. R16/R17 also
retain their empty-diagnostic compliance errors. The other eight B SHOWs become
eligible without altering their text. No source token or quote was repaired.

**Prompt A remains our current experimental baseline. B is not adopted.** The
independent AI review remains attributed to that AI reviewer, not a human study.
Its four unnecessary-follow-up judgments are unchanged. The replay does not
establish a quality advantage for B or real-world proactive readiness. No second
LLM gate or automatic proactive caller was added; proactive comments remain
experimental and disabled by default in the proposed MVP.

The new `spike/display_validation.py` is separate from the frozen historical
validator and both prompts. The replay stores per-response old/new results,
separate blocking/compliance errors, code snapshots, and preservation hashes in
ignored `spike/results/intervention-v3-validation-replay/`. All 108 original run
files and 12 final-analysis files remain byte-identical, including reviewer bytes
and the original blank human-review form. **57 tests pass**, including eleven
new diagnostic/evidence/structure regressions. No original results were overwritten.

[Final replay report](spike/INTERVENTION-V3-VALIDATION.md).
[Minimal MVP implementation proposal](docs/superpowers/plans/2026-11-06-minimal-aitiarch-mvp.md).
The proposal uses an existing Markdown editor, explicitly requested AI assistance,
human-written decisions/Why, quoted Claude Code decision resurfacing, and the
existing read-only transcript bridge with explicit session selection. Suggested
record notation, location, runtime, invocation surface, transcript-sharing boundary,
dogfood repo and provisional Windows hook budget remain for the user's review.
No MVP, UI, MCP, full schema, hook installation or dependency installation was
implemented. Human-owned decision principles are unchanged.

The following final-analysis section records the state before this approved
validator change; its recommendation to perform Option 2 is now completed.

## Intervention v3 final analysis - independent AI review complete

**B did not demonstrate a win. Recommend Option 2: one targeted offline
response/display-contract improvement, followed by regression on frozen outputs.
This recommendation is not an architectural decision or approval to build.**

The imported review is from an independent AI assistant, not a human participant.
All 40 review IDs match the original randomization key and records exactly, with
no missing, duplicated or unknown responses. The CSV confirms all reported
findings: 20 useful raw SHOWs, 20 appropriate immediate silences, four unnecessary
follow-ups (R11/R12/R14/R23), two visible source-label mismatches (R09/R31), and
no clearly fabricated affirmative claims identified in visible comments. Review
judgments remain attributed to that reviewer, not substituted with new grades.

| Verified measure | A: original prompt | B: revised prompt |
|---|---:|---:|
| Concrete underlying issue identified | 10/10 | 10/10 |
| Useful / generic / wrong raw SHOWs | 10 / 0 / 0 | 10 / 0 / 0 |
| Appropriate immediate silence | 10/10 | 10/10 |
| Quiet false SHOWs | 0/10 | 0/10 |
| Duplicate suggestions emitted | 0/4 | 0/4 |
| Unnecessary follow-ups | 0/10 SHOWs | 4/10 SHOWs |
| Unsupported affirmative claims identified in visible comments | 0/10 SHOWs | 0/10 SHOWs |
| Raw SHOW / SUPPRESS / DEFER | 10 / 10 / 0 | 10 / 9 / 1 |
| Exact label matches (A cannot express DEFER) | 18/20 | 19/20 |
| Outputs passing historical display validation | 18/20 | 10/20 |
| Useful SHOWs eligible for display | 8/10 | 0/10 |
| Citation/quote-error outputs, full audit | 2/10 SHOWs | 2/10 SHOWs |
| Exact supporting quotes | 20/20 refs | 19/21 refs |
| Raw contradictions identified / displayable | 6/6 / 4/6 | 6/6 / 0/6 |
| Median wall latency | 5.231 s | 6.397 s |
| p95 wall latency (nearest-rank) | 7.132 s | 9.076 s |
| Input / cache creation / cache read / output tokens | 40 / 11528 / 11528 / 3128 | 40 / 6236 / 28340 / 5717 |
| Returned cost total, USD | $0.1366994 | $0.1487860 |

The 12 historical validation failures are unchanged. All ten B SHOWs have a
present but empty silence_reason; they are not malformed JSON or missing keys.
The prompt requires a nonempty reason, so these are diagnostic value-constraint
failures. Why the model left them empty, and whether it internally considered
silence, is unknown. The validator returns early here, hiding later problems.

A full audit finds eight diagnostic-only B failures (R01/R04/R07/R11/R12/R14/
R23/R29). B R16 additionally has two non-verbatim quotes (changed capitalization
and a missing JSON brace); B R17 additionally lacks inline [N1]. A R09 lacks
bracketed E1/N1 and A R31 lacks bracketed E1; both have exact quote support.
The visible mismatches arise because the packet renumbers bracketed citations
but leaves bare source tokens unchanged. These are raw formatting failures,
not fabricated source IDs. No historical output or validation rule was repaired.

Counterfactual only: dropping diagnostic completeness from display eligibility
while retaining all other current checks yields B 8/10, not 10/10; R16/R17 still
fail. A stays 8/10. Never fill in the model's missing reason, silently alter a
quote, or count a validation-blocked SHOW as a model abstention. Diagnostics
should remain recorded as unavailable/noncompliant even if separated from
display eligibility. All grounding errors should be collected without early exit.

The independent reviewer rates all raw warnings useful despite B's four poor
follow-ups. This does not establish human usefulness. B improves neither raw
recall nor appropriate silence and adds redundant questions, diagnostic failures,
output tokens, latency and returned cost in this sample. Both meet the raw
selection targets under AI review, but both miss contradictions after validation;
B loses all six contradiction warnings. There is no statistical significance claim.

B returns DEFER once and SUPPRESS once on the future-sync fixture, versus A's
two SUPPRESS outputs. The DEFER trigger matches the recorded milestone. All four
are correct immediate silence, so the single DEFER category does not establish
enough benefit to justify new scheduling or infrastructure. A second LLM gate is
not warranted by this evidence: selection already succeeds on these fixtures,
whereas the observed failures concern response contract and evidence formatting.

Proposed next step, not implemented: one narrow experiment-contract change that
separates internal diagnostic completeness from safe display; offline regression
on existing data must preserve eight diagnostic-only B warnings, continue blocking
R16/R17, keep non-SHOWs invisible, and leave history unchanged. Unambiguous source
token formatting may be considered separately with a transform log and strict
grounding checks; no broad quote normalization or invented rationale. No new
model calls, UI, MCP, full schema, product changes or second gate were made.

Ten synthetic problems with curated evidence do not test real retrieval,
uncertain near-misses, novel discovery, real interruption costs, or semantic
deduplication. One independent AI reviewer is not a human study. Cache mix differs
between arms; costs/latencies include CLI activity. Both Sonnet 5 and Haiku usage
keys appear in every invocation; Haiku's role remains unknown. The sample cannot
approve proactive margin intelligence for a real-world MVP. On-demand intelligence
and human-owned reasoning remain separate from unsolicited intervention.

[Full comparison and validation breakdown](spike/INTERVENTION-V3-COMPARISON.md).
The unchanged review archive, extracted original bytes, joined judgments, complete
audits and verification hashes are local under ignored
`spike/results/intervention-v3-final-analysis/`. Original v3 artifacts, all 104
historical integrity entries, and all 24 prior v2 files verify unchanged. The
original blank human-review CSV is intentionally retained. See the new offline
analysis and regression tests in `spike/analyze_intervention_v3.py` and
`spike/test_analyze_intervention_v3.py`.
Validation after unblinding: **46 unit/regression tests pass**, including strict
review-ID joins, nearest-rank p95, masked grounding failures, and counterfactual
auditing without inventing missing diagnostics. Python compilation and ignore
coverage checks pass. The targeted product/validator improvement is proposed only;
existing production/experimental prompt and display-validation behavior is unchanged.

## Historical v3 pre-unblinding record

The following section records the state before the independent AI review and
unblinding. Its pending-review statements are historical; the final analysis above
supersedes them. Original experiment artifacts themselves remain unchanged.

The user approved all labels with final fixture clarifications on 2026-11-06.
V3-04 concerns two supported local writing paths on one machine, not multi-user
collaboration. V3-05's synthetic acceptance requirement does not accelerate the
actual Codex-parity milestone. V3-08 remains DEFER until the cross-machine
milestone explicitly opens, with no immediate comment or duplicate reminders.
All ten cases are synthetic fixtures, not actual project decisions or incidents.
No human decision rationale was generated by the evaluation tooling.

Exactly **40 scored CLI invocations ran, with zero rerolls and zero
invocation/parse failures**:
10 cases ? 2 conditions ? 2 repetitions. The CLI was Claude Code 2.1.205; each
command requested claude-sonnet-5, medium effort, one turn, no tools, and no
session persistence. Inputs were identical across conditions and repetitions;
case labels/evaluator reasons were excluded. Both prompts and adjusted cases,
approval, randomization, source snapshots, raw outputs, usage and failures are
preserved locally. Cache/dedup checks ran in shadow mode, without skipping calls.

Open in this order:

1. [Randomized blind packet](spike/results/intervention-v3-run/BLIND-REVIEW.md)
2. [Blank human-review CSV](spike/results/intervention-v3-run/HUMAN-REVIEW.csv)
3. [Separate pooled mechanical report](spike/results/intervention-v3-run/MECHANICAL-METRICS.md)

The blind packet was created before mechanical reports and contains 40 candidate
outputs with fixture evidence, no condition labels, and no agent usefulness
grades. Candidate comments are shown before display validation. Blinding remains
partial because wording can suggest condition. Keep private condition keys and
per-condition metrics closed until review is finished.

Pooled mechanical counts, not usefulness grades:

| Measure | Result |
|---|---|
| Raw decisions | 20 SHOW, 19 SUPPRESS, 1 DEFER |
| Exact three-way label matches | 37/40 |
| Quiet/duplicate raw SHOWs | 0/20 |
| Quiet-only raw SHOWs | 0/12 |
| Duplicate-case raw SHOWs | 0/8 |
| Important-case raw SHOW label proxy | 20/20; useful issue identification ungraded |
| Validated outputs | 28/40 |
| SHOW comments passing display validation | 8/20 |
| Display-validation failures | 12; retained without repair or reroll |
| Outputs with independent citation/quote audit errors | 4/40 |
| Median wall latency | 5,414.7 ms (range 2,871.3?9,989.9 ms) |
| Returned cost sum | $0.2854854; not an inferred invoice |

Ten display failures have empty silence_reason fields; two others have missing
inline project references (some errors overlap). The independent quote/citation
audit examines even outputs rejected early by display validation: it detects
quote-not-in-source errors as well as inline-reference errors. Valid IDs and
quotes do not establish entailment, and four citation-error outputs do not mean
only four unsupported claims. Semantic source support remains ungraded.

Usage was returned for all 40 calls: 80 input_tokens, 17,764
cache_creation_input_tokens, 39,868 cache_read_input_tokens, and 8,845
output_tokens. These are distinct returned categories, not an estimate. Every
call's modelUsage includes both claude-sonnet-5 and claude-haiku-4-5-20251001.
The role of the CLI's additional Haiku activity was not established; usage/cost
may include internal work. No experiment-level second LLM gate was added.
Thus 40 is the number of evaluation invocations, not a verified count of all
provider-internal inference requests.

Correct underlying issue identification is separate from label accuracy. A
generic SHOW fails useful intervention even if its category matches. No final
usefulness, unnecessary-question, unsupported-claim, or semantic recall grades
have been assigned. Six raw SHOWs contain a question mark; punctuation is not a
measure of unnecessary questions. DEFER is no immediate interruption, but its
correctness and source-supported defer_until must be audited separately from
SUPPRESS. Baseline A cannot express DEFER, making exact three-way label accuracy
structurally asymmetric. Validation-blocked SHOWs are not successful abstentions.
V3-08 returned one DEFER and three SUPPRESS labels across the four outputs, all
without immediate interruption. The DEFER trigger is the explicit opening of
the cross-machine sync milestone (paraphrased). This preserves the trigger; the
SUPPRESS outputs are not credited as correct DEFER labels. No reminders were sent.

Per-condition mechanical counts, every contradiction/replicate, and DEFER triggers
are saved privately for later audit. Provisional targets remain <=25% false
SHOWs per condition (at most 2/10 quiet outputs), no loss of useful recall vs A,
and no missed high-priority contradiction. No quiet raw SHOW was observed, but
useful recall and contradiction detection cannot be declared passed from labels.
Two repetitions on ten synthetic cases are not statistical proof and do not
establish performance on real planning sessions.

Validation: **42 unit/regression tests pass**. The run verifier confirms 40 unique
case/condition/repetition slots, matching approval/case/prompt/settings hashes,
identical context, all 40 blank human-review rows, and preserved historical
24-file evaluation evidence. Private artifacts remain under ignored results;
ignore coverage is verified separately. No UI, full product decision schema,
MCP or second model gate was built; human-owned decision principles are unchanged.

Recommendation: keep selective proactive margin intelligence in evaluation.
Display compliance is insufficient in this run, and semantic quality remains
unreviewed. Do not approve the feature for the MVP or claim a benefit over baseline
until blind review and source auditing are complete. No further model calls or
post-hoc repairs were made to this completed experiment.

Protocol: [reviewed cases](spike/INTERVENTION-V3-REVIEW.md),
[revised prompt](spike/intervention-v3-prompt.txt),
[execution/scoring plan](spike/INTERVENTION-V3-PLAN.md).

## Six-pair context experiment — blind human review pending

The original ten-case run is unchanged: all 24 original files have been archived
with per-file SHA-256 hashes and a verified archive hash. Do not rerun the old
corpus/grading scripts over those files.
[Preserved ten-case archive](spike/results/preserved/margin-eval-v2-20261106.zip).

The follow-up made twelve real calls: six real planning scenarios, each with
the same notebook input in both arms, with relevant retrieved conversation
excerpts added in one arm. Three scenarios were predeclared intervention cases,
three quiet cases. Source selection and expectations were frozen before calls;
expectations were not sent to the model. The same unchanged prompt, pinned
`claude-sonnet-5`, medium effort, tool-free one-turn/nonpersistent settings were
used throughout. Calls were counterbalanced three A-first/three B-first; no
failed calls or rerolls occurred. CLI usage also reported Haiku for auxiliary work.

**Open the [blind review packet](spike/results/paired-context-v1/BLIND-REVIEW.md)
first.** It has shuffled case order, randomized left/right outputs, neutral
display citations, and blank independent human judgments. No new usefulness
grades were assigned by the agent. After those judgments, use the
[source-audit packet](spike/results/paired-context-v1/SOURCE-AUDIT-AFTER-REVIEW.md).
Condition mappings, raw outputs, measurements and factual-support assessments
are under the separate ignored `private/` folder; reading them early can unblind
the comparison. Text content can itself disclose source availability, so the
blinding is partial rather than guaranteed.

**Preliminary conclusion: conversation-context advantage is not established.**
Both conditions abstained in one of three quiet cases and passed citation format
in five of six outputs. Quote/ID existence checks alone missed semantic support
issues; those have a separate factual audit. Unnecessary-question judgments and
usefulness preferences await the blind human review. Some conversation excerpts
repeat notebook facts; known notebook evidence was retained equally in both
arms instead of removing it to manufacture an advantage. This limits claims
about conversations containing genuinely new decisions. Six pairs, one sample
per arm, do not support a general effectiveness or statistical-significance claim.

Full transcript snapshots and source identities stayed local and ignored.
Only carefully selected relevant excerpts were supplied to the authorized model
calls; no full logs, unrelated repositories, credentials or account identifiers
were sent. A local privacy check covers all evidence files. No UI, product
architecture, full decision schema or MCP work was started.

The paired experiment's **24-test** suite, Python compilation, preservation/
pairing/blinding consistency checks, and artifact ignore checks pass. Original
findings below remain historical, not rewritten as new human decisions.

## De-risking continuation — review required before implementation

**Margin MVP readiness: no.** Provisional agent grades are **5 useful, 5 generic,
0 wrong** across ten genuine planning passages. Useful includes one correct
abstention. These are subjective assessments awaiting human review, not accepted
product decisions or independently validated scores.

The revised prompt separates notebook/transcript-supported premises, general
technical knowledge, and conditional hypotheses. It requires supplied source
IDs plus exact supporting quotations for project facts, limits notes to one
question/observation and 55 words, and permits `Nothing useful to add.`
Each real CLI call used `-p --no-session-persistence --max-turns 1` with tools,
MCP, skills and settings sources disabled. No private transcript contents were
sent: this corpus uses BRIEF/NOTES planning passages only. The prompt supports
transcript references, but private linked-transcript margin quality was not
model-tested under the local-data constraint.

[Frozen source passages, hashes and pre-generation expectations](spike/results/margin-eval-v2/corpus.json)
· [Per-case inputs/outputs, latency and model usage](spike/results/margin-eval-v2/)
· [Full provisional grades and justifications](spike/results/margin-eval-v2/evaluation.md)
· [Structured evaluation](spike/results/margin-eval-v2/evaluation.json)
· [Revised prompt and runner](spike/margin_eval.py)

| Real passage / difficulty | Provisional grade | Justification |
|---|---|---|
| Guessed latency target versus measurement | Useful | Correctly scopes the mismatch to the measured shell implementation. |
| Inline `open` versus soft-only behavior | Useful | Asks about a consequential unresolved execution behavior. |
| Human-only why / confidence tagging | Generic | Low-impact tagging detail creates an unnecessary interruption. |
| No database / no build step | Useful abstention | Leaves an explicit constraint settled. |
| Auto-expiring stale T2 items | Useful | Distinguishes deferral from silently defaulting a human-owned decision. |
| Fork anchor / tab strip | Generic | Asks about UI ordering rather than a consequential reliability issue. |
| Commit-before-reveal / peek | Generic | Introduces an unsupported hypothetical exception to stated behavior. |
| Human takeaway versus AI summary | Useful | Asks how a concrete conditional disagreement is handled. |
| Reversible tiers versus architectural tiers | Generic | Suggests an unnamed tier despite the supplied complete tier table. |
| Resurfacing relevance | Generic | Asks for a mechanism already outlined elsewhere in the brief; the test context omitted that passage. |

All ten invocations succeeded. Notes were 4–42 words. Sonnet 5 generated them;
CLI usage also reports Haiku 4.5. Median latency **7.20s**, nearest-rank p95
**9.87s**, range **4.67–9.87s** (ten samples, one per case). Only **1/4** cases
expected to need no intervention abstained. Only **6/10** passed the complete
delivery contract: four notes used real IDs without bracket formatting; one
of those also contained two question marks. All cited IDs existed and supporting
quote strings were verbatim. Quote validity alone does not prove entailment.

**Unsupported claims, separately:** no confirmed fabricated project facts,
invented references, or nonverbatim support quotes were found in this sample.
Two question alternatives lacked evidence: peeking might skip disagreement,
and an unnamed fourth tier might exist. They were questions, not asserted
decisions, but their uncertainty was not represented in hypothesis metadata.
The model emitted only notebook-typed claims, so the new prompt's ability to
separate general knowledge from hypotheses remains unproven. The relevance
case also exposed incomplete retrieval/context selection; it must not be
represented as a model hallucination.

**Repeated observations, separately:** zero exact duplicate notes. Four notes
reopened low-value or already specified details (why tagging, peek behavior,
tier mapping, relevance mechanism). Three useful notes shared the ownership
theme but concerned distinct behaviors (`open`, expiry, takeaway disagreement),
so they are not counted as duplicate observations. The latency note mostly
restated existing measurement evidence while connecting it to the stale brief.

### Transcript reliability and live checks

The parser now streams a fixed-byte snapshot instead of loading the whole file.
It retains a bounded tail, records stable turn ordinals/source lines, merges
observed multipart text snapshots, excludes tool content and reasoning, and
reports malformed/non-object/invalid-UTF8/incomplete/oversized input, text
clipping and orphan assistant messages. Default record cap is 32MiB and visible
text cap is 100,000 characters per role per turn; omissions are diagnosed.
Compaction boundaries and AI summaries are excluded from human turns, and
Codex replacement histories are not replayed as new decisions.

[Local stress/identity evidence](spike/results/reliability-v2/report.json)
· [Fresh-message evidence](spike/results/reliability-v2/live-marker-evidence.json)

| Largest real local session, by bytes | Scan with tracemalloc | Peak traced allocation | Records / visible turns |
|---|---:|---:|---:|
| Claude: 563,044,148 bytes | 6.38s | 5.33MiB | 48,004 / 252 |
| Codex: 108,092,132 bytes | 0.45s | 65.58MiB | 4,338 / 50 |

The three largest files for each provider were tested (six files), each retaining
ten turns with zero malformed/incomplete/oversized/clipped records reported.
Compaction records were encountered in five of the six. Peak allocation depends
on individual record size; the largest Codex record exceeded 10MiB. Tracemalloc
is not total process memory, and the instrumented scan is not a hook benchmark.
Largest by byte size is not proven longest by number of human turns.

The inventory identified 179 Claude and 178 top-level Codex sessions. Actual
repositories had up to **71 Claude** / **59 Codex** competing conversations;
explicitly selecting the oldest ID returned its correct file for both. Newest
mtime is retained as an explicit heuristic; callers can select session IDs.
No conflation of separate files was observed in these checks.

Both extension backends were running. Codex's current request appeared in the
same file as the previous snapshot (one to two turns), then the user's live-check
reply became turn three. After the user sent the marker in Claude's VS Code chat,
Claude's same session contained the expected user-supplied freshness marker
at turn three. The literal marker is omitted. This verifies fresh-message
visibility for both, not append delay.

Remaining transcript uncertainty: active-branch reconstruction, exact compacted
model context, all future format variants, and repeated message IDs beyond the
bounded dedup window. Corruption is now observable, but a skipped record can
still remove necessary context. Real tested files were well-formed; malformed
and concurrent-append behavior is covered by synthetic regressions.

### Revised Windows hook experiment budget and blockers

The previous measured 100-process Node/Git Bash baseline remains **72.10ms median
/ 77.46ms p95**, with a live lookup body around **0.95ms**. The original guessed
50ms wall-time goal failed for this launch mode. Record **p95 <=100ms wall time**
and **<=5ms lookup body** as a *provisional experiment budget for human review*,
allowing limited margin over the current baseline. This is not an adopted
runtime, a production SLA, a new permission gate, or a measured dispatcher time.
No new hook benchmark was needed because hook code and launch behavior did not
change; the raw prior samples remain below.

Blockers before margin MVP: review the subjective grades and budget; reduce
over-intervention; make citation delivery reliable; improve context selection;
test knowledge/hypothesis calibration and repeatability; determine how to
evaluate linked-transcript intelligence while keeping private data local.
Hook blockers remain corpus-scale and dispatcher measurements. Human-owned
decision principles and human-only rationale remain unchanged.

Validation now includes **20 passing tests** (six original plus fourteen targeted
regressions) and the Node syntax check. New tests initially failed on missing
streaming APIs and malformed-shape crashes; those failures are resolved.
The margin evaluation's four contract failures are preserved as failed quality
checks, not hidden by the green parser suite. No Git repository exists in this
workspace; ignore rules are checked in an isolated temporary repository, and
no transcripts or other files have been committed.
The initial ignore-check harness falsely reported unignored files because
Windows text-mode stdin added carriage returns to Git's path input; binary
NUL-delimited verification corrects that harness issue. The ignore rules
themselves did not require changes.

**Stop here for review.** No UI, full decision schema, or MCP implementation
may begin until these evaluation findings have been reviewed.

## Initial three probes (historical snapshot)

Ran the three requested no-UI probes from the Aitiarch workspace while both VS Code
extension backends were running. Scripts and rerun instructions: [spike/README.md](spike/README.md).
These experiments do not resolve the brief's open product decisions.

## Transcript access: verified for this installation

The reader printed every available turn, up to ten, and saved
[the full printout](spike/results/transcripts.md) and
[parsed snapshot](spike/results/transcripts.json).
A turn means a user message plus subsequent assistant text; tool results and
reasoning are excluded. This cwd has two Claude turns and one Codex turn.

- Claude: the VS Code log and installed CLI referred to the same local
  transcript file; the filesystem path and session ID are omitted.
  The installed CLI resumed it with no persistence and correctly returned
  the preceding request to save the project brief (paraphrased).
  The original transcript still contained two visible user messages afterward.
  [Extension evidence](spike/results/claude-extension-storage-evidence.txt),
  [CLI evidence](spike/results/claude-cli-storage.json).
- Codex: the local transcript path and thread ID are omitted.
  Metadata says `source: vscode`, `originator: codex_vscode`.
  The installed CLI app-server's read-only `thread/read` returned this identical
  path and the same thread ID, without resuming or starting a turn.
  [CLI evidence](spike/results/codex-cli-storage.json).

Versions differ: Claude CLI 2.1.205 versus extension 2.1.318; Codex CLI 0.160.0
versus extension session version 0.164.0-alpha.11.1. Shared storage worked across
these installed versions; this does not establish permanent format compatibility.

## Headless margin: technically works; quality is mixed

Passed BRIEF.md's resurfacing paragraph and both real session excerpts through
`claude -p --no-session-persistence --max-turns 1`, with a replacement system
prompt limited to explanation and one question. Tools, MCP and slash commands
were disabled. The successful call took 6.9 seconds and produced a 79-word note.

The generated answer is retained only in the private original. In paraphrase,
it connected the <50ms latency aspiration with noise concerns and asked whether
hook time was dominated by matching or process startup. It overstated the
target's authority and suggested an unsupported matching/noise tradeoff.

Judgment: the final question is specific and useful for this spike. Most of the
explanation repeats known uncertainty. Treating the guessed target as a binding
requirement is inaccurate, and its simple-matching/false-positive tradeoff is unsupported:
explicit path matches can be both fast and precise. The note also does not
identify the real session's concrete friction: Claude had stalled on repo and
rules-format choices before doing the requested feasibility work. This is
promising as a question generator, but one sample does not justify shipping
an always-on margin feature. No rewrite or human decision was produced.
[Frozen input/system prompt and raw response](spike/results/margin-result.json),
[note](spike/results/margin-note.md).

## Hook: context delivered; shell startup exceeds 50ms

The handwritten [fixture](spike/decision.md) only matches `spike/scratch/**`.
The hook reads `tool_input.file_path`, reads that file, and returns only
`hookSpecificOutput.hookEventName` and `additionalContext` on a match.
Unrelated paths return `{}`. There is no allow/deny override.

A real Claude invocation ran Write and Edit on one scratch file. Both hooks
returned the fixture, Claude described the received context, and the final file
contained `hook probe edited`. Decision lookup/body time was 0.958ms for Write
and 0.930ms for Edit, excluding runtime/shell startup. The first invocation's
path permission rule failed to authorize its write; the second invocation used
session-scoped `acceptEdits` and succeeded. No persistent hook settings were installed.
[Live run](spike/results/live-hook-summary.json),
[hook body traces](spike/results/live-hook-trace.jsonl),
[debug validation](spike/results/live-hook-debug.log).

Wall time below includes fresh runtime processes, stdin/stdout, and the same
hook file. Each row has 100 invocations; filesystem caches were warm. Git Bash
`-c` uses the command configured for the live hook.

| Runtime / launch / case | Median ms | p95 ms | Under 50ms |
|---|---:|---:|---:|
| Node direct, match | 37.64 | 40.01 | 100/100 |
| Node direct, miss | 36.56 | 38.80 | 100/100 |
| Node through Git Bash, match | 72.10 | 77.46 | 0/100 |
| Node through Git Bash, miss | 71.87 | 77.73 | 0/100 |
| Bun direct, match | 194.41 | 212.83 | 0/100 |
| Bun direct, miss | 194.32 | 213.71 | 0/100 |
| Bun through Git Bash, match | 229.78 | 249.43 | 0/100 |
| Bun through Git Bash, miss | 231.46 | 249.13 | 0/100 |

Node version: v24.19.0. [Raw samples](spike/results/hook-benchmark.json).
The difference between hit/miss is small; startup dominates this one-file lookup.
The 50ms target fails for this shell-launched implementation on this machine.
These are subprocess measurements, not Claude's internal dispatcher overhead,
a production decision corpus, or a benchmark on other operating systems.
The 12.9-second live model invocation is not the hook latency.
No conclusion about a compiled hook was tested.

Validation: six tests pass, covering session parsing, cwd selection, incomplete
tails, both edit tools, unrelated/outside paths, malformed-input fail-open,
and absence of a permission override. Node syntax check passes.
