# Aitiarch: the engineering journey

Consolidated 2026-11-07 from the preserved brief, notes, experiment artifacts,
and recorded user instructions. The experimental sequence below is chronological;
most recorded work is dated 2026-11-06. It is not a claim that every step happened
on a separate day. The original documents remain unchanged.

The primary sources are [BRIEF.md](BRIEF.md), [NOTES.md](NOTES.md), the
[v3 comparison](spike/INTERVENTION-V3-COMPARISON.md), the
[validation report](spike/INTERVENTION-V3-VALIDATION.md), and the
[MVP proposal](docs/superpowers/plans/2026-11-06-minimal-aitiarch-mvp.md).
Raw evidence is preserved in the verified external archive described in
[ARCHIVE.md](ARCHIVE.md). Paths written as `spike/results/...` below identify
exact members of that archive, rather than files still in this checkout.

## Starting with understanding, rather than another memory system

Aitiarch began with a concern about AI-assisted coding: a developer can produce
working code faster than they build an understanding of the choices inside it.
The brief asks for a durable way to answer what was decided, what was rejected,
and why. The intended outcome is the developer's ability to understand and
defend an architectural choice. Saving a convincing AI explanation would not,
by itself, establish that outcome.

The original vision was a local web notebook, saved as ordinary Markdown in the
repository and integrated with Claude Code, then Codex. Riddled supplied an
interaction reference: assistance alongside writing, including learning side
quests, rather than replacing the notebook with a chat history. The broader
vision included a narrow AI margin, decision cards, branches and merged
takeaways. These were design ideas, not delivered capabilities.

The enduring constraint was ownership. The AI could explain, research, draft
alternatives and challenge a premise. The human's Why remained human-written;
even an uncertain or blank rationale was preferable to an invented one. The
brief also distinguished psychological ownership from demonstrated comprehension.
This account records the stated motivation, not an inferred personal history.
Where the user did not record a personal rationale for a choice, that rationale
is unrecorded.

## Early hypotheses: scale friction and resurface the record

The brief proposed three tiers: T0 for cheap naming/formatting choices, T1 for
choices within an established pattern, and T2 for costly storage, authentication,
schema or public-interface choices. Cost to reverse was the proposed reason to
increase human involvement. Automatic classification, correction and delegation
were hypotheses; there is no implemented tiering system.

One Markdown file per decision would preserve the accepted choice, human Why,
alternatives and rejected attempts. Commit-before-reveal, with a logged escape
hatch for peeking at the AI recommendation, was intended to discourage passive
agreement. It has not been shown to improve architectural decisions. The draft
schema in the brief is not an approved product schema.

Resurfacing was the proposed payoff: when an agent edits related code, inject
the relevant recorded decision or failed attempt. Capture would then earn its
cost by preventing repeated debates and lost context. Hooks were explicitly
advisory, never permission gates. Files were the portable record, with future
interfaces acting as views. No database, graph, embeddings or multi-user mode
was required for v1. Later work narrowed this further, but did not erase the
original vision or convert proposals into human decisions.

## Research set boundaries on the claims

The brief's research review considered existing notebooks, ADR tooling and agent
memory systems, including Riddled, Plannotator, Nimbalyst and repowise. Its
license and platform observations are a dated research record, not fresh
verification during this consolidation. They require checking before dependency
or implementation choices.

More consequentially, the brief recorded an Anthropic learning experiment
(n=52; reported learning scores 50% with AI delegation versus 67% without),
while explicitly noting that learning a library is not a test of architectural
decision quality. It cited the margin-notes paper identified as
arXiv 2509.09840 for the caution that greater ownership did not imply better
comprehension. Retrieval-practice effects, recorded as roughly g=0.5 in general,
did not establish that a decision quiz would help with complex architectural
reasoning. An ADR-violation study identified as arXiv 2602.07609 was recorded as
reaching about 91% at best, with weaknesses on implicit/infrastructure decisions.

