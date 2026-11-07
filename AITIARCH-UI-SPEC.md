# Aitiarch UI Spec (for Claude Code / Codex)

Status: draft v1, 2026-11-07. Claude Code and Codex integration is done (transcript readers, hooks, margin-note pipeline). This spec covers the **local web UI** only.

Read `BRIEF.md` first. This spec inherits its rules: the human owns T2 decisions, the AI never rewrites the user's text, files are the source of truth.

---

## 0. Instructions for the coding agent

- Build in the phase order in section 9. Don't start a phase until the previous one passes its check.
- Items marked **DECIDE (human)** are expensive to reverse. Present 2-3 options with cost-to-reverse and wait for the human to choose. Don't pick for him.
- Take **patterns** from Riddled, Obsidian and Word, not their branding, assets or exact visuals. Riddled is closed-source; don't copy its pixels, copy, or name.
- Every UI state must survive a reload, because it lives in files, not in browser memory.
- Windows is first-class: paths, file watching and line endings must work on Windows.
- Tests first: each implementation step starts with a failing test. Tests and checks use fixture copies, never the real `notebook.md`.
- Markdown stays byte-exact. Anchoring never adds anchors or ids to the user's text. The AI never writes the human's takeaway, "why", or failed-reason.

---

## 1. The one rule that shapes the whole UI

**The page belongs to the human. Anything the AI writes is "ink" that sits beside or under the page until the human pulls it in.**

- User text lives in the note's `.md` file.
- AI ink (margin notes, inline answers, diagrams, thread replies) lives in a sidecar file, anchored by quoted text and context (section 7).
- "Keep in note" copies the ink into the `.md` file, and from then on it's the human's.
- If an agent edits a note file directly (Edit/Write tool), the UI shows the change as a tracked change (Word-style) the human accepts or rejects.

---

## 2. What we take from each inspiration

### From Riddled (the interaction model)
- **Ink under your words.** When invoked, the AI answers directly under the paragraph in a distinct ink color, visually separate from user text.
- **Follow the thought.** Any note or answer opens into a thread where you ask why and push back. It ends with the human writing the takeaway back into the page.
- **Draws step by step.** Diagrams appear in ink under the text and reveal step by step (step counter, prev/next, captions). "See it larger" opens a zoomed view. "Select anything → Draw."
- **Per-note mode.** Each note has a proactivity mode. Riddled has "thinks with you" vs "when you ask". Aitiarch uses the setting from the margin policy (see section 6).
- **Per-note purpose.** A one-line instruction for how the AI should behave in this note ("challenge my DB choices", "quiz me").
- **Later:** expert personas (staff engineer, security reviewer) that critique the same sentence differently.

### From Obsidian (the workspace)
- File tree sidebar, tabs, split panes.
- **Live preview** markdown editing (formatting renders as you type, source shows on the active line).
- `[[wikilinks]]`, backlinks panel, outline panel, `![[embed]]` transclusion, frontmatter shown as a Properties panel.
- Command palette (Ctrl/Cmd+P) and quick switcher (Ctrl/Cmd+O).
- **Obsidian compatibility is nice-to-have.** Plain markdown, wikilinks, frontmatter and Mermaid fences are useful compatibility patterns, but compatibility never costs byte-exactness or adds ids to the user's markdown.
- Defer: graph view, canvas boards.

### From Microsoft Word (review and margin)
- **Comment balloons in the right margin**, aligned to their paragraph, with collision-avoidance layout. Proactive margin notes render this way because it's quieter than inline ink.
- **Track changes** for any agent edit to a note file: insertions and deletions colored, with accept/reject per change and for all.
- **Navigation pane** = outline panel.
- Optional **page view** (fixed page width, print-friendly) as a toggle; default is a readable column.

---

## 3. Layout

```
┌───────────────────────────────────────────────────────────────────────┐
│ Tabs: [auth-plan.md] [d-7f3a Session storage] [+]     Mode ▾  Agent ● │
├────────────┬──────────────────────────────────────┬───────────────────┤
│ Notebooks  │  # Auth plan                         │  Margin rail      │
│  auth-plan │                                      │  ┌─────────────┐  │
│  search    │  Sessions in Redis, 7-day TTL.       │  │ ⚠ The agent │  │
│ Decisions  │   ┊ ink: stepped diagram (2/4) ◀ ▶   │  │ assumed JWT │  │
│  proposed  │                                      │  │ at T31. Why │  │
│  decided   │  ~~JWT in localStorage~~             │  │ Redis?      │  │
│ Branches   │    {failed: XSS exposure}            │  └─────────────┘  │
│ Search     │                                      │                   │
│            │  ![[d-7f3a]]  (decision card)        │  [Outline|Links|  │
│            │                                      │   Props|Activity] │
├────────────┴──────────────────────────────────────┴───────────────────┤
│ Linked: Claude Code (VS Code) · session 4f2… · synced 2s ago · 812 w  │
└───────────────────────────────────────────────────────────────────────┘
```

