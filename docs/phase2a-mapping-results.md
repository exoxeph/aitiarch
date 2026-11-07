# Anchor mapping review

Approved on `phase-2`, split into the strict-search fix and mapping/cache
commits. No AI provider work, tag changes, real notebook access or Git-file edits.
The margin experiment is preserved, uncommitted, on
`anchoring-margin-experiment` in the sibling `Aitiarch-margin-experiment`
worktree. It is not part of this implementation.

## Safety correction and review diffs

The original Task 1 safety claim was too broad. The full committed resolver
had eight measured wrong attachments outside its original seeds: three after
duplication and five after deletion. `anchoring-eight-regressions.md` shows
every full before/after note, selector and score. All eight are permanent
fixtures and tests, exercised through both strict search and mapping.

Step 1's frozen review patch is `ui/check/out/step1-regressions.patch`.
The final cumulative review patch is `ui/check/out/step3-mapping.patch`.
Generated reports, patches and screenshots remain ignored review artifacts.

Strict fallback automatically attaches only quotes that were unique at
capture and still occur exactly once. It rejects originally repeated quotes,
newly duplicated quotes, and fuzzy matches. Context/similarity/position remain
candidate suggestions. A higher fuzzy threshold cannot prove that a similar
sentence is an edited original rather than a survivor after deletion.

Mapping uses Phase 1's existing `diffText` or the actual browser transaction.
It maps each range once, updates its selector, and shares the same items with
inline decorations, the margin and the orphan list. External diffs additionally
check alternative whole-line LCS alignments, ignoring trailing newline as an
identity signal. Competing alignments, skipped source lines and disagreement
with the editor diff orphan conservatively. Removing more than 40% of a
selection or inserting more than 50% inside it also orphans. Exact originally
unique quotes still occurring once retain their agreed invariant.

The broader mapping sweep found a separate moved-Redis-to-SQLite substitution
at seed 706199777, edit 592. Its complete before/after and old incorrect range
are preserved in `ui/test/fixtures/mapping-moved-repeated.json`. Its regression
was observed failing before the guard: when no line alignment identifies the
source and all original exact copies still survive, a small diff onto another
sentence cannot establish identity. It now orphans. All final sweeps are zero
wrong attachments; this is measured evidence, not a guarantee for arbitrary
indistinguishable edits.

## Persistence

Ink v2 adds `lastSeenTextHash`, the SHA-256 of UTF-8 normalized editor text.
`noteVersion` remains the raw-byte hash used for compare-and-replace writes.
The remaining item fields and stable pretty JSON format stay intact.

```json
{
  "items": [],
  "lastSeenTextHash": "<64 lowercase hex characters, or null for a missing note>",
  "note": "folder/note.md",
  "noteVersion": "<raw-byte SHA-256, or null>",
  "v": 2
}
```

Full normalized text snapshots live in
`<root>/.cache/anchors/<sha256(relative-note-path)>.json`, with cache schema
`v: 1`, `note`, `textHash`, and `text`. The snapshot's contents, its stored hash
and the ink's hash must agree. Missing/corrupt/mismatching snapshots use strict
search. The cache is written after the atomic ink replacement: an interruption
between writes causes safe fallback. Read failures never delete evidence.

The proposed exact ignore line is `/.cache/` in `<root>/.gitignore`.
The app displays that file and line once per browser session. Only clicking
the explicit "Add /.cache/ to root .gitignore" button writes the ignore file,
preserving its existing bytes and rules. No Git files were changed during this
implementation. Snapshot persistence is disabled until ignore coverage is verified.
Cache links are rejected. The hidden folder is excluded from the note tree.
No real v1 ink sidecars were found; v1/future documents are rejected unchanged,
with no migration reader.

Browser mappings are checkpointed against the acknowledged Markdown version
and ink version. Checkpoints update selectors/status only, preserving bodies,
original selectors and human re-attachment history. Conflicts leave the old
sidecar intact and show a notice. Abrupt termination before a checkpoint can
require conservative recovery; it never grants permission to drop ink.

## Held-out evaluation

Baseline, before any resolver change: search **10/13**. Mapping did not exist
then, so a mapping baseline was unavailable. Cases and labels were not used to
tune rules. The only case-file edit is the authorized `expectedMapping` for
case 12. Its before selection `[437,524)` equals after `[488,575)`; the after
occurrences begin at 231, 488 and 745, verifying the middle Charlie paragraph.

| Case | Mapping | Strict search |
| --- | --- | --- |
| 01 insert above | pass | pass |
| 02 delete unrelated above | pass | pass |
| 03 move section | pass | pass |
| 04 typo inside quote | pass | orphan: changed quote |
| 05 paragraph deleted | pass (orphan) | pass (orphan) |
| 06 copy elsewhere | pass | orphan: newly duplicated |
| 07 selected repeated copy deleted | pass (orphan) | pass (orphan) |
| 08 both repeated phrases remain | pass | orphan: originally repeated |
| 09 substantial rewrite | pass (orphan) | pass (orphan) |
| 10 emoji and heading | pass | pass |
| 11 select middle of three | pass | orphan: originally repeated |
| 12 identical surroundings | pass at 488–575 | pass (orphan) |
| 13 second copy edited | pass | orphan: originally repeated |
| **Total** | **13/13** | **8/13** |

No mapping-path held-out failures. No wrong attachments on either path.
`npm run test:holdout` now gates mapping only and passes 13/13. The separate
`npm run test:holdout:search` command reports 8/13 and always exits zero; its
five documented misses remain visible without blocking the mapping gate.

Case 08's captured quote occurs twice. On `phase-2`, the exact rejection is
`anchor.quoteCount > 1`, before scoring. The isolated experiment also rejects
because `anchor.prefix.includes(anchor.quote)` is true. The captured prefix
contains the earlier Cache copy. Scores below explain the abstention, not a
merged margin rule:

