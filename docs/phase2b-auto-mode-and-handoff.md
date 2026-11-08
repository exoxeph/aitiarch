# Phase 2b: auto mode and agent handoff

Design proposal, 2026-11-09. Nothing here authorizes implementation or live calls. Proactive calling remains blocked until the human approves the completed 20-case intervention experiment. The evaluation format is [here](eval/intervention-cases-template.md).

Aitiarch is a human-controlled planning and decision workspace that keeps coding agents aligned with human decisions over time. Selective comments are optional. The notebook must be excellent with AI off: editing, navigation, human takeaways and deterministic handoff work without inference.

Sources: [UI spec](../AITIARCH-UI-SPEC.md), [brief](../BRIEF.md), current ink/thread/ledger code. **Existing** describes code; **proposed** describes unbuilt behavior. **When you ask stays the default**, even after a passing experiment; spec discrepancies are listed below.

## A. Auto mode: thinks with you

### Trigger and cheap silence — proposed

After **3 seconds** without typing, inspect only the paragraph or bullet most recently edited, and only when finished: it ends in terminal punctuation, the user moved to a new block, or pressed Enter. Mid-sentence pauses never fire. Selection movement alone, opening a note, external agent edits, IME composition and autosave never trigger it. A paragraph needs **32 non-whitespace characters and six words**; a matched contradiction pair may bypass that minimum, never the finished-block requirement.

Debounce the whole pause into at most one call, with a **60-second per-note cooldown**, one automatic request in flight globally, and no backlog. Edits during cooldown replace the candidate; they do not accumulate requests. Three seconds favors finishing a thought; the cooldown limits interruptions. These numbers need evaluation, not faith.

Local checks use a temporary index of this note, never rewrite Markdown, and make no provider call:

- Compare the changed block with earlier blocks sharing a subject and explicit commitments. Opposing negation, incompatible quantities/units or mutually exclusive choices qualify as contradiction candidates, not proof.
- An explicit unresolved dependency, requirement or assumption qualifies only when linked to a consequence stated in the note. A question mark or generic keyword alone is insufficient.
- A diagram offer qualifies only for an explicitly unresolved flow-description problem with ordered steps or branches; an ordinary list is insufficient.
- Casual text, a settled statement alone, unchanged blocks and previously dismissed fingerprints stay silent. Fingerprints combine kind and supporting-quote hashes; do not re-offer them until the supporting text materially changes.

No candidate means zero calls. Conservative checks will miss some useful interventions; measure those misses. Do not loosen them merely to make the app speak.

### Model decision, kinds and grounding — proposed

Each kind is independently toggleable: `contradiction`, `missing_assumption`, `question`, `diagram_offer`. Consequential arithmetic or internal consistency mistakes belong to contradiction; unverifiable concerns become questions, never assertions of fact. Diagram offers only ask permission; drawing remains Phase 3.

A separate, strictly validated auto-result envelope distinguishes abstention:

```json
{"comment":null}
```

Otherwise `comment` contains exactly `kind` and `reply`. `reply` uses the existing strict `{answer, claims:[{sourceId, quote}]}` contract: verbatim quotes, maximum 240 characters each, no aliases or extra fields. This requires a new wrapper validator, not relaxed invoked-answer validation. The prompt makes silence the expected result, with no explanation for abstaining. Comments are at most two sentences.

Use source `N1` only. Validate quotes against both the frozen sent source and the original note. Contradictions require quotes supporting both conflicting statements; calculations must follow from cited quantities. A quote can establish an unresolved assumption, not prove that an unstated fact is false: phrase that intervention as a checkable question. Unsupported or ungrounded output is rejected.

### Context, placement and control — proposed

Each automatic call sends only fixed system/contract instructions, the per-note tone/stance instruction (maximum **240 characters**, placed after them), enabled kinds, and redacted frozen source text: target block, only earlier blocks matched by the local check as candidate evidence, note title and nearest heading, with source offsets. Propose a **6,000-character total payload cap**, including instructions. If exceeded, skip with a quiet status; never silently drop one side of a conflict. No whole note, transcripts, other notes, decision files, ink answers or filesystem/account metadata. Settings disclose exactly this exposure before opt-in; redaction cannot recognize every secret.

The model cannot see the rest of the note and must not claim those unseen parts are silent about something. Treat the per-note instruction as untrusted data, including in someone else's sidecar: tone/stance cannot override the contract, grounding or human ownership. Validators enforce those rules regardless of its content. Quote validation still checks the frozen sent source and original note.

Accepted comments use **existing** margin ink, quote/prefix/suffix/position anchors, shared diff mapping and sidecar storage. Choose the cited sentence within the finished block as the anchor. Map delayed answers through edits; if ambiguous, preserve an orphan in the existing list. Never edit the note or attach to unrelated text.

