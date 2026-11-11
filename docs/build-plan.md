# Aitiarch build plan (final, for Claude Code)

How to use this file: save it in the repo as `docs/build-plan.md` and commit it. Each session, say only:
"Read docs/build-plan.md and run Phase N." Run ONE phase per session. Never run two agents on the branch at once.

---

## 0. Standing rules (apply to every phase)

**Do not draft, and do not ask me to choose.** Every product decision is made in section 2. If something in the code contradicts a decision, follow the decision and say so in the report. Stop only for a real blocker (missing prerequisite, a decision that would delete user data, a licence that forbids use).

**Method.** Use the Superpowers TDD and verification skills only. Do NOT invoke brainstorming or any "present options and wait" step. For each behavior: failing test first, then implementation, then commit. UI work: use the impeccable plugin to design each component; do not copy impeccable's files into the repo.

**Hard rules (from AGENTS.md, repeated):**
- No live provider calls. Tests use fake CLI executables and scripted event streams.
- Never touch the real `notebook.md`. Use temp or throwaway notebooks.
- Markdown stays byte-exact (BOM, CRLF, untouched bytes unchanged).
- The AI never writes a takeaway, a "why", or a failed reason. Commit-before-reveal stays.
- Transcripts and skill files never enter the repo.
- No destructive commands outside the repo. Do not delete `node_modules`. No worktree junction tricks.
- Do not push. Do not publish to npm or any marketplace.
- Stage by explicit path only (never `git add -A`, `git add .`, or a whole folder). Run `git status` and `git log -3` before each commit.

**Budget.** Read only files you need; no repo-wide exploration; no Explore or verification subagents. Targeted tests while working; full suites once at the end of the phase: `tsc`, the unit suite, and browser checks `threads, invoked, thoughts, ink-layout, rich-text --full, ai-human, editor-gates, diagram-ui` plus any check the phase adds. Max 4 screenshots per phase, saved outside the repo in `C:\Users\UseR\Documents\aitiarch-trial\design-d3\screenshots\<phase>\`. No new docs except where a phase says so; design reasoning goes in commit messages (max 5 lines).

**Branch.** `ui-remodel`. Dark only: no light theme. Use CSS variables only; no hard-coded colors.

**Report at the end of each phase (12 lines max):** commits, what changed, test counts, the exact commands run, what is unverified, and anything you deviated from.

---

## 1. Product feel (applies to all UI)

Premium, cozy, dark. A warm study at night, not a cold terminal. Quiet by default, with a few deliberate loud moments: the "your turn" takeaway, a permission request, a running pipeline, the constellation. Space-map motion (think a galaxy map in a space game): slow drift, soft glow, camera that glides to what you pick. Motion is gentle, never blocks typing, and honours `prefers-reduced-motion` with a static version. Text contrast 4.5:1, UI 3:1, visible focus, full keyboard parity.

AI-vs-human rule stays: AI content is marked by a filled "AI" label, outline, sans type and inset. Never by colour alone, never by a side stripe. A guard check fails if any AI or quote class gets a side border wider than 1px.

---

## 2. Decisions (final)

### 2.1 Projects home
- Route `/` is a home screen of project cards. Each card: name, shortened path, last opened, note count, open decisions, threads waiting on you, and a small constellation thumbnail drawn from that project's links. Hover lifts the card slightly; reduced motion removes it.
- The registry lives in the user's config folder, never in a repo: Windows `%APPDATA%\aitiarch\projects.json`, macOS `~/Library/Application Support/aitiarch/`, Linux `~/.config/aitiarch/`.
- "Add project" opens a server-side folder browser rooted at the user's home, plus a typed-path field. If the folder has no `.aitiarch/`, show exactly what Initialize will create (`.aitiarch/index.md`, the `.gitignore` lines for `ui-state.json*`, chat sidecars and `pipeline.local.json`) and create it only on click.
- Remove from list never deletes files. Pin and sort (recent, name).
- The server serves many projects. Every file API takes a project id; every path is resolved and checked against that project's registered root. Starting with `--root <path>` registers it and opens it directly.

### 2.2 Notes as a repo (explorer)
- The left menu's notes tree becomes a VS Code-style explorer of real folders under `.aitiarch/`: expand and collapse, New note, New folder, rename, drag to move, a context menu, keyboard navigation, file icons.
- The main note is `index.md` (not a new `.note` extension, so notes stay plain markdown that GitHub and agents read). The project's root `index.md` shows a "main" badge and opens by default. Any folder may have its own `index.md`, which acts as that folder's entry note.
- Renames and moves update every link that points to the moved note, with a preview listing the files that will change. Only the link text bytes change.

### 2.3 Citations with @
- Typing `@` opens a note picker (fuzzy search, folder shown, arrow keys, Enter). It inserts a standard relative markdown link: `[@Auth plan](auth/plan.md)`; `@Auth plan#Token refresh` links to a heading (`auth/plan.md#token-refresh`).
- Rendered as a chip; Ctrl+click or Enter on it opens the note; hover shows a short preview. The source shows only on keyboard reveal, like other widgets.
- Each note gets a Backlinks section in its "..." menu and a count on its header. Broken links render as a muted chip with "Note not found - fix link".
- `@` inside code blocks, inline code and URLs does nothing.

### 2.4 Constellation (graph view)
A "Constellation" button sits beside the Chat pill and opens a full-height inner view. It must be useful, not decoration:
- Local view by default: the current note plus two hops. Global view is a toggle.
- Stars are notes; star size = number of decisions in it; colour/brightness by state: has open decisions (warm glow), all decided (steady), stale (not edited in 30 days, dim). Folders are soft nebula clusters. Edges are citations, thicker with more links, with direction arrows on hover.
- Problems surface as their own markers: orphan notes (no links in or out), broken links, notes with open decisions that nothing cites.
- Actions: click a star to fly to it and see its summary card (title, decisions, open threads, Open note); Shift-click several stars, or lasso, then "Use as chat context" sends that set to the chat context tray; "Path between" two stars highlights how they connect; filter by folder or state; search jumps to a star.
- Handoff: `handoff.md` orders decisions by the citation graph (a note's decisions come after the decisions of notes it cites), and the Constellation can show that order.
- Tech: 2D canvas with `d3-force`, parallax star layers behind the graph, lazy-loaded chunk, zero bytes in the initial bundle. Target 60 fps with 1,000 notes on a mid laptop; above that, cluster folders. Draggable stars (positions remembered per project in `ui-state.json`). Reduced motion: no drift, instant camera moves.

### 2.5 Thinking-partner persona
Write our own persona text (do not copy any skill's text). It combines three ideas: strategic planning and verification (Superpowers), keeping the human in the loop with checkpoints and "Discuss" (VibeWise, MIT), and one-question-at-a-time grilling (Matt Pocock's grill-me). Credit all three in the README.
- Modes, chosen per pipeline node: **Plan with me** (default for Think and Chat: asks for your approach first when you are deciding, lays out options with trade-offs, ends with one question), **Grill me** (opt-in: one probing question at a time until the idea holds up), **Explain** (default for Ask: answer first, then only what helps).
- Always: never decides for the user, never writes a takeaway, stays within the existing length caps, labels hypotheses, never claims what the note says without seeing it.
- Checkpoint: before the mother agent spawns sub-agents, it shows a plan card ("I'll check X and Y with 2 agents, about N tokens") with Confirm and Discuss.
- The TDD parts of those skills are for coding agents. They do not apply to thoughts or chat.

### 2.6 Skills inside the app
- **Skill library** (Settings): discover skills the user has installed, read-only. Check these on this machine and report which exist: `~/.claude/skills/`, `.claude/skills/` in the project, Claude Code plugin caches, `~/.agents/skills/`, Codex plugin caches. List name, description, source path, size. Nothing is copied into the repo.
- **Instruction mode (default):** a pipeline node can attach skills. The app reads the skill's `SKILL.md` plus the markdown files it references (cap 24,000 characters per skill, 48,000 total), and adds them to that node's prompt under "User-chosen skill instructions". Our hard rules are added after them and always win. The model has no tools in this mode, so the prompt says: follow the parts of the skill that apply to producing text output. The request review lists which skills were loaded. Works with every engine.
- **Agent mode (opt-in, per node):** the node runs as a headless Claude Code or Codex sub-agent with native skill loading, under the sub-agent provider, its permission policy and its consent screen. Scripts may run there. Off by default.
- **Diagram skills:** the Visualize node offers two renderers: Built-in (our current JSON spec pipeline, default) and Skill (for example diagram-design or Archify in instruction mode). Skill output must be one self-contained HTML document of at most 300 KB. Render it in a sandboxed iframe (`sandbox="allow-scripts"`, no `allow-same-origin`) with an injected CSP that blocks all network (`default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:`). Tell the skill to use system fonts. Save as `.aitiarch/assets/diagram-<hash>.html`. Add to note: if the document's content is a single top-level `<svg>`, also save it as `.svg` and insert a markdown image (renders on GitHub); otherwise insert a markdown link that the editor renders as an embedded live preview.

### 2.7 Pipeline Studio
- A "Studio" entry in the left menu opens a node-graph editor of the AI pipeline, built with React Flow (`@xyflow/react`, MIT), lazy-loaded.
- Default graph: triggers (Think, Ask, Visualize, Auto thoughts, Chat message) -> persona -> context modules -> engine -> output (margin blob, chat message, diagram). The chat engine connects to the mother agent and the sub-agent pool.
- Engine nodes: provider (Claude CLI, Codex CLI, ChatGPT plan), model, effort, per-call token budget. Enable the Codex CLI as an isolated provider like the Claude one: verify on this machine, read-only, the non-interactive flags for no tools or a read-only sandbox and no approvals, and report confirmed versus assumed. ChatGPT plan stays off by default.
- Locked gates appear as nodes with a padlock and cannot be removed or bypassed: Privacy review, Permission policy, Human takeaway, Commit-before-reveal. They make the safety model visible.
- The graph compiles to a typed `PipelineConfig` with exact-key validation; the runtime routes requests by this config instead of hard-coded routing. An invalid graph cannot be saved; errors show on the node. "Reset to default" always works.
- Live trace: when anything runs, its path lights up with flowing particles along the edges; nodes show status and tokens; clicking a node shows its last request and response (redacted).
- Storage: per project in git-ignored `.aitiarch/pipeline.local.json`. "Export pipeline" writes a shareable JSON with no paths, permissions or secrets; imports start disabled with a preview.

### 2.8 Custom nodes
Declarative JSON only. No code, no HTTP or webhook nodes, no file-writing or shell nodes. Allowed kinds:
- **Prompt:** extra instructions or a persona (max 2,000 characters); cannot override hard rules.
- **Skill:** wraps an installed skill in instruction mode.
- **Context:** a read-only source (notes by folder or tag, files by glob inside registered roots, git log), always through the permission policy.
- **Router:** branches on a fixed list of predicates (selection contains code, word count above N, user asked for a diagram, note has open decisions).
- **Format:** picks one output shape from a fixed list (answer, checklist, table, questions only, diagram spec).
- **Engine preset:** provider, model, effort and budget saved under a name.
Each node file is versioned JSON validated with exact keys. Import via a file picker; imported nodes start disabled and show a preview of what they do.

### 2.9 Distribution (how people get it)
- One npm package, `aitiarch`, holds the server and built UI. Commands: `aitiarch open [path]`, `aitiarch add [path]`, `aitiarch init [path]`, `aitiarch doctor` (Node version, Claude and Codex CLIs found, port, git-ignore coverage). Users run `npx aitiarch` or install it globally.
- Thin plugins for Claude Code and Codex, each with one `aitiarch` skill: when to suggest opening the notebook, how to read `handoff.md`, and the open command with a pinned version. The plugin never starts the server unless the user asks.
- Cloning the repo is for contributors only. A desktop app (no Node needed) is a later option, not this plan.
- Do not publish anything. Check the npm name availability and report it.

### 2.10 Premium local experience
- Fixed port 4317 (configurable). If the port is taken by Aitiarch, reuse it; otherwise say so plainly.
- Installable PWA: manifest, icons, a service worker that caches the static shell only (never API responses), offline shell screen. Window Controls Overlay for a custom title bar when installed.
- The launcher opens the app in its own window with Edge or Chrome `--app=<url>` when found; otherwise the default browser.
- Security baseline (check first, fix if missing): bind to 127.0.0.1 only; a random per-launch token exchanged for an HttpOnly cookie; reject requests whose Host is not `localhost`, `127.0.0.1` or `aitiarch.localhost` with our port (DNS rebinding); check Origin on every mutating request; no CORS.

### 2.11 Scrollbars
Thin, quiet scrollbars everywhere, styled for both engines: `scrollbar-width: thin` and `scrollbar-color` for Firefox, `::-webkit-scrollbar` rules for Chromium. Thumbs are faint and brighten on hover or while scrolling; blob and chat scrollers use `overscroll-behavior: contain`. Check visually in Firefox and Edge.

---

## 3. Phases

**Phase 0: inventory (cheap, no feature code).** Read `git log --oneline -40` on `ui-remodel` and report which of these exist: dark-theme remodel stages 0-3, chat milestones M1-M7, the scroll/connector fixes, smart autocorrect. Check the security baseline in 2.10 and report gaps. Check the npm name. Commit nothing except fixes to failing checks, if any. Report what to run next.

**Phase 1: foundation.** Security baseline fixes (2.10, server part only). Scrollbars (2.11). Multi-project server with the registry and path checks (2.1, backend). Tests: path traversal across projects, Host and Origin checks, token flow, registry round-trip.

**Phase 2: projects home and explorer.** Home screen and folder browser (2.1, UI). Explorer, `index.md` main note, move and rename with link updates (2.2). Tests: initialize preview, move updates links byte-exactly, keyboard navigation.

**Phase 3: @ citations and backlinks (2.3).** Tests: picker, inserted bytes, heading links, broken links, no trigger in code, CRLF/BOM.

**Phase 4: Constellation (2.4).** Includes the handoff ordering. Tests: graph build from links, orphan and broken detection, use-as-context payload, path-between, performance with 1,000 synthetic notes, reduced motion.

**Phase 5: persona and skills (2.5, 2.6).** Persona modes, checkpoint card, Skill library, instruction mode, sandboxed skill-diagram renderer and Add to note. Tests: skill size caps, hard rules appended after skills, review lists loaded skills, sandbox has no network (CSP present, no `allow-same-origin`), SVG extraction.

**Phase 6: Pipeline Studio (2.7).** Includes enabling the isolated Codex provider. Tests: default graph compiles to today's behavior, invalid graphs rejected, locked gates cannot be removed, routing follows config, export strips secrets, live-trace events.

**Phase 7: custom nodes (2.8).** Tests: schema validation, disabled-on-import, router predicates, context nodes go through the permission policy.

**Phase 8: packaging and premium local (2.9, 2.10 launcher and PWA).** `bin` commands, `doctor`, app-window launcher, PWA, plugins for Claude Code and Codex in `plugins/`, README quickstart (three steps) with credits and licences. Tests: CLI commands with temp folders, manifest validity, service worker never caches `/api`.
