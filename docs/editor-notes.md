# Editor notes

Short, honest notes about how the live-preview editor behaves. Update when behaviour changes.

## How rendering works

The note on disk is plain Markdown and stays byte-exact (CRLF, BOM and all). Rendering is display only: decorations
never change the document. Edits come only from explicit commands (typing, toolbar, shortcuts) and only insert or
replace plain Markdown text.

- **Inline layer** (`ui/src/editor/livepreview.ts`, `buildInline`): a CodeMirror ViewPlugin. It decorates only the lines on
  screen plus a margin, so cost follows the screen, not the note length.
- **Block layer** (`blockField`): scans top-level blocks only (today: Mermaid fences).
- **Reveal rules** (`ui/src/editor/reveal.ts`): pure functions that decide what hides. Unit-tested without a view.
- **Gutter markers**: the leading `#` and `>` characters stay in the DOM but sit outside the text flow, in the left
  margin (`.cm-gm`). Away from the line they are invisible; on the line they show. The text never moves.

## Known limitations

- **Inline marks reveal in the text flow.** When the caret enters `**bold**`, `~~strike~~` or `` `code` ``, the marks
  appear in place and push later text on that row to the right (measured: about 33 px for bold, about 55 px for a
  strike that also has a reason chip; code was 0 to 20 px). On a wrapped paragraph some words can move to another row.
  Paragraph height did not change in the measurements. Only the span the caret is in reveals. If this is annoying in
  real use, the fallback is a fixed-width fade for the marks (costs reading width while away).
- **List bullets and task boxes** still use an in-flow widget, so the line shifts a little when the caret enters it.
- **Selection highlight** starts at the text. A revealed gutter marker draws its own matching tint when the selection
  covers the start of the line.
- **Narrow windows**: the gutter needs about 28 px of extra left padding (`--gutter-room`). Markers longer than
  `###` can be clipped by the page edge below about 480 px wide.

## Accessibility

State of play, without claiming parity with a native rich-text editor:

- The editor is a plain-text `contenteditable` (CodeMirror 6). There are **no heading, list or quote roles** in the
  accessibility tree. A heading is a line of text with big type, not a heading to a screen reader.
- **Hidden syntax is not exposed** while the caret is elsewhere. Chromium's tree contains `Launch plan` and not
  `## Launch plan`, so bold, strike, heading level and link targets are not announced. On the line where the caret is,
  the source is shown and read as typed.
- Gutter markers are real text in the DOM (not generated content), so they are in the tree when shown.
- **Not tested** with NVDA, JAWS or Narrator. Everything above comes from Chromium's accessibility tree
  (`design-d3/spike/results/gates-results.json`), not from a screen reader.
- Keyboard: every action reachable by pointer is reachable by keyboard today (shortcuts, toolbar). New widgets in later
  slices must keep that.
- Contrast: the gutter marker colour passes 4.5:1 in light (4.98) and dark (8.91). Reduced motion is respected.

## Input methods

Composition (IME) text at the start of a heading or quote line landed once, in the right place, in the automated test.
That test is synthetic (Chromium `Input.imeSetComposition`), so a person typing with a real Windows IME should also
check it; see the manual test script in the slice A report.

## Known performance limit: very long notes

At about 42,000 lines a keystroke takes about 17 ms median (p95 about 26 ms); cursor moves stay near 1 ms. At about
4,200 lines a keystroke is about 2.6 ms (p95 3.8 ms). The rendering layer is viewport-only and is not the cause. The
suspected cause is `ui/src/editor/ink.ts`, which calls `doc.toString()` on every document change to map ink anchors
(whole-note string work per keystroke). **Not confirmed with a profile, and deliberately not optimised**: `ink.ts` is
in the protected ink area. Revisit only if real notes get that long.

## Test-suite flakiness (checked 2026-11-09)

Earlier sessions saw 1 to 3 timing failures at default parallelism (plan-stream, usage, providers), and one run during
slice A showed 5 failures in one file that I did not capture. To pin it down the full unit suite was run 5 more times
on the same tree: 3 times with `--maxWorkers=2` and 2 times at default parallelism. All 5 runs passed (746 passed,
1 skipped, about 43 s each). So there is no known intermittently failing file right now. If it comes back, note the
file and message here; the likely suspects are the timing-based tests, which depend on machine load.

## Fixed: selection toolbar covered the docked margin rail

In narrow layouts (about 620 px) the margin rail is a bar docked at the bottom. The selection toolbar could float over
it and hide buttons such as "Re-attach to selected text". This was a real user-facing layout bug, not only test
geometry: with a selection near the bottom of the page the toolbar overlapped the button, so most of the button could
not be clicked. The toolbar now stays above the rail; if a selection sits under the rail there is no room and the
toolbar is hidden.
## Intermittent browser check: check/threads.mjs

`node check/threads.mjs` fails about 2 runs in 5, with or without the A2 styling (measured 2026-11-09: 2 of 5 with, 2 of 5
without). The failure is at the "re-attach the orphan" step: the page shows "The note or ink changed since selection.
Review it and try again." and the wait for the orphan list to empty times out at `check/threads.mjs:71`. It looks like a
race between the pending ink sidecar save and building the re-attach preview. The cause was found later the same day; see "Fixes made after the stop at C" below.
## Lists, checkboxes and code blocks (D1)

- Bullets, checkboxes and code fences keep their source characters. Away from the line the characters turn transparent
  and a glyph is drawn in the same place, so text does not move when the caret enters or leaves (measured 0 px
  horizontally and 0 px in height for bullet, open task, done task and code lines).
