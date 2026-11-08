# Intervention experiment: 20-case evaluation template

Status: blank evaluation instrument, not a completed experiment or permission for live calls. Read the [design proposal](../phase2b-auto-mode-and-handoff.md). The three worked examples below are synthetic illustrations, **not members of the real 20-case set**.

## Protocol

The human and assistant write the real 20 together. The human approves expected outcomes and rationale before outputs are generated; do not invent or backfill cases to fit results. Use synthetic or explicitly supplied, publication-safe excerpts only. Keep private originals outside the repository; no transcripts, tokens or real notebook copying.

Record mode, enabled kinds, timing/minimum/cooldown settings, note budget, provider availability and context size. Evaluate the local eligibility decision separately from model abstention. A silent case should ideally make no call; measure avoidable calls even when the model abstains. Provider/validation errors are failures, not successful model abstentions. A local skip on a comment-expected case is a false negative.

Use fake providers to verify plumbing first. Any live evaluation needs separate explicit approval. Freeze a development set and a held-out subset before tuning; report both separately and do not tune against held-out results. Preserve original expectations when recording disagreements; human adjudication is explicit.

## Required record for each case

Copy this empty form into each numbered slot below; the table is the index, not a substitute for the excerpt and rationale.

```text
Case ID:
Author / human review status:
Source: synthetic | explicitly user-supplied
Publication/privacy permission:
Frozen note excerpt before the edit:
What was just written (exact paragraph or bullet):
Complete after-edit excerpt / target offsets:
Mode / enabled kinds:
Expected outcome: silent | contradiction | missing_assumption | question | diagram_offer
Ideal comment (at most two sentences; blank for silent):
Why this outcome is warranted (evaluator-owned):
Expected supporting source quotes / source offsets:
Expected local call eligibility / reason:
Case frozen at / development or held-out:

Evaluation only, leave blank until approved:
Local eligibility result / rule name:
Call attempted (yes/no) / abstained (yes/no/not called):
Actual outcome kind / accepted or rejected:
Human judgment: useful | unnecessary | wrong | missed | silent-correct
Grounding valid / unsupported contradiction / wrong attachment:
Validation error enum / provider error enum:
Latency / reported input, cached, output and reasoning tokens:
Usage unavailable (yes/no):
Ownership/Markdown invariants preserved (yes/no):
Notes / adjudication / reviewer:
```

## Real 20 cases — unfilled

| Case | Excerpt | Just written | Expected outcome | Ideal comment <=2 sentences | Why | Evaluation |
| --- | --- | --- | --- | --- | --- | --- |
| 01 | | | | | | |
| 02 | | | | | | |
| 03 | | | | | | |
| 04 | | | | | | |
| 05 | | | | | | |
| 06 | | | | | | |
| 07 | | | | | | |
| 08 | | | | | | |
| 09 | | | | | | |
| 10 | | | | | | |
| 11 | | | | | | |
| 12 | | | | | | |
| 13 | | | | | | |
| 14 | | | | | | |
| 15 | | | | | | |
| 16 | | | | | | |
| 17 | | | | | | |
| 18 | | | | | | |
| 19 | | | | | | |
| 20 | | | | | | |

## Worked synthetic examples — illustrations only

### Example S: silence

- Before: “Pocket Queue is a repair-request demo. The first screen lists waiting repairs.”
- Just written: “The page heading will read Repairs, and the empty list will say that no repairs are waiting.”
- Mode: All kinds, all toggles enabled.
- Expected: **silent**, preferably no call.
- Ideal comment: none.
- Why: routine copy consistent with the existing plan; no demonstrated conflict, unresolved consequential dependency or meaningful intervention.

### Example C: contradiction

- Before: “The demo must work entirely offline; it cannot depend on a network connection.”
- Just written: “Every page load will fetch the repair list from our hosted server before it can display any repairs.”
- Mode: Contradictions only.
- Expected: **contradiction**, locally eligible.
- Ideal comment: “The offline requirement conflicts with requiring the hosted server before showing repairs. Which requirement should change?”
- Supporting quotes: “The demo must work entirely offline”; “Every page load will fetch the repair list from our hosted server before it can display any repairs.”
- Why: two explicit requirements cannot both hold offline. The comment asks the human to decide rather than choosing a design.

### Example M: missing assumption

- Before: “Two volunteers edit the same shared repair list. We have not decided what happens when both change one repair at the same time.”
- Just written: “Each volunteer will save the entire list after an edit, replacing the server copy so the next volunteer sees the latest work.”
- Mode: All kinds, missing assumption enabled.
- Expected: **missing_assumption**, locally eligible.
- Ideal comment: “Does this assume the volunteers never save overlapping edits? The note leaves simultaneous changes unresolved; how should they be handled?”
- Supporting quotes: “We have not decided what happens when both change one repair at the same time”; “Each volunteer will save the entire list after an edit, replacing the server copy”.
- Why: the proposed replacement behavior depends on an unresolved concurrency assumption with a concrete consequence. No external facts or invented constraints are needed.

## Results worksheet — leave blank

| Measure | Numerator | Denominator | Result / unavailable |
| --- | --- | --- | --- |
| Comment precision: appropriate accepted comments / all accepted comments | | | |
| Quiet-case silence: expected-silent cases with no displayed comment / expected-silent cases | | | |
| Intervention recall: appropriate accepted comments / expected-comment cases | | | |
| Valid grounding: fully supported accepted comments / accepted comments | | | |
| Unsupported or false contradictions (count) | | | |
| Wrong attachments / lost ink / human-owned-field violations (counts) | | | |
| No-call silence: expected-silent cases with no call / expected-silent cases | | | |
| Avoidable calls on quiet cases (count) | | | |
| Provider or validation failures (count, separate from abstention) | | | |
| Total calls, latency and actually reported tokens | | | |

Treat zero denominators as **not measurable**, never 100%. Also break down by kind, mode, local gate, development/held-out split and reviewer disagreement. A rejected answer cannot count as useful. An invalid contradictory comment must still be recorded even if validation kept it offscreen.

Gate thresholds in the design are proposals awaiting human approval. Any wrong attachment, dropped ink, ownership violation or unsupported contradiction blocks a pass; arithmetic averages cannot hide it. Twenty cases provide a small diagnostic experiment, not a reliability guarantee. Record the human's explicit pass/fail decision and remaining risks; never enable Auto merely because every row has been filled.
