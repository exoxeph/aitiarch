# Phase 2b: auto mode and agent handoff

Design proposal, 2026-11-09. Nothing here authorizes implementation or live calls. Proactive calling remains blocked until the human approves the completed 20-case intervention experiment. The evaluation format is [here](eval/intervention-cases-template.md).

Aitiarch is a human-controlled planning and decision workspace that keeps coding agents aligned with human decisions over time. Selective comments are optional. The notebook must be excellent with AI off: editing, navigation, human takeaways and deterministic handoff work without inference.

Sources: [UI spec](../AITIARCH-UI-SPEC.md), [brief](../BRIEF.md), current ink/thread/ledger code. **Existing** below describes code; **proposed** describes unbuilt behavior. This brief supersedes the spec's proposed post-experiment default: **Off stays the default**, even after a passing experiment.

## A. Auto mode: thinks with you

### Trigger and cheap silence — proposed

After **3 seconds** without typing, inspect only the paragraph or bullet most recently edited. Selection movement, opening a note, external agent edits, IME composition and autosave never trigger it. A paragraph needs **32 non-whitespace characters and six words**; a matched contradiction pair may bypass that minimum. This avoids fragments without overlooking short conflicting commitments.

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

Each call sends only the redacted frozen current note, the target block with its offsets, enabled kinds, and fixed system/contract instructions. No transcripts, other notes, decision files, ink answers or additional filesystem/account metadata are added. Limit the note to **12,000 characters**; oversized notes skip automatic calls rather than silently broadening scope or dropping contradictory context. Existing redaction precedes sending; redaction cannot recognize every secret. The settings explain this exact exposure before opt-in.

Accepted comments use **existing** margin ink, quote/prefix/suffix/position anchors, shared diff mapping and sidecar storage. Choose the cited sentence within the finished block as the anchor. Map delayed answers through edits; if ambiguous, preserve an orphan in the existing list. Never edit the note or attach to unrelated text.

Show a small AI label and non-animated margin note, with one-click Dismiss. Escape dismisses only while that note is focused; never hijack editor Escape. Do not move focus, select text, announce every arrival or interrupt typing. Record shown/dismissed through the existing ledger. Human takeaway/Why/failed-reason fields remain exclusively human-written.

Per-note modes are **Off / Contradictions only / All kinds**, default Off; individual toggles further restrict All kinds. Global hourly cap and usage accounting also apply. Reserve capacity before dispatch and count automatic attempts, including abstentions/failures, toward a proposed **three attempts per note per rolling 24 hours**. Keep budget metadata private outside the repo; unavailable accounting disables dispatch. Report actual tokens when available, otherwise “usage unavailable,” never invented remaining requests or prices.

At the note budget: “Auto paused: note budget reached,” actual attempt count and reset time; editing and invoked actions remain available under their own limits. Show a quiet status for provider disabled/down, cap reached, invalid result or changed protocol. Skip silently, accept no partial answer, never retry automatically or open a modal. App closure cancels work; reopening does not replay it.

## B. Deterministic handoff — proposed

An explicit **Update handoff** previews and exports approved human decision text, its status, and submitted human takeaways. No AI call, generated summary, draft, skipped takeaway, question, AI answer or transcript is included. AI wording enters only if the human explicitly quotes it into their own submitted takeaway.

**Existing:** submitted takeaways have action history; frontmatter helpers are read-only, not an enforced decision-ownership schema. Therefore require a human-confirmed source allowlist; a label such as `owner: human` alone is insufficient provenance. Exclude unknown ownership and warn locally. Keep proposed/dead/superseded decision statuses explicit, never present them as active commitments. Orphaned takeaways survive and remain eligible when approved.

Write `<root>/handoff.md` (normally `.aitiarch/handoff.md`), excluding that output from inputs. Sort decisions by relative path/id and takeaways by note path/item id; copy approved text exactly with stable headings/status labels. Generated-file formatting is fixed UTF-8/LF, without clock timestamps. Identical inputs yield identical bytes; source Markdown, BOM and line endings remain untouched.

Source hashes detect staleness; a local badge offers regeneration after human changes. Lock and compare both source snapshot and previous output before atomic replacement. If sources change, retry only after a new preview. If the destination was edited or is unrecognized, preserve it, show a diff, and require explicit resolution; never overwrite silently.

Offer a previewed reference to this file from project `CLAUDE.md` or `AGENTS.md`; never edit either automatically. Ordinary file references are the baseline; provider-specific import support needs verification before implementation. No files are copied into the Aitiarch code repository.

This helps agents remember decisions; **it does not prove they follow them**. Later, compare synthetic coding tasks with/without handoff, including superseded decisions and tempting conflicting instructions. Grade resulting diffs for adherence, not whether the agent merely cites the brief; use fake agents first and separately approved live trials later.

## C. Evaluation and approval choices

The human and assistant author the real 20 cases together and freeze expectations before evaluating outputs. Proposed gate: zero unsupported/false contradictions, 100% valid grounding, at least 90% precision and quiet-case silence, and 75% intervention recall. Report numerators/denominators, attempted calls and tokens; 20 cases cannot establish general reliability. Human approval remains necessary regardless of scores.

| Choice requiring approval | Recommended proposal | Alternative; cost to reverse |
| --- | --- | --- |
| Pause/minimum/cooldown | 3 seconds / 32 characters + six words / 60 seconds | 5 seconds / 60 characters / 120 seconds; low, configuration and reevaluation |
| Daily note budget | Three automatic attempts | One; low, configuration |
| Handoff sync | Explicit preview/update | Automatic after approved human changes; medium, conflict handling and trust expectations |
| Experiment gate | Thresholds above | Stricter zero false-positive comments; low before evaluation, repeat evaluation after change |

## D. Open questions and risks

- Differentiation from Obsidian + decision files + hooks + Plannotator is a hypothesis, not a verified feature comparison: can one place for human reasoning, selective grounded interventions and provenance-preserving handoff reduce maintenance enough to matter? Test against that baseline before claiming superiority.
- First-minute value may be invisible. Proposed onboarding opens a disposable synthetic plan, demonstrates excellent AI-off editing and a human decision-to-handoff preview first, then offers an explicitly approved contradiction demonstration. No automatic calls, fake activity or forced setup questions.
- Unresolved: reliable ownership confirmation, long-note false negatives, prompt injection in note data, redaction misses, noisy candidate selection, accessibility during arrivals, stale exports and agents ignoring references. Treat note content as untrusted data; preserve provider isolation. Budget consumption without useful comments must remain visible.