- Click a checkbox, or press Ctrl+Alt+Enter on its line, to toggle it. The change replaces one character (space or x)
  and Ctrl+Z restores the exact bytes. A capital `[X]` becomes `[ ]` and then `[x]` if toggled twice; undo restores it.
- With the caret on a task line the source `- [ ]` is shown instead of the box (that is how you edit it).
- The box glyph sits over the first characters of the source, so task text starts about 5 characters in, and an open task
  and a done task differ by a few pixels because `x` and a space have different widths.
- Language packs load lazily, one chunk each, the first time a note has a fence in that language: JSON, Python, YAML,
  SQL and shell. JavaScript, TypeScript and CSS are already in the main bundle because the Markdown package needs them.
  Unknown languages stay plain monospace. All token colours are Grove tokens and pass 4.5:1 on the code background.
- Screen readers read the checkbox as its source text (`- [ ]`); there is no checkbox role yet.
- Undo right after a save used to be overwritable by a stale read of that save; fixed after stop C (see "Fixes made after the stop at C").

## Before any push: scrub the leftover reflog object

While committing D1 the two protected holdout ZIPs (ui/test/anchoring-holdout/anchoring-holdout.zip and
nchoring-holdout-round2.zip) were staged by accident. The commit was amended before anything left this machine, so no
branch contains them, but the old commit is still reachable from the local reflog and its objects are still in
.git/objects:

- commit `c3199f040701b335d47d5dd812f849ce6829f764` (the pre-amend D1 commit)
- blobs: 95ae070dd95faa29ed68b5781fdb778b667cf39b ui/test/anchoring-holdout/anchoring-holdout-round2.zip; 48305c12ef22e17b05f3c124b4f529135461209c ui/test/anchoring-holdout/anchoring-holdout.zip

Nothing was pushed. **Before the first push** the repository has to be scrubbed so those objects cannot travel, for
example by pushing from a fresh clone or after git reflog expire --expire=now --all and git gc --prune=now.
That was deliberately not run (owner instruction); do it only when told, and re-check with
`git cat-file -t c3199f0` (it should then report that the object is missing).

## Fixes made after the stop at C

- **Undo after a save could be overwritten.** The "file changed" event carries no content, so the editor fetched the file.
  A read taken just before our own next save landed after it, looked like an outside edit (versions are content hashes
  and cannot be ordered) and replaced the editor text, losing the undo. `NoteSession.refresh()` now never reads while a
  save is in flight and repeats any read that overlapped one of our saves. Deterministic regression test:
  `ui/test/session-stale-read.test.ts`.
- **Spurious "note or ink changed" on re-attach.** Two sidecar writes at the same moment (the editor's background ink
  checkpoint and the user's re-attach) made the second fail on the lock file with "Ink store busy", reported as a 409.
  `InkStore.write` now queues writes in call order; the lock file still guards other processes. This was the cause of the
  `check/threads.mjs` failures (a product race present since the ink store and that check were added on 2026-11-07/08),
  not a test selector problem. The check passed 18 of 18 runs afterwards.
- **Slash menu timing.** The autocomplete delays are set explicitly (`interactionDelay: 0`, `activateOnTypingDelay: 10`)
  and Enter or Tab on a `/query` line with the menu still pending applies the best match, so a fast `/code` + Enter no
  longer inserts a newline. Tab accepts only while a slash menu is showing or pending.
- **Tooling accident.** Removing a temporary git worktree that held a junction to `ui/node_modules` emptied the real
  folder; it was restored with `npm ci` from the unchanged lockfile. Never remove such a worktree with the junction in place.
## Diagrams: why "Diagram unavailable" appeared, and what changed

**Cause (offline, no live calls).** Nothing had recorded the two rejected specs: the trial notebook's `.aitiarch` has only
the successful third diagram, the usage log shows three diagram-sized answers (about 2,000 output tokens each) at
17:52, 17:53 and 18:05 on 2026-11-09, and the validation log only counts text failures. Running the real validator and the
real ELK layout over model-shaped specs showed the layer that fails: layout accepted every valid spec, while the strict
validator rejected 13 of 23 ordinary near misses (a label over 64 characters, `->` or `<` in a label, a URL in a label, an
extra field such as `direction`, repeated focus ids, an id shared by a node and an edge, an id starting with a digit, a
tree with two parents or two roots, a comparison with edges or more than 5 items, an over-long caption). **The exact spec
Claude sent is not known**, so which of these it was is unverified.

**What changed.** The strict check is unchanged and now reports a fixed reason code plus a JSON path. A repair step runs
first (trim over-long text, replace arrows, remove `<` `>`, URLs and control characters, drop unknown fields, clamp counts,
make ids valid and unique, fix references, turn an impossible tree or comparison into a flow or layers diagram). It can only
remove or shorten, so the strict check still guarantees plain text with no markup or URLs. A diagram that still cannot be
used shows "Diagram unavailable: <reason>" in the blob with a "Try diagram again" button that opens a normal Visualize
review (no automatic second call).

**Capture for the next real failure.** Start the server with `AITIARCH_DEBUG_DIAGRAMS=1`. Rejected and repaired specs are
appended to `ui/.debug-diagrams/diagrams.jsonl` (git-ignored, 256 KB cap, 16 KB per spec, oldest dropped first). Each row
has `at`, `kind`, `code`, `path`, `notes` (repair counts) and `raw`. It can contain text from your notes: keep it local and
remove anything private before turning a row into a fixture.

**Prompt changes to test live** (not run): the Think/Ask answer wording and the diagram rules are in
`ui/server/providers/index.ts` and `ui/shared/diagram.ts` (`diagramInstruction`, `visualizeInstruction`). Visualize, or the
words draw, diagram, visualize, sketch or flowchart in the question or the selection, switches to the required-diagram
wording.