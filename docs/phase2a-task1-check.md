# Phase 2a Task 1 check

Task 1 implements the ink store, anchoring and re-anchoring only. There is no
AI caller, UI integration, export, thread implementation or proactive work.
The changes remain uncommitted for review.

## Storage and byte preservation

The root is the notebook folder itself, defaulting to the project's
`./.aitiarch`. An explicit root is used literally. The server, development
launcher, Markdown store and ink store use `ui/server/root.ts`; the later
prototype bridge must consume this canonical root rather than append another
`.aitiarch`. The existing Python CLI keeps its legacy project-root contract.

`folder/note.md` has one sidecar at `ink/folder/note.ink.json` under that root.
JSON uses recursively sorted keys, two-space indentation and a final newline.
The store validates versioned documents and attachments, rejects stale writes,
uses exclusive writer locks and replaces complete sidecars atomically. A busy
lock is reported and retained; it is never silently removed. Corrupt or future
schemas are errors, not empty replacement documents. Windows case aliases and
case-only note renames retain access to the same sidecar.

Every item retains its ID, body, immutable original selector, latest selector
and attached/orphaned status. Re-anchoring never filters items out. Missing
notes retain sidecars and become `note-missing` orphans. Restoring the text can
recover the attachment. An orphan-list UI belongs to Task 2.

No ink operation writes Markdown. Tests compare note bytes after operations,
including UTF-8 BOM, CRLF and mixed line endings. All notebook fixtures live in
temporary directories; the real notebook is never opened by these checks.

## Anchor selection and tie rules

Selectors contain quoted text, up to 64 UTF-16 units of prefix and suffix,
the original range, quote occurrence count and identical-context count. All
offsets refer to the editor's LF-normalized text. Selectors exist only in JSON.

1. Collect exact quote occurrences. Also consider edited paragraph ranges and
   ranges between matching prefix/suffix; an exact old quote elsewhere does
   not automatically beat the edited original.
2. An originally unique quote still occurring exactly once attaches to that
   exact occurrence. Repeated original quotes orphan because their identity
   can transfer when a copy moves or disappears. Edited candidates require at
   least 70% normalized Levenshtein similarity and both complete context
   sides. Fuzzy matching is restricted to selections of 12–2,000 units;
   longer selections can still match exactly, up to the 10,000-unit selector
   limit. Candidate length must be 80–125% of the quote length.
3. Rank by complete context sides, then matching non-whitespace context
   characters, then quote similarity, then distance from the position hint.
   Empty contexts count only at the corresponding document boundary.
4. Apply safety checks after considering context and position. Originally
   repeated quotes remain orphaned. A newly duplicated quote needs a unique
   candidate with both complete context sides. A remaining tie in context and
   similarity is orphaned even when one candidate is nearer: position alone
   cannot prove identity.
5. No viable candidate means `missing`; unresolved identity means `ambiguous`.
   Keep the ink and selector in either case. A successful match updates the
   latest selector, retaining the immutable original selector for provenance.

This deliberately trades some recovery for avoiding wrong attachments.
Originally identical quote/context copies will also orphan on re-anchoring
unchanged text; the selector does not retain a whole-document snapshot proving
that no identity-changing edit occurred. Initial ink can still be attached to
the user's explicit selection. Automatic recovery cannot guarantee identity
under every arbitrary edit. The reported zero applies to the test set.

## Evaluation and regression results

The 30-case labeled set includes edits, deletion, moved paragraphs, inserted
copies, surviving decoys, partial and multi-paragraph selections, Unicode,
equal-distance ties and edited duplicate contexts. Its metric keeps known
recoverable cases in the denominator even when the resolver safely abstains.

| Measure | Result |
| --- | ---: |
| Wrong attachments | 0 / 30 cases |
| Unnecessary orphans | 7 / 20 recoverable cases |

The seven unnecessary orphans include originally identical-context duplicates
after insertions or context edits, a repeated quote with distinct suffixes,
and an edited original whose old exact quote survives elsewhere. All ink
items survive as orphans. Ten other cases require orphaning because the text
is absent or identity is ambiguous.

The new fixed-seed stress test applies 1,000 independent single edits to
synthetic fixture notes: 200 each of insertion, deletion, move, duplication
and partial rewrite. Paragraph identity is tracked outside the Markdown, so
an identical copy is still counted as a wrong attachment. Seed `706199774`
produced 0 wrong attachments and 765 orphans (76.5%). Of 719 cases where the
original paragraph remained, 531 were unnecessary orphans (73.9%). The
fixture intentionally uses six recurring sentences, so duplicates are
frequent. These rates describe this stress distribution, not ordinary notes.
Before the rule change the same seed exposed 115 wrong attachments; the first
reproducible failures were cases 7 (move), 11 (delete), and 15 (insert). The
test logs the seed, operation and up to three complete synthetic failures if
any wrong attachment recurs.

Ten held-out cases can be placed in `ui/test/anchoring-holdout/` as JSON files.
The directory is empty until the human adds them. Its independent runner does
not tune or alter anchoring rules.

Tests were introduced and observed failing before implementation. Review
findings were reproduced as failing tests before their fixes. Persistence
checks cover independent/concurrent writers, disk replacement failure,
busy locks, malformed/future data, invalid attachments, path escapes, linked
directories, stale note versions, deletion/restoration and byte preservation.

The existing browser Phase 1 check passed 28/28 scenarios; external-edit
latency was 51–78 ms (p95 77 ms), below the 1,000 ms limit. Existing prototype
and hook tests passed 26/26; spike regression tests passed 57/57. Type checking
passed at the Task 1 checkpoint. The complete UI suite passed 167/167 tests
at that checkpoint. The unique-quote invariant below was clarified after
that checkpoint and now passes.

## Before Task 2: additional evaluation

The fixed-seed repeated-sentence corpus currently reports 0 wrong attachments
and 765/1000 orphans (76.5%); 531/719 unchanged originals orphaned (73.9%).
The mostly unique synthetic corpus reports 0 wrong attachments and 279/1000
orphans (27.9%); 129/721 unchanged originals orphaned (17.9%). The latter
orphans comprise 72 duplicate edits, 49 insertions, 6 moves and 2 partial
rewrites. The first examples, with complete synthetic before/after notes, are
printed by `test/anchoring-stress.test.ts` at seed `706190899`, iterations
13, 20 and 28. These rates are too high to call the current rules suitable
for ordinary notes. They have not been loosened pending human review.

A test confirms that a quote unique when captured and still unique always
attaches despite unrelated changes. The human clarified that the invariant
applies only to quotes unique at capture. A second test keeps an originally
duplicated quote orphaned when deleting the selected copy leaves one identical
survivor. The human approved a synthetic stand-in for the redacted real
notebook copy. No real notebook was opened.

Concurrent editors are not part of the sidecar lock protocol. Note hashes are
checked before replacement; a later edit leaves an older `noteVersion` in the
sidecar. Task 2 must re-anchor against the displayed version before rendering
an attachment. Filesystem confinement checks reject existing links, but are
not a guarantee against another process maliciously replacing directories
between checks and operations.

## Run it yourself

From the repository root, in PowerShell:

```powershell
cd ui
node node_modules/vitest/vitest.mjs run test/anchors.test.ts --reporter=verbose
node node_modules/vitest/vitest.mjs run test/anchoring-stress.test.ts --reporter=verbose
npm run test:holdout
npm test
npm run typecheck
npm run check:phase1
cd ..
python -B -m unittest discover -s prototype/tests -v
python -B -m unittest discover -s spike -p 'test_*.py' -v
```

The first command prints the two anchoring metrics. The browser check uses
installed Edge or Chrome and synthetic temporary notebooks. None of these
commands calls an AI provider or opens the real notebook. The five-question
Phase 2a acceptance check remains the final task after Tasks 2–5.

## Deferred agreements

Before implementing the ignore-gap UI, use the proposed one-time notice
showing the exact ignore lines; do not edit project Git files automatically.
Before Task 4, present the exact thread file shape, including explicit skipped
takeaway state. The human owns takeaway text and the summary remains gated.