| Candidate | Full context sides | Prefix match | Suffix match | Nonspace score | Position distance |
| --- | ---: | ---: | ---: | ---: | ---: |
| 76–95 | 0 | 3 | 5 | 3 | 22 |
| desired 107–126 | 1 | 43 | 27 | 52 | 53 |

## Seeded results

Each primary row uses 1,000 edits, with the same seeds and fixture generation
for both paths. Balanced is 20% each insert/delete/move/duplicate/rewrite;
its inserts may themselves copy existing text. Realistic is 70% new unique
insertions, 15% deletes, 10% small sentence edits, 2.5% moves, 2.5% copies.
Overall orphans include expected deletions. The unchanged column counts only
orphaned anchors whose original paragraph remains byte-for-byte unchanged.

| Corpus | Mix | Path | Wrong | All orphans | Unchanged-paragraph orphans |
| --- | --- | --- | ---: | ---: | ---: |
| repeated | balanced | search | 0 | 851/1000 (85.1%) | 570/719 (79.28%) |
| repeated | balanced | mapping | 0 | 334/1000 (33.4%) | 204/719 (28.37%) |
| mostly unique | balanced | search | 0 | 529/1000 (52.9%) | 250/721 (34.67%) |
| mostly unique | balanced | mapping | 0 | 221/1000 (22.1%) | 78/721 (10.82%) |
| repeated | realistic | search | 0 | 730/1000 (73.0%) | 549/819 (67.03%) |
| repeated | realistic | mapping | 0 | 130/1000 (13.0%) | 16/819 (1.95%) |
| mostly unique | realistic | search | 0 | 226/1000 (22.6%) | 39/813 (4.80%) |
| mostly unique | realistic | mapping | 0 | 124/1000 (12.4%) | 9/813 (1.11%) |

Across these eight primary runs and ten additional balanced seeds in each
corpus on each path: **48,000 evaluated edits, zero wrong attachments**.
The 30-case set reports **zero wrong / three unnecessary orphans** for mapping,
and **zero wrong / fifteen unnecessary orphans** for strict search.
Mapping's three recoverable abstentions are competing alignment in
`context wins over old position`, `suffix disambiguates but source quote
repeated later`, and `editing a selected duplicate's context must not favor
untouched decoy`.

Mostly-unique balanced unchanged orphans break down as 33 insert, 0 delete,
4 move, 41 duplicate, 0 rewrite. Its inserts can insert identical copies;
the four moves have ambiguous source/copy alignment. On the realistic mix,
all nine are duplicate operations inserting an identical adjacent copy:

| Edit index (seed 706190899) | Candidate starts | Oracle original start |
| --- | --- | ---: |
| 54 | 56, 111 | 111 |
| 70 | 155, 204 | 204 |
| 308 | 0, 50 | 50 |
| 470 | 51, 104 | 51 |
| 508 | 106, 157 | 157 |
| 616 | 164, 213 | 164 |
| 670 | 217, 271 | 217 |
| 708 | 212, 264 | 212 |
| 962 | 309, 365 | 309 |

These require intent unavailable from before/after text alone. An explicit
browser transaction can identify the original; external file edits orphan
instead. Every example's complete text is printed in the primary stress
report, including all unchanged orphans, not a sample. The realistic mostly
unique corpus has zero unchanged-paragraph orphans for insert/delete/move/
rewrite. No real redacted notebook was provided; this is the authorized
synthetic stand-in, not a measurement on the user's notebook.

## Reproduce

From `ui/`:

```powershell
node node_modules/vitest/vitest.mjs run --exclude test/anchoring-holdout.test.ts
npm run test:holdout
npm run test:holdout:search
npm run test:anchors:sweep
npm run typecheck
npm run build
node check/ink-mapping.mjs
npm run check:phase1
```

From the repository root: `python -m unittest discover -s prototype/tests`.
The optional redacted-notebook test is the single skipped test because
`AITIARCH_REDACTED_NOTEBOOK_FIXTURE` is unset. It never searches for a real
notebook. All other tests/checks use generated temporary fixture copies.

The real-browser mapping check covers browser copying and small edits,
checkpoint/reload, external insertion, closed-page snapshot recovery,
shared inline/margin/orphan state,
scroll, narrow viewport and unchanged Markdown bytes. Screenshots are ignored
artifacts: `ui/check/out/mapping-wide.png`, `mapping-narrow.png`.

Mapping-checkpoint verification: 218 unit/integration tests passed, one optional redacted
fixture test skipped; typecheck and build passed; mapping browser check passed;
Phase 1 browser check passed 28/28 (maximum external-edit latency 55 ms);
prototype/hook suite passed 26/26. Held-out evaluation is separate and retains
the five strict-search expectation misses shown above as reporting only.

## Approved housekeeping before Task 3

The regular suite adds ten fixed, previously unused seeds:
143137, 804221, 1730159, 3674107, 706201011, 706202027, 987631, 1224523,
2204909, 314159265. Each exercises both corpora and both resolvers with 1,000
balanced edits. Together with the eight primary runs, this is **48,000 edits,
zero wrong attachments**. `npm run test:anchors:sweep` adds 100 seeds beginning
at 706199775 (including the older failure-discovery seeds): **448,000 edits,
zero wrong attachments**. Held-out cases remain evaluation only.

Housekeeping verification: **235 tests passed, one optional redacted-fixture
test skipped**. Mapping command: 13/13, exit 0; reporting-only search command:
8/13, five documented misses, exit 0. Tests inject incorrect expected ranges
to verify mapping exits 1 and reporting-only search exits 0. Typecheck/build
and the real-browser check (including the explicit cache-setup button) pass.