Show a small AI label and non-animated margin note, with one-click Dismiss. Escape dismisses only while that note is focused; never hijack editor Escape. Do not move focus, select text, announce every arrival or interrupt typing. Record shown/dismissed through the existing ledger. Human takeaway/Why/failed-reason fields remain exclusively human-written.

Per-note modes are **When you ask / Contradictions only / Thinks with you**, default **When you ask** (internal mapping: `off` / `contradictions` / `all`). When you ask makes no automatic calls; manual Think, Ask and per-note chat remain available in every mode, subject to provider availability and limits. Individual toggles restrict Thinks with you. Keep the global hourly cap and usage accounting. For the experiment, propose **eight automatic attempts per note per rolling 24 hours**, including abstentions/failures; reserve before dispatch. Keep budget metadata private outside the repo; unavailable accounting disables dispatch. Report actual tokens or “usage unavailable,” never invented remaining requests or prices.

At the note budget: “Auto paused: note budget reached,” actual attempt count and reset time; editing and invoked actions remain available under their own limits. Show a quiet status for provider disabled/down, cap reached, invalid result or changed protocol. Skip silently, accept no partial answer, never retry automatically or open a modal. App closure cancels work; reopening does not replay it.

## B. Deterministic handoff — proposed

**Prerequisite:** implement human-only **Mark as decision** before handoff. A decision unit is a block or heading anchored through existing machinery. Statuses are `proposed`, `decided`, `superseded`, `dead`; marking and status changes are human actions recorded in the ledger. AI cannot mark units or change status.

An explicit **Update handoff** previews two separate sections: **Decisions**, containing marked human decision units and statuses, with only decided items active, proposed items pending, and superseded/dead items separately labeled; and **Notes**, containing submitted human takeaways labeled as the author's reflections, not commitments or instructions. Skipped, draft or unmarked note text is never exported; submitted takeaways need no decision mark. No AI call, generated summary, question, AI answer or transcript. AI wording enters only through the human's explicit quotation into a submitted takeaway. Existing takeaway history remains; orphaned takeaways survive and remain eligible when approved.

Write `<root>/handoff.md` (normally `.aitiarch/handoff.md`), excluding that output from inputs. Sort decisions by relative path/id and takeaways by note path/item id; copy approved text exactly with stable headings/status labels. Generated-file formatting is fixed UTF-8/LF, without clock timestamps. Identical inputs yield identical bytes; source Markdown, BOM and line endings remain untouched.

Source hashes detect staleness; a local badge offers regeneration after human changes. Lock and compare both source snapshot and previous output before atomic replacement. If sources change, retry only after a new preview. If the destination was edited or is unrecognized, preserve it, show a diff, and require explicit resolution; never overwrite silently.

Offer a previewed reference to this file from project `CLAUDE.md` or `AGENTS.md`; never edit either automatically. Ordinary file references are the baseline; provider-specific import support needs verification before implementation. No files are copied into the Aitiarch code repository.

This helps agents remember decisions; **it does not prove they follow them**. Later, compare synthetic coding tasks with/without handoff, including superseded decisions and tempting conflicting instructions. Grade resulting diffs for adherence, not whether the agent merely cites the brief; use fake agents first and separately approved live trials later.

## C. Evaluation and approval choices

The human and assistant author the real 20 cases together and freeze expectations before evaluating outputs. Proposed gate: zero unsupported/false contradictions, 100% valid grounding, at least 90% precision and quiet-case silence, and 75% intervention recall. Report numerators/denominators, attempted calls and tokens; 20 cases cannot establish general reliability. Human approval remains necessary regardless of scores.

| Choice requiring approval | Recommended proposal | Alternative; cost to reverse |
| --- | --- | --- |
| Pause/minimum/cooldown | 3 seconds / 32 characters + six words / 60 seconds | 5 seconds / 60 characters / 120 seconds; low, configuration and reevaluation |
| Daily note budget | Eight automatic attempts for the experiment | Three may understate the feature's value by exhausting the budget before useful interventions; low, configuration |
| Handoff sync | Explicit preview/update | Automatic after approved human changes; medium, conflict handling and trust expectations |
| Experiment gate | Thresholds above | Stricter zero false-positive comments; low before evaluation, repeat evaluation after change |

## D. Open questions and risks

