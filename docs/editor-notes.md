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