These are the brief's research interpretations, not newly replicated findings.
Their role was to limit promises: keep drift checks advisory, avoid equating
ownership with understanding, and treat the central learning thesis as unproven.
See [the original research discussion](BRIEF.md#83-observations-existing-tools-to-learn-from-or-merge)
and its adjacent critics section. This cleanup did not introduce new research or
new architectural conclusions.

## Three small feasibility probes before a product

The first work asked three concrete questions: could the extensions' current
conversations be read from local files, could a headless Claude call produce a
useful margin note, and could an edit hook cheaply resurface a handwritten
decision? The resulting scripts are feasibility tooling, not an application.

The transcript reader selected sessions for the working directory, printed up
to ten user-led turns, and excluded tools and reasoning. On this installation,
Claude's VS Code log named the same transcript path used by its CLI. A
nonpersistent CLI resume retrieved the previous user message. Codex's read-only
app-server `thread/read` returned the same path and thread identity as the
VS Code session. Thus shared storage was observed, rather than assumed.

Version differences mattered: Claude CLI 2.1.205 and extension 2.1.318 shared
the tested storage; Codex CLI 0.160.0 and extension session version
0.164.0-alpha.11.1 did too. That was compatibility evidence for these versions,
not a guarantee of a stable public transcript format. Original evidence lives
at archived `spike/results/claude-cli-storage.json`,
`codex-cli-storage.json`, `claude-extension-storage-evidence.txt`, and the
`transcripts.json`/`transcripts.md` snapshots.

The first headless margin invocation used
`claude -p --no-session-persistence --max-turns 1`, with tools and MCP disabled.
It supplied the resurfacing paragraph and selected real conversation excerpts.
The call took about 6.9 seconds and returned 79 words. Its question about where
hook latency was spent was useful; much of its explanation repeated uncertainty.
It called the guessed <50ms goal a hard target and introduced an unsupported
tradeoff between simple matching and false positives. It missed concrete
friction visible in the session. Technical feasibility had therefore passed
before intervention quality had. The frozen input, system prompt and response
are archived as `spike/results/margin-*`.

The Node hook read Edit/Write `file_path`, looked up a handwritten fixture, and
returned `additionalContext`. It issued no allow/deny override. A real Write/Edit
probe delivered the context; an initial permission configuration failed, and a
later session-scoped `acceptEdits` run succeeded. Both attempts were preserved.
The fixture is not a selected decision schema, and no persistent hook was installed.

Startup dominated latency. With 100 fresh processes per case and warm caches,
matching Node launches measured 37.64ms median / 40.01ms p95 directly and
72.10ms / 77.46ms through Git Bash. None of the 100 shell-launched matches met
50ms. Bun through Git Bash measured 229.78ms / 249.43ms on this machine. The live
lookup body was 0.958ms for Write and 0.930ms for Edit. Whole model-call time was
not hook time. These measurements motivated a provisional Windows budget of
p95 <=100ms launch and <=5ms lookup body, pending human approval. Dispatcher
overhead, a full decision corpus and other machines remain unmeasured. See
archived `spike/results/hook-benchmark.json` and `live-hook-*`, including failures.

## Transcript access became a reliability problem

The first successful read did not settle session selection or large histories.
The hardened [reader](spike/transcripts.py) streams a fixed-byte snapshot, keeps
a bounded tail and reports omissions. It handles malformed JSONL, non-object
records, invalid UTF-8, incomplete tails, multipart text, tool records,
compaction and observed Codex replacement histories. Defaults cap each record
at 32MiB and visible text at 100,000 characters per role per retained turn.
Source-line references and clipping/error counters make lost context observable.

The inventory found 179 Claude and 178 top-level Codex sessions, with as many as
71 Claude or 59 Codex conversations for a repository. Explicitly choosing an
older session returned the correct file in both adapters. Newest modification
time remains a fallback heuristic, not proof of the intended conversation.

The three largest files by bytes for each provider were scanned. The largest
Claude file was 563,044,148 bytes: 48,004 records, 252 visible turns, 6.38 seconds
under tracemalloc and 5.33MiB peak traced allocation. The largest Codex file was
108,092,132 bytes: 4,338 records, 50 turns, 0.45 seconds and 65.58MiB peak traced
allocation. Large individual Codex records explain why streaming does not mean
constant tiny allocations. These figures are neither total process RSS nor hook
benchmarks; largest by bytes is not necessarily longest by human-turn count.

Both extension backends were running during live checks. Newly appended Codex
requests/replies appeared locally. After the user sent a freshness-test marker in Claude Code's VS Code chat,
the expected message appeared as turn three
in the same local session. Fresh-message visibility was verified; append delay
was not measured. Arbitrary branch reconstruction, exact post-compaction model
context and future format compatibility remain uncertain. Real stress files were
well-formed; corruption and concurrent append behavior rely on synthetic tests.
Evidence is archived under `spike/results/reliability-v2/`.

## Ten real paragraphs exposed the cost of generic help

The next evaluation used ten actual BRIEF/NOTES planning passages with varied
difficulty. The source-aware prompt distinguished notebook/transcript premises,
general knowledge and hypotheses; required real source IDs and exact support
quotes; preferred one concise observation/question; and permitted
`Nothing useful to add.` This notebook-only run did not transmit transcripts.
That privacy statement is scoped to this run: the earlier headless probe had
used selected transcript excerpts.

All ten invocations succeeded. Median latency was 7.20 seconds and nearest-rank
p95 was 9.87 seconds. Provisional agent grades were five useful (including one
correct abstention), five generic and zero wrong, awaiting human review. Only
one of four expected quiet cases abstained. Six of ten outputs passed the full
delivery contract; four lacked bracketed source formatting. Existing IDs and
verbatim quotes did not establish that a premise was actually useful or entailed.

Two speculative alternatives lacked support: a possible peek exception and an
unnamed fourth tier. They were questions rather than invented accepted
decisions, but uncertainty metadata did not represent them properly. There were
no exact duplicate notes, yet four reopened low-value or already specified
details. One relevance question resulted partly from omitted notebook context,
showing that poor retrieval must not automatically be called hallucination.

The original 24 files, including provisional justifications, remain preserved
inside the consolidation archive under `spike/results/margin-eval-v2/`. Its
earlier preservation ZIP and manifest are also retained there under
`spike/results/preserved/`. No later evaluation rewrote those outputs or grades.

## Did real conversation context help?

A small paired follow-up used six real planning scenarios, three intervention
and three quiet. Each received notebook-only context and notebook plus carefully
selected actual local conversation excerpts. These twelve calls kept the prompt
and settings identical, counterbalanced order three pairs each way, and used no
rerolls. The user authorized selected excerpt transmission for this experiment;
full snapshots and source identities remained local and ignored.

Both arms abstained on one of three quiet cases and passed citation formatting
on five of six outputs. Median latency was 5.95 seconds notebook-only and
6.32 seconds with conversation context. A shuffled paired review packet kept
usefulness judgments blank. No independent human preference result is recorded.
Some conversation evidence duplicated notebook facts. The result therefore did
not establish a meaningful context advantage, nor rule one out when conversation
evidence contains genuinely new information. Raw artifacts and the still-pending
review are archived under `spike/results/paired-context-v1/`.

Here A/B meant absence/presence of conversation context. In v3 below, A/B instead
means different prompts. They are separate experiments and cannot be pooled.

## Intelligence and intervention became separate questions

The user explicitly separated helping when asked from deciding to interrupt.
Requested intelligence should explain, research and draft freely within the
privacy and ownership boundaries. An unsolicited margin comment must justify
its attention cost. A useful factual warning need not end in a question, and
silence is often the correct output.

The revised policy considered contradictions, undermined human-owned decisions,
critical unresolved requirements, settled issues, previously shown/dismissed
suggestions, and the difference between useful new evidence and speculation.
It offered SHOW, DEFER and SUPPRESS, with a brief reason to remain silent before
SHOW. New evidence could justify reopening a decision; merely imagining another
alternative could not. No model should generate the human's decision rationale.
This policy applied only to unsolicited assistance.

The proposed lightweight deterministic checks used unchanged-context fingerprints,
recorded suggestion identity/dismissal, explicit decision status, and structural,
citation and exact-quotation validation. These were experiment prototypes.
Exact IDs are not semantic paraphrase detection. No second LLM gate was added.

## V3: controlled selection looked good; delivery did not

The user reviewed labels before execution for ten previously unused synthetic
fixtures: three new-evidence contradictions, two important unresolved issues,
three quiet/settled cases and two duplicates. Expected labels were five SHOW,
one DEFER and four SUPPRESS. Final clarifications mattered: V3-04 involved two
supported local writing paths losing human rationale, not multi-user collaboration;
V3-05 used fixture-specific acceptance requirements, not a real decision to
accelerate Codex parity; V3-08 deferred to a recorded future milestone with no
immediate reminder. See the retained [review protocol](spike/INTERVENTION-V3-REVIEW.md).

Baseline A was the existing margin prompt. B was the revised single-stage policy.
Ten fixtures x two conditions x two repetitions produced 40 scored CLI
invocations, with identical comparable context, balanced pair order and no
rerolls or invocation/parse failures. Settings requested `claude-sonnet-5`, medium
effort, one turn, no tools and no persistence. Usage reported both Sonnet 5 and
Haiku 4.5 on every invocation; the auxiliary role is unknown. Forty scored CLI
invocations must not be reported as proof of exactly forty provider-internal calls.

The raw-output packet was randomized before condition results were revealed.
The returned independent review was from an AI assistant, not a human
participant. All forty review IDs matched exactly, without omissions or
duplicates. Original reviewer bytes and the blank human-review form were
preserved. Wording could reveal the condition, so blinding was partial.

| Unblinded measure | A: original | B: revised |
|---|---:|---:|
| Scored invocations | 20 | 20 |
| Important issue identified / useful raw warning | 10/10 / 10/10 | 10/10 / 10/10 |
| Generic / wrong raw warnings, AI review | 0 / 0 | 0 / 0 |
| Appropriate immediate silence | 10/10 | 10/10 |
| Quiet false SHOW / duplicate SHOW | 0/10 / 0/4 | 0/10 / 0/4 |
| Unnecessary follow-ups | 0/10 SHOWs | 4/10 SHOWs |
| Clearly fabricated visible affirmative claims identified | 0 | 0 |
| Raw SHOW / SUPPRESS / DEFER | 10 / 10 / 0 | 10 / 9 / 1 |
| Exact three-way label matches | 18/20 | 19/20 |
| Citation/quotation-error outputs | 2/10 SHOWs | 2/10 SHOWs |
| Exact supporting quotations | 20/20 references | 19/21 references |
| Original passing outputs / eligible SHOWs | 18/20 / 8/10 | 10/20 / 0/10 |
| Median / nearest-rank p95 wall latency | 5.231s / 7.132s | 6.397s / 9.076s |
| Input / cache creation / cache read / output tokens | 40 / 11528 / 11528 / 3128 | 40 / 6236 / 28340 / 5717 |
| Returned total cost, USD | $0.1366994 | $0.1487860 |

The four unnecessary requests were R11/R12/R14/R23, all B. R14 did not have a
question mark, so punctuation counts were inadequate. R09/R31, both A, used
bare source labels that the blind display renumberer did not transform.
No identified visible fabrication is not proof that every claim is supported.
Semantic usefulness and source entailment still require review.

Both arms identified all six high-priority contradiction samples before
validation. A delivered four; B delivered none. Category accuracy was not useful
delivery. A could not express DEFER, so its two label mismatches on that case
were nevertheless appropriate immediate silence. B deferred once with a valid
future-sync trigger and suppressed the other repeat. This established no need
for scheduling infrastructure. The provisional quiet-intervention and raw-recall
targets were met in this sample; the delivery requirement was not.

B demonstrated no useful-intervention or appropriate-silence advantage. It added
unnecessary questions, diagnostic failures and latency. Returned costs differed,
but cache mix and CLI auxiliary usage prevent attributing all cost differences
to the policy. Ten curated synthetic problems, even repeated forty times, do not
provide statistical proof, real human usability evidence or a realistic retrieval
test. Full detail is in the [comparison](spike/INTERVENTION-V3-COMPARISON.md);
raw evidence is archived under `spike/results/intervention-v3-run/` and
`spike/results/intervention-v3-final-analysis/`.

## Fixing validation without rewriting the experiment

Unblinding exposed twelve rejected raw warnings. All ten B SHOWs had a present
but empty `silence_reason`, not malformed JSON or missing keys. Eight failed
only that diagnostic requirement. The original validator returned early, masking
two further grounding problems. The model's reason for leaving the field empty
is unknown; an absent diagnostic cannot reveal whether it considered silence.

The user approved a targeted offline improvement: separate diagnostic compliance
from evidence-grounded display eligibility. The new
[validator](spike/display_validation.py) records missing/empty diagnostic failures
without independently blocking a safe warning. Wrong field types and actual
structure/evidence errors remain blockers. It collects grounding errors even
when diagnostics fail and never supplies an invented reason.

All forty frozen outputs were replayed with no model calls or changes to their
bytes. A stayed at 8/10 eligible SHOWs; B moved from 0/10 to 8/10. Passing outputs,
including silence, stayed 18/20 for A and rose from 10/20 to 18/20 for B. All ten
B diagnostic failures remained recorded. Twenty non-SHOW outputs stayed invisible.

Four rejections remain: A R09 lacks bracketed E1/N1, A R31 lacks bracketed E1,
B R16 has two non-verbatim quotations, and B R17 lacks inline [N1]. R16 changes
capitalization in one quote and omits a JSON closing brace in another. No quote
or citation was repaired. Eleven added regressions brought the recorded suite
to 57 passing tests. All 108 original run files and twelve analysis files were
verified unchanged; the replay is separately archived under
`spike/results/intervention-v3-validation-replay/`.

This improved delivery eligibility, not model quality. The baseline remains A;
B was not adopted. Exact substring/ID checks do not prove semantic entailment.
Proactive margin comments remain experimental and disabled, and no additional
LLM gate was introduced.

## What failed, what was deferred, and what remains open

The <50ms shell-hook aspiration failed on this Windows setup; the replacement
budget is provisional. Early margins demonstrated generic explanations and
unnecessary interruptions; the ten-paragraph run did not establish readiness.
Conversation context had no demonstrated advantage in the small paired study,
whose human review remains pending. Requiring richer intervention diagnostics
did not improve selection in v3 and initially hid useful warnings. Automatically
turning every comment into a question was not justified by the observed outputs.

No experiment demonstrated that commit-before-reveal improves understanding,
that developers will maintain useful records, or that real edit-time resurfacing
will be sufficiently relevant. Real discovery, ambiguous evidence, stale records,
human disagreement, retrieval completeness and interruption cost remain open.
Synthetic deduplication is not robust semantic deduplication. The UI, graph,
branching, full schema, advanced MCP and a second gate were deferred; they were
not implemented and later removed as failures.

What is demonstrated is narrower: observed local session formats can be read
with diagnostics; extension messages are visible locally; explicit session
selection works on tested competing conversations; a handwritten decision can
be injected through an advisory Claude hook; and validation can separate internal
metadata compliance from evidence requirements without mutating frozen outputs.

## The next chapter: learn from a developer's actual work

The user froze prompt experiments and approved moving toward a minimal,
no-custom-UI dogfooding direction, conditional on remaining architectural
decisions. The proposed loop is Write -> Ask AI -> Compare alternatives -> Record
human decision -> Edit code -> Resurface the recorded decision. Existing Markdown,
requested explanations/drafting, human-only Why, advisory resurfacing and the
read-only transcript bridge are the proposed building blocks. Proactive comments
stay disabled by default.

At consolidation, the [proposal's checkpoint](docs/superpowers/plans/2026-11-06-minimal-aitiarch-mvp.md#current-approval-checkpoint)
still required a real dogfood repository/notebook, the minimal record contract,
Git/storage policy, AI context boundary, canonical write authority and reversible
runtime defaults. No dogfood repository is assumed. Previous scoped experiment
permissions do not authorize transcript transmission in the prototype.

Moving from synthetic selection tests to actual use follows the user's stated
goal: determine whether Aitiarch helps them understand and defend architectural
choices. It does not presume a favorable answer. Personal rationale beyond the
recorded instructions is unrecorded. This consolidation builds no prototype and
makes none of those architectural choices. Subsequently, on 2026-11-07, the user
approved the recommended minimal defaults and selected `<project>`,
with `.aitiarch/notebook.md` and `.aitiarch/decisions/`. Node hooks and Python
reading are approved; transcript transmission remains unauthorized. The long-term
notebook/learning vision is preserved. See current NOTES for implementation progress.

The evidence is now external, checksum-indexed and local; original documents,
source and regressions remain. [CLEANUP-AUDIT.md](CLEANUP-AUDIT.md) records the
retention decisions and exact approved evidence relocation list. This narrative
preserves the important measurements and limitations even when that archive is
not mounted.