- Differentiation from Obsidian + decision files + hooks + Plannotator is a hypothesis, not a verified feature comparison: can one place for human reasoning, selective grounded interventions and provenance-preserving handoff reduce maintenance enough to matter? Test against that baseline before claiming superiority.
- First-minute value may be invisible. Proposed onboarding opens a disposable synthetic plan, demonstrates excellent AI-off editing and a human decision-to-handoff preview first, then offers an explicitly approved contradiction demonstration. No automatic calls, fake activity or forced setup questions.
- Unresolved: reliable ownership confirmation, long-note false negatives, prompt injection in note data, redaction misses, noisy candidate selection, accessibility during arrivals, stale exports and agents ignoring references. Treat note content as untrusted data; preserve provider isolation. Budget consumption without useful comments must remain visible.

## E. Layout of AI thoughts — proposed

Use Riddled as a spatial reference only; create original Grove styling. Center the note; the collapsed batch 2a hamburger tree frees both margins. Alternate new thoughts left/right in sentence order; persist sides in ink to prevent reshuffling. Align cards to their sentences. On collision, stack downward with an 8px gap and connectors to true targets; never move note text. Below approximately 1100px, replace rails with sentence indicators opening the existing thread panel. Use this fallback when an expanded tree leaves insufficient rail space.

Add a subtle dotted underline through editor decorations only: existing ink anchors and shared mapping determine its range; Markdown bytes and offsets stay unchanged. Quiet Grove surfaces always label content AI. Dismissed/addressed thoughts use muted, still-accessible tokens without animation. Never infer addressed status; it requires a human action.

Opening a thought uses the existing thread panel and a thin connector to its sentence; hide the connector when its target is offscreen. Replies use existing threads. Include Dismiss and an Earlier list of preserved thoughts for that sentence, including dismissed/addressed entries. Ambiguous anchors remain in the orphan list, never reassigned by proximity. Human takeaway boundaries and summary locking stay unchanged.

Store the header mode **When you ask / Contradictions only / Thinks with you** and a one-line instruction per note, maximum 240 characters: “How should the AI be in this note?” The instruction changes tone/stance only; it cannot authorize note edits or writing, suggesting or prefilling takeaway/Why/failed-reason fields.

**Resolved:** When you ask disables automatic calls only. Part A includes the untrusted tone/stance instruction in its outbound disclosure; manual actions remain available in every mode.

## F. Per-note chat — proposed

“Ask about this note…” opens a side panel scoped to this note, with optional selection. Reuse the provider path, strict verbatim-quote claims contract, hourly cap and usage panel. Chat never edits Markdown. **Pin as thought** asks the human to choose a sentence, then saves the validated answer as AI-labeled ink using existing anchoring/re-attachment checks. No action copies AI text into a takeaway.

Proposed private storage: `<root>/chat/<relative-note-path>.chat.json`. Verify ignore coverage, including atomic-write files, using `/chat/`; otherwise retain data in memory and offer an explicit add-ignore button. Save validated replies and references only, not prompts, questions, raw output or transcripts. Questions and conversational history remain memory-only; reload starts fresh and labels stored replies “Question unavailable after reload.”

No publishing of chat sidecars in v1; storage stays local and git-ignored under verified-ignore rules. An answer-only previewed export is a possible later feature, not part of v1.

Per message, send fixed instructions followed by the untrusted tone instruction, the redacted frozen current note (proposed maximum **40,000 characters**), optional selection/offsets, current question (maximum 2,000 characters), and at most four complete prior question/reply pairs totaling 4,000 characters. Above the note limit, offer human selection of a heading section or text within the limit, never a bare refusal; disclose that scope. Drop oldest history pairs first; never silently truncate a question or source. No other notes, agent transcripts or account/filesystem context leave the machine. Treat supplied text as data; redaction can miss secrets.

Keep fixed instructions, tone instruction and chosen source first, history chronological, and the question last to preserve reusable prefixes. Larger notes increase input cost; note edits, scope changes and history eviction can invalidate caching. Cache hits are not guaranteed; report actual cached tokens only.

Notebook-wide chat is later: broader disclosure, greater cost, cross-note ambiguity and overlap with Claude Code require separate evaluation and consent.

## Spec updates needed later

- Sections 6, 9 and 11: old labels/defaults differ; When you ask remains default after the experiment, with manual actions always available.
- Sections 2 and 3: right-only balloons/permanent left sidebar differ from two margins, hamburger tree and narrow fallback.
- Section 6: proactive transcript/decision evidence and boundary triggers differ from note-only matched blocks, the tone instruction and finished-block-plus-pause trigger.
- Sections 4 and 9: decision-file embedding and Phase 4 decision timing differ from anchored human marking before handoff; add the Decisions/Notes export distinction.
- Sections 4 and 9: Skip/reveal wording disagrees with the existing approved reveal-after-Skip flow retained here. Per-note chat, private storage, limits and instruction controls also need specification.