- **Left sidebar:** notebooks (file tree), decisions grouped by status, branches, search.
- **Center:** the editor. Readable column (~720px) by default; page view toggle.
- **Right margin rail:** comment balloons aligned to blocks. Collapsed to small dots when the rail is hidden.
- **Right panel tabs:** Outline, Backlinks, Properties (frontmatter), Activity (live agent session: what it's doing, last turns, which files it touched).
- **Status bar:** linked agent session, sync state, word count.
- **Top bar:** tabs, per-note mode switch, agent presence indicator.

---

## 4. Core interactions

### Selection toolbar
Select text → a floating toolbar with four rows. Basis: Riddled's selection toolbar (format rows plus two AI actions); Aitiarch keeps the AI actions to two and adds a row for its own actions.

```
 ¶  H1 H2 H3 H4   ⇥  • list  1. list          ← block type
 B  I  S(failed)  <> code  [] code block       ← inline, markdown-safe
 Think on this                       Ctrl+Enter ← AI, one click
 Ask…                            your own question
 Make decision    Branch                        ← Aitiarch actions
```

**Format rows: markdown-safe only.** Everything here round-trips as plain markdown. Excluded on purpose: underline and text colors, because they would force HTML into the files and break clean rendering in Obsidian. If emphasis beyond bold is wanted later, use Obsidian-style highlight (`==text==`).

**S means failed (decided).** The strikethrough button is the failed-attempt mark. There is no plain strikethrough.
- Pressing S on a selection opens a one-line reason field. Result: `~~text~~ {failed: reason}`.
- The reason is human-only. The AI never writes it. The field allows a "don't know yet" choice, stored as low confidence, so the user isn't forced to invent a reason.
- Typing `~~text~~` by hand without a reason is allowed. The UI marks it "needs reason" with a soft nudge, never a block.
- Struck text keeps its reason visible on hover and in the Activity tab. "Restore" removes the strike and the reason.

**AI actions (invoked mode, full intelligence, no abstention bias):**
- **Think on this (Ctrl+Enter, Cmd+Enter on Mac):** one click, the AI chooses whether to explain, ask a question, or draw. Answer appears as ink under the block.
- **Ask…:** a free-text box for the user's own question about the selection.
- **Command palette only (not toolbar buttons):** Explain, Draw (diagram), Challenge (the AI asks one hard question and gives no answer).

**Aitiarch actions:**
- **Make decision:** creates a decision file and embeds it as `![[d-xxxx]]`.
- **Branch:** learn or option branch (see BRIEF.md), opens in a split pane.

Implementation note: CodeMirror 6's tooltip extension supports a floating toolbar like this, so it doesn't constrain the editor choice.

### Threads ("follow the thought")
- Click any margin note or ink block → it expands into a thread (inline, or in the right panel when narrow).
- The user replies, the AI replies. The AI asks more than it tells.
- Closing a thread offers **"Write takeaway"**: a text box the *human* fills. The takeaway lands in the note under the anchored block. The AI can show its summary only *after* the human submits (commit-before-reveal).
- **"Skip takeaway"** is an explicit alternative, recorded as skipped in the thread sidecar. It never silently creates a takeaway or reveals the AI summary; the AI never writes the human's takeaway.

### Decision cards
- `![[d-7f3a]]` renders as a card: title, status, tier, reversal cost, owner, the human's "why".
- For a T2 decision still `proposed`: the AI's recommendation is **blurred** until the human writes a pick. A **Peek** button reveals it and sets `peeked: true`.
- The "why" field is human-only. The UI never pre-fills it.

### Agent track changes
- A `PostToolUse` hook on Edit/Write to a notebook path tags the change as agent-made.
- The UI renders it Word-style: green insertion, red strike for deletion, author chip "Claude" or "Codex", accept/reject.
- Unaccepted agent changes are listed in the Activity tab.

### Live sync
- File watcher → SSE → the editor applies external changes as CodeMirror transactions **without losing the user's cursor or unsaved typing**.
- If an external change touches the block the user is typing in: don't overwrite. Show a conflict marker on that block with "keep mine / take theirs / view both".

---

## 5. Diagrams (Riddled-style, agent-drawable in real time)

Basis: exported Riddled notes (2026-11-07) show that it has the model write **raw SVG** in a fenced block, with each reveal step a `<g data-step="n" data-caption="...">` group and all colors/fonts set through CSS variables. Aitiarch adopts that mechanism, adds validation and sanitizing, and keeps Mermaid for graph-shaped diagrams. Quality in Riddled's export was mixed: linear flows were fine, and a freehand "draw me" request produced a stick figure, which has no value for planning.

### Formats, in build order

**A. Step-SVG (primary).** An `svg` code fence containing one `<svg>` with a `viewBox` and one `<g data-step="N" data-caption="...">` per step, numbered from 1 with no gaps.
- The renderer shows steps 1..k and the caption for step k. No layout engine; the agent places shapes itself.
- Colors and fonts come from theme variables only (`--ai-ink`, `--ai-graphite`, `--ai-faint`, `--ai-rule`, `--ai-wash`, `--ai-font-voice`, `--ai-font-sans`), so one ink color setting recolors every diagram. Agents must not hardcode colors.
- Controls: `◀ 2/7 ▶`, autoplay, "See it larger" (modal with pan/zoom), "Keep in note", "Open in canvas".
- Stays valid markdown, so it survives export. Obsidian shows it as a code block, which is acceptable.

**B. Mermaid fences**, for flowchart, sequence, ER, state and class diagrams, especially anything with branches or loops, where hand-placed SVG gets messy.
- Rendered inline, lazy-loaded. Use Mermaid's hand-drawn look where the diagram type supports it, and the classic look otherwise.
- Renders in Obsidian too.

**C. `aitiarch-sketch` (deferred; build only if the Phase 3 experiment justifies it).** A small graph spec (nodes, edges, steps) that Aitiarch validates, lays out once on the **full** graph with dagre (so nodes don't move between steps), draws with rough.js, and **compiles into format A**. It is a front end for A, not a separate renderer. Only the short source is stored; the SVG is regenerated.

### SVG sanitizing and validation (required, in code, before anything is shown)
Agent-written SVG is untrusted input in a local web app.
- Parse as XML. Reject if it fails.
- Allowlist elements: `svg g path circle ellipse rect line polyline polygon text tspan defs marker title desc`. Everything else is rejected, including `script`, `foreignObject`, `image`, `style`, `a`, and `use` with an external reference.
- Reject any `on*` attribute, any `href`/`xlink:href` pointing outside the document, and any `url(...)`/`@import` in style values.
- `style` attributes may only use an allowlist of properties, and colors/fonts only via `var(--ai-*)`.
- Require a `viewBox`, steps numbered 1..n without gaps (max 12), a `data-caption` on every step, and a size cap (default 100 KB).
- Serve the app with a Content-Security-Policy that blocks inline scripts and remote loads.
- On failure, the `draw` tool returns the exact error to the agent so it can fix and retry. Invalid diagrams never reach the UI.

### How the agent draws in real time
1. The agent calls the MCP tool `draw({ note, anchor, kind: "svg" | "mermaid", source })`.
2. The tool validates (section above for SVG, Mermaid parse for Mermaid) and returns errors to the agent.
3. On success it writes to the note's ink sidecar, anchored to the block.
4. Watcher → SSE `ink.added` → the UI renders it under the block and plays the steps.
5. While the agent is working, the anchor shows "Claude is drawing…".

If a render still fails in the browser, keep the last good render and show an error badge. Never show a blank box.

### Human editing of diagrams
- "Open in canvas" converts to Excalidraw (MIT, `@excalidraw/excalidraw`; `@excalidraw/mermaid-to-excalidraw` for flowcharts) and saves a `.excalidraw` file beside the note. For raw SVG with no Mermaid origin, the canvas gets the SVG as an image or a best-effort conversion; confirm what works before promising editability.
- **One-way.** Once edited in the canvas it is human-owned, and the agent must ask before regenerating it.
- Don't use tldraw: since SDK 4.0 production use needs a license key, which doesn't fit a free open-source tool.

### Drawing policy
- Drawing is **invoked-only** by default (select → Draw, or the user asks). A proactive diagram counts as an intervention and goes through the margin policy.
- **Technical diagrams only:** flows, architecture, sequences, state machines, data models, timelines. No people, scenes or freehand art. If the request is ambiguous ("draw me"), the agent asks what to draw instead of guessing.

### Experiment before Phase 3 (decides whether format C is built)
Have Claude Code and Codex each draw the same five diagrams as step-SVG and as Mermaid, including at least two with branches or loops. Compare side by side. If either format is good enough at branching, skip C. If both are bad and you want the step reveal on graphs, build C.

---

## 6. Margin behavior (ties to the intervention policy)

- Per-note mode: **Off · Contradictions only · Normal**. Default: **Off** in Phase 2a. Only after the 20-case intervention experiment passes, Phase 2b changes the default to **Contradictions only** and implements proactive notes. Phase 2a stores the per-note setting but does not run proactive checks.
- Proactive notes (unprompted) → margin balloons, never inline.
- Invoked answers → inline ink under the block.
- Each proactive balloon (Phase 2b) shows its evidence chips (`note:L4`, `transcript:T31`, `d-7f3a`). Clicking a transcript chip opens that turn in the Activity tab.
- Every balloon has Dismiss and "Not useful". Both write to the ledger so the same note doesn't return.
- In Phase 2b only, unprompted checks fire at boundaries (section finished, decision marked `proposed`, review opened, before agent commit), never mid-typing.

---

## 7. Storage

The root is a project's `.aitiarch` folder. Default root: `./.aitiarch` under the current working directory; `--root` overrides it. Paths below are relative to that root. Never copy notes into the Aitiarch repo, and never nest ink under a second `.aitiarch` folder.

```
<project>/.aitiarch/           # root (or the --root override)
  notebook.md                 # human-owned page
  auth-plan.md                # other *.md notes
  decisions/
    d-7f3a.md
  ink/
    notebook.ink.json         # sidecar for notebook.md
    auth-plan.ink.json        # sidecar for auth-plan.md
  ledger.json                 # shown/dismissed notes
  ui-state.json               # git-ignored UI state
  runs/                       # private; hidden from file tree
  measurements/               # private; hidden from file tree
  backups/                    # private; hidden from file tree
  usage.jsonl                 # private; hidden from file tree
```

- **Anchoring (decided):** quoted text, prefix/suffix context, and a position hint, stored only in the ink sidecar. Nothing is added to the user's markdown: no block ids or other anchor markers, including when ink is kept.
- When anchored text is edited or moved, re-anchor by closest match using the quote, context and position hint. If no match exists, preserve the ink as **orphaned**, shown in a list in the Activity tab; never drop it. Tests cover edits, deletions, moved paragraphs, duplicated text and orphans, including protection against attaching ink to the wrong text.
- **Ink format (decided):** one pretty-printed JSON file per note, with stable key order.
- Provide an **Export** command that flattens a note to one `.md` with a trailing "Notes" section (quoted anchor, then the thread, then diagram fences). Export only; the working files stay split.
- Transcripts are never copied into the repo.

---

## 8. Tech stack

- **Frontend:** Vite + React + TypeScript. Served by a new local Node server (there is no HTTP server yet; this phase adds the project's first npm dependencies). Whether to commit the built bundle is undecided. No Next.js (no SSR needed).
- **Editor:** CodeMirror 6 with live-preview decorations (Obsidian is built on CM6, so the approach is proven). Markdown is the canonical file and stays byte-exact; there is no markdown-to-document-to-markdown conversion. **DECIDE (human):** CM6 live preview (recommended; byte-exact, more work to build) vs a ProseMirror-based WYSIWYG like Milkdown/TipTap (faster Word-like feel, but serializing back to markdown can reformat files, which pollutes diffs and clashes with agent edits). The rich-text *feel* comes from live preview (formatting renders as you type, markup shows only on the active line), not from a different file format. Phase 1 uses a minimal decoration set; tables and further polish come after Phase 2.
- **Diagrams:** step-SVG with an in-code sanitizer (primary), Mermaid (lazy-loaded), Excalidraw for canvas editing. dagre + rough.js only if format C is built.
- **Transport:** SSE from server to browser, plain HTTP POST from browser to server.
- **Validation:** zod schemas shared between the MCP tools and the UI.
- **Look:** warm paper background and near-black text in light mode, a dark mode, one ink color for AI (user-selectable). AI prose uses the same body font as the page, in ink color with a thin left rule. Handwriting fonts only for diagram labels, if at all, since they hurt readability.

---

## 9. Build phases

**Phase 1: shell and editor**
File tree, tabs, CM6 live preview (headings, emphasis, lists, code, links, wikilinks, Mermaid render), the floating toolbar's format rows and the S-means-failed mark (rendering plus reason field), read-only Properties panel, command palette, quick switcher, live sync with external edits. Preserve CRLF and BOM exactly on save; autosave must be compare-and-write against the last version the editor saw.
*Check:* Claude Code edits a note while you're typing in another paragraph. Your cursor and text survive and the change appears within a second.

**Phase 2a: invoked AI only**
Build in this order, with each step independently testable and starting with a failing test. Use fixture copies throughout; never touch the real `notebook.md`.

1. Ink store plus anchoring and re-anchoring (section 7), with tests for edits, deletions, moved paragraphs, duplicated text and orphans. No AI, no UI. Report wrong attachments (must be zero) and unnecessary orphans; try prefix/suffix context and the position hint before declaring ambiguity. Export is decided but outside Phase 2a.
2. Inline ink and margin-rail rendering using fake data to settle the layout. A margin rendering fixture does not enable proactive notes.
3. Toolbar "Think on this" and "Ask…" via headless calls to the user's own Claude or Codex CLI, behind one provider interface. Reuse the existing prototype pipeline; no API keys. Add the ledger of shown and dismissed notes.
4. Threads and "Write takeaway" with commit-before-reveal. The human writes the takeaway; the AI summary is revealed only after submission. Explicit "Skip takeaway" records skipped in the thread sidecar; show the exact thread file shape for human review before building this step.
5. Per-note mode setting, default Off; no proactive caller.

*Check:* on a fixture copy, ask five questions, edit the anchored paragraphs, and confirm no ink goes missing or attaches to the wrong text. Document how the user can run this check themselves. This is the final Phase 2a task.

**Phase 2b: proactive notes — gated, not part of Phase 2a**
Build only after the 20-case intervention experiment passes. Proactive notes use margin balloons; invoked answers stay inline. Default proactivity becomes Contradictions only after that gate passes.
*Check:* a week of real use where proactive notes don't annoy you, and every takeaway in your notes is text you wrote.

**Phase 3: diagrams**
Run the diagram experiment first (section 5). Then: step-SVG renderer with sanitizer and validation, theme variables, Mermaid rendering, the `draw` MCP tool, stepper controls, See larger, Keep in note, Open in canvas.
*Check:* ask Claude Code "draw how a request flows through auth" and watch it appear step by step under the paragraph without reloading.

**Phase 4: decisions, failures, branches, review**
Decision cards with blur and Peek, branches in split panes, backlinks, outline, agent track changes with accept/reject.

**Deferred:** graph view, canvas boards, expert personas, page/print view, themes beyond light/dark, `aitiarch-sketch` compiler (format C).

---

## 10. Risks

- **Live preview in CM6 is the biggest time sink.** Start with a minimal set of decorations and grow it. Don't chase Obsidian parity.
- **External edits while typing** can lose work if handled naively. Phase 1 must prove this before anything else is built on top.
- **Margin layout** (balloons aligned to variable-height blocks and animated diagrams) is fiddly. Budget time for it.
- **Scope creep.** Obsidian and Word are years of work each. Take the 20% that serves human-owned decisions.
- **Unsafe or ugly agent SVG.** Untrusted markup must pass the sanitizer, and hand-placed layouts degrade on branching diagrams. Use Mermaid for those.
- **Ink anchoring.** Edits, deletions, moved paragraphs and duplicated text can make quote/context matching difficult. Preserve unmatched ink in the orphan list instead of losing it or attaching it to the wrong text.

---

## 11. Open decisions for the human

- [ ] Editor engine: CM6 live preview (recommended) vs ProseMirror WYSIWYG
- [ ] Save behavior: autosave with debounce (recommended) vs explicit save
- [x] Storage root: the project's `.aitiarch` folder; default `./.aitiarch`, `--root` overrides. Never copy notes into the Aitiarch repo.
- [x] Strikethrough means failed, with a required human-written reason (decided)
- [x] Default proactivity mode: Off for Phase 2a; Contradictions only after the 20-case intervention experiment passes in Phase 2b.
- [x] Ink sidecar format: one pretty-printed JSON file per note, stable key order; flattened markdown export as well.
- [x] Obsidian compatibility: nice-to-have; never at the cost of byte-exactness.
- [ ] AI ink color and overall visual identity
- [x] Invoked answers inline; proactive notes in the margin.
- [x] Anchoring: quoted text plus prefix/suffix context and a position hint in the ink sidecar; no markdown ids. Closest-match re-anchoring; unmatched ink preserved in the orphan list.
- [ ] Build `aitiarch-sketch` (format C) or not, after the diagram experiment
- [ ] Name for the theme CSS variables (`--ai-*` is a placeholder)
