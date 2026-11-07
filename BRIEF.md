# Project Brief: Human-Owned Decision Notebook for AI Coding Agents

> Working title: `Aitiarch` (placeholder ideas: think, ledger, margin)
> Original status (2026-11-06): skeleton / pre-prototype.
> Audience: Claude Code (and later Codex), used as the starting prompt for this repo.
> Current status (2026-11-07): The minimal local prototype is installed; the first live decision resurfacing is corroborated, while usefulness remains unproven. The minimal defaults and implementation are approved for `<project>`, notebook `.aitiarch/notebook.md` and records `.aitiarch/decisions/`. Inspection found no existing notebook. Approved defaults include local Markdown, human-written rationale, advisory-only hooks, disabled proactive comments, Node hooks and Python transcript reading. Local reading does not authorize transmitting transcript excerpts; no prototype transcript transmission is authorized. Riddled-style web notebook, inline assistance, branching and learning features remain long-term vision. Dated status below and unimplemented feature/schema sections are historical context, not additional implementation authorization. See the current checkpoint in the MVP plan.
> De-risking update (2026-11-06): The approved offline v3 validation improvement is complete; A remains baseline and B is not adopted. The minimal MVP proposal in docs/superpowers/plans/2026-11-06-minimal-aitiarch-mvp.md awaits review. No MVP is implemented. UI, full decision schema, MCP, and a second model gate remain on hold; proactive comments remain experimental and disabled by default. See NOTES.md for replay results and the independent AI review (not a human study).

> Codex checkpoint (2026-11-07): The separately authorized repository-local advisory `apply_patch` adapter is installed and manually trusted. Exact decision delivery is verified through the VS Code extension's bundled app-server; a fresh VS Code chat UI check and usefulness remain unverified. Initial CLI-exec and Windows-launch failures are preserved in NOTES.md. No expanded product scope or transcript transmission is authorized by this checkpoint.

---

## 0. How to use this brief (instructions for Claude Code)

You are helping me build this project. Read the whole brief first, then:

1. **Do not build UI first.** The first deliverable is the no-UI weekend prototype in section 9.
2. **Ask before assuming** on anything marked `TODO(me)` or `OPEN`. Those are my decisions, not yours. Propose 2-3 short options with tradeoffs, then wait.
3. **Keep options terse.** Max 3 options, 2 lines each, plus a "cost to reverse" tag (cheap / annoying / painful).
4. **Record decisions as files** in `decisions/` using the schema in section 6, once that schema exists. Until then, note them in `NOTES.md`.
5. **Do the research and boring work yourself** (searching, scaffolding, boilerplate). **Do not make T2 decisions for me** (section 5). Present them, let me choose, then proceed.
6. Treat every number, license, or star count in section 8 as "verify before relying on it" if it is marked unverified.

---

## 1. The desire (what I want this to be)

A Claude Code / Codex **skill** that opens a **local web notebook** (chat-like feel, but not a chat) and saves everything as **plain markdown in the repo**.

While planning a system with an AI agent, the notebook is where the thinking lives: design choices, options considered, dead ends, and reasons. It exists so that:

- I **stay in control** of the system I'm building and can explain it a week later.
- The AI does the **research and boring work**; I own the **reasoning and the decisions**.
- The record **outlives the session, the model, and the tool** (it is just markdown).

**One-line pitch (draft):** "Your agent stops re-suggesting what you already killed, and you always know why your system looks the way it does."

**Problem:** AI "dumbification" is real for coding and system planning. The agent decides, I click approve, and later I cannot defend my own architecture.

---

## 2. Core ideology (the spine; every feature must serve this)

> The AI researches, drafts, and does the boring work. The human owns every decision that is expensive to undo, and reasons through it instead of rubber-stamping.

The app is **aggressive about participation in reasoning and decisions**, not about grunt work. It should be **quiet most of the time and loud when it counts** (friction proportional to cost-to-reverse).

### Design principles

1. **Friction scales with cost-to-reverse.** Tiers T0 / T1 / T2 (section 5).
2. **Resurfacing before capture.** Showing the right past decision at edit time is the payoff. Capture only matters if it feeds this.
3. **Human commits first, then sees the AI's pick.** Peeking is allowed but logged.
4. **Failed attempts are first-class.** Struck-out text plus a reason, fed back to the agent so it stops re-suggesting dead ends.
5. **Soft nudges only.** Warnings arrive as injected context. Never hard-block the agent or the user.
6. **Files are the bus.** One decision per `.md` file. UI, hooks, and MCP are all views over the files. Removing the tool loses nothing.
7. **Terse and fast.** UI opens in under 2s, no build step on the user's machine, keyboard-first. AI output is short and sits in the margin.
8. **Do not sell "ownership" as "understanding."** Ownership gives a durable record and control. It does not prove comprehension.

---

## 3. Goals and non-goals

### Goals
- `TODO(me)`: confirm/edit
- Make it hard to rubber-stamp architectural decisions without making it painful to ship.
- Stop agents from re-litigating decided questions and re-suggesting dead ideas.
- Give me a 30-second answer to "what did I decide last week, and why?"
- Work natively inside Claude Code (primary) and Codex (secondary) via skills, hooks, MCP, AGENTS.md, **not** raw API calls.
- Be a good open-source project for CS students / developers (stars, forks, contributions), and a strong portfolio piece.

### Non-goals (v1)
- Not a general note-taking app. Not a chat UI. Not a project planner.
- No hard gates that block the agent.
- No team/multi-user mode.
- No graph view, no embeddings, no tree-sitter in v1.
- No database; no build step for end users.

---

## 4. Feature vision (what the app does)

### 4.1 Notepad
- Plain markdown editor (not a chat). My text on the left, a **narrow AI margin** on the right that asks, explains, and annotates. It never rewrites my text.
- **Strike-through with reason:** `~~Use JWT in localStorage~~ {failed: XSS exposure, found 2026-11-02}`. One hotkey plus a one-line reason prompt.
- **Branching:** fork a notepad from any point (`parent:` + `forked_at:` anchor). Shown as a small tab strip, not a tree.
- **Learn branches (Riddled-style side quests):** open a branch to learn something ("how do refresh-token rotations work?"), let the AI explain/draw freely there, then **merge a takeaway back into the main notepad**.
  - I write the takeaway first (1-3 lines), then the AI shows its own summary, flags gaps, optionally asks one question.
  - The takeaway lands in the main notepad as a block linked to the branch (`{from=b-XXXX}`); the full branch collapses into an archive.
  - Escape hatches: "merge as quote", "abandon, nothing learned."
  - Coding agent sees only merged takeaways by default (keeps context small).
- **Option branches:** explore an alternative design; merges back as a struck-out option with a reason, or as the chosen path.

### 4.2 Decisions
- One decision per file, one screen at a time, 2-3 compact option cards, each with: one-line summary, 2 upsides, 2 downsides, and a **cost to reverse** tag.
- **Commit-before-reveal:** I pick and write a one-line "why"; then the AI reveals its recommendation and argues if I disagree. `r` peeks early and logs `peeked: true`.
- **"Why" is human-only** (AI may question it, never write it). "idk, seemed fine" is a valid record and gets tagged `confidence: low`.
- **One targeted question** before locking (specific, e.g. "what happens at 10x writes?"; never generic "are you sure?").
- **Delegation on the record:** `d` marks a decision AI-decided, visibly tagged.

### 4.3 Resurfacing (the killer feature, build first)
- When the agent edits code near a past decision or dead idea, the relevant 1-2 decisions are injected as context ("you chose X over Y because Z. Still true?").
- Must be fast and low-noise (a false positive costs more than a miss). **Measured Windows result:** Node through Git Bash took 72.10ms median / 77.46ms p95 for a matching one-file hook (100 fresh processes, warm caches); 0/100 met the original guessed 50ms target. The read/match body was about 0.95ms in live Write/Edit calls.
- **Provisional Windows experiment budget, pending review:** p95 <=100ms for the shell-launched advisory hook, with a <=5ms read/match-body target. These are engineering budgets derived from the current one-file baseline, not a selected runtime, production guarantee, timeout, or permission gate. Claude dispatcher overhead and a full decision corpus remain unmeasured. Preserve the original <50ms goal as an unachieved aspiration for this launch mode.

### 4.4 Handoff to the coding agent
- Session start injects a compact digest (T2 decided and dead items only, ~1-2k tokens).
- If the agent touches an undecided area, it posts a one-line terminal note ("auth storage not decided, ask or delegate?") and I answer inline (y / n / open). Soft only.

### 4.5 Later (v2+)
- **Retroactive mode:** agent proposes "decisions that seem to have been made" from git history and PRs; I accept or reject each (human stays in the loop).
- **Weekly summary:** one readable view of last week's decisions.
- **Git/PR links** per decision. **Drift checks** (advisory only).
- **Quiz-me-lite:** 2-3 optional questions from my own struck-out paragraphs, skippable, no streaks, no counters.
- **Graph view** (secondary, optional). Citations: plain URLs in `refs:` are enough for now.

---

## 5. Tiers (adaptive friction)

| Tier | Meaning | Behavior |
|---|---|---|
| **T0** | Naming, file placement, formatting | Agent decides silently. One-line log, never shown. |
| **T1** | Library choice within an established pattern | Agent decides and logs. Appears in a reviewable digest. |
| **T2** | Storage, auth, schema, public API, anything "painful" to reverse | Human-owned. Full one-decision-per-screen flow. |

- Tier is proposed by the agent and overridable by me with one key.
- Driven by cost-to-reverse plus a rules file listing sensitive paths.
- Delegation is the default only for reversible tiers (T0/T1). Architectural/irreversible defaults to "ask."
- "That should have been T2" must be a one-key correction that teaches the rules file.
- Friction budget: if too many T2 items are pending, offer "delegate the rest?" or auto-expire stale ones. **No red badges, no guilt counters.**

---

## 6. Data model (draft)

One decision per file, e.g. `decisions/d-7f3a-session-storage.md` (random short ids, not sequential, to avoid merge collisions).

```yaml
---
id: d-7f3a
title: Session storage
status: decided        # proposed | decided | delegated | dead | superseded
tier: 2
reversal: painful      # cheap | annoying | painful
owner: human           # human | agent-delegated
decided_by: TODO
decided_at: 2026-11-06
paths: [src/auth/**, prisma/schema.prisma]
tags: []
links: []              # related decision ids
supersedes: []
refs: []               # urls, commit shas, PRs
parent: null           # for option branches
peeked: false
confidence: normal     # low | normal
---
```

Body sections: **Context**, **Options considered** (struck-out ones carry `{failed: reason}`), **Decision**, **Why** (human-written, clearly delimited so tooling knows it is human text).

Branch/notepad files live in `branches/`:

```yaml
---
id: b-0317
kind: learn            # learn | option
parent: notepad-auth
forked_at: "## Session storage"
status: open           # open | merged | abandoned
merged_into: d-7f3a
takeaway_by: human
refs: []
---
```

Rules:
- Git branches are for code; notebook branches are just files with `parent:`.
- Derived index (`.notebook/index.json`) is gitignored. Everything else is plain markdown.
- Keep all notebook files under one folder to limit repo clutter.

---

## 7. Users' first impressions (simulated AI vibe-coder persona)

A skeptical, busy Claude Code / Codex user reacted to the idea. Treat this as design input, not truth; validate with real users later.

**Gut reaction:** would install to look; keeps it only if fast and not fighting him. Forcing on *every* decision gets it uninstalled (he makes ~40 choices an hour, ~35 are naming and folders).

| Feature | Reaction |
|---|---|
| Markdown in repo | Love (grep/diff/commit). A DB or cloud = out. |
| Human owns every decision | Annoying as stated; "every" is wrong |
| Think-alongside, no click-to-accept | Useful for architecture, hated for "add a retry" |
| Branching + tried-and-failed | Love |
| Claude Code / Codex native | Love |
| Tiering / delegation | Love, "required, make it default for most things" |
| Resurfacing past decisions | **Killer feature, build first** |
| Hide AI pick until commit | Useful but risky; needs logged peek escape hatch |
| Human-only "why" | Useful; he'll type "idk" at 11pm |
| One targeted question | Love if good; uninstall if generic |
| Handoff gate | **Hard block = uninstall**; soft warning = love |
| Graph view | Meh, decoration |

**Week-one abandonment causes:** opening takes >~2s or needs a build step or port fights; five questions before any code; long walls of options; hook blocking mid-flow; window switching/copy-paste; pending-decision backlog guilt; markdown clutter or merge conflicts; spinner while the agent researches.

**UX asks:** one decision per screen; compact option cards with cost-to-reverse tag; keys 1/2/3, Tab to why, Enter to commit; `r` peek, `d` delegate; Cmd+K palette; notepad as markdown editor with AI margin (not chat); decisions list with status + path filter instead of a graph; terse AI output; everything keyboard-reachable.

**Missing (his list):** 30-second "what did I decide last week"; retroactive mode for existing repos; git/PR links; drift alerts; optional quiz-me-lite; team mode later.

**His warning:** quality of what the AI shows matters more than the lock. Spend effort there.

---

## 8. Developer solutions, critics, and observations

### 8.1 Developer view (simulated senior tooling engineer)

- Ideology survives only if friction is proportional to cost-to-reverse. Stop trying to enforce comprehension; treat "why" as a memo for future-me and the agent.
- **Claude Code is the primary target.**
  - `PreToolUse` hook matching `Edit|Write|MultiEdit`: read `file_path`, look up linked decisions in a prebuilt index, return `additionalContext`.
  - `SessionStart` hook: compact digest. `UserPromptSubmit` optionally matches prompt keywords/paths.
  - Soft gating = injected context or `ask`; never `deny` by default.
  - SKILL.md teaches the protocol; hooks are the enforcement backstop.
- **Agent <-> UI without API calls:** files are the bus. File watcher -> SSE to browser. Small stdio MCP server (`propose`, `get`, `list`, `peek`) for anything needing a blocking answer.
- **Launch:** one command, idempotent, deterministic port from repo-path hash, writes `.notebook/server.json`, ships prebuilt static assets.
- **Mapping decisions to code (hardest problem), cheap to expensive:**
  1. Explicit path globs in frontmatter (~70% of cases).
  2. Commit/diff links from the implementing session.
  3. Keyword/import match (dependency names are a strong signal).
  4. `git log --name-only` co-change.
  5. Skip embeddings.
- **Resurfacing noise rules:** max 2 decisions per edit; once per decision per session; relevance threshold; mutable per decision.
- **Stack suggestion:** TypeScript, single Node/Bun process, Hono/Fastify, static Preact/React/Svelte bundle, CodeMirror 6, in-memory index rebuilt from files, SSE.
- **Cut from v1:** graph, hard gates, 5-question intake, chat UI, DB, team features.

### 8.2 Critics and risks

- **Option quality is the product.** Generic options turn the lock into a tax.
- **Resurfacing noise** makes people disable the hook.
- **Tiering errors:** misclassifying important things as T0, or spamming T2.
- **Hook latency / "blocking mid-flow" perception.** Measured Windows Node direct launch was 37.64ms median / 40.01ms p95; the actual shell-command launch shape was 72.10/77.46ms. Bun through Git Bash was 229.78/249.43ms on this installation. Startup dominates the one-file lookup. Compiled and persistent-process alternatives have not been tested; no runtime choice is adopted.
- **Backlog guilt:** use auto-expiry, never red badges.
- **Skill adherence:** agents sometimes ignore skill text; hooks are the backstop. Hooks are a guardrail, not a security boundary.
- **Fake "why"s and peek abuse:** accept, log, don't fight.
- **Core thesis is unproven:** nobody has shown commit-first improves decisions. Anthropic's study (n=52, learning a library) showed delegating to AI hurt learning (50% vs 67% for hand-coders) and that explain-then-ask patterns did better; it did **not** test decision quality. A margin-notes paper (arXiv 2509.09840) found more psychological ownership did not improve comprehension.
- **Overlap is substantial** (see 8.3). The wedge is human-owned tiering, commit-before-reveal with a peek log, and tried-and-failed records with reasons. Consider whether a Nimbalyst fork plus a skill gets there faster.
- **Scope creep** (branches, graph, quizzes, Codex parity, retro mode) is the biggest threat.

### 8.3 Observations: existing tools to learn from or merge

(Verified from repos/docs on 2026-11-05/06 unless marked unverified.)

| Tool | What it does | License / notes |
|---|---|---|
| **Plannotator** (backnotprop/plannotator) | Local browser review surface for agents (Claude Code, Codex, others); markdown annotation, Obsidian-style backlinks, hooks, an **Inbox** where agents leave questions you answer | ~9.9k stars; Apache-2.0 or MIT; was BSL-1.1 until Feb 2026, **pin versions** |
| **Nimbalyst Wiki** (nimbalyst/nimbalyst-wiki) | Agent-written markdown wiki of decisions and rejected options, `capture`/`recall` skills, SessionStart hook, Claude Code + Codex plugins | MIT. Its `FORMAT.md` has an inline decision-span idea worth copying |
| **repowise** (repowise-dev/repowise) | Mines decisions from ADRs, comments, commits/PRs; injects "governed by" notice on edits | **AGPL-3.0**, ~8.1k stars; study only, do not embed |
| **Matt Pocock skills** (mattpocock/skills) | `grill-me`, `grill-with-docs` (writes glossary + ADRs behind a 3-gate rule), `wayfinder`, `to-questionnaire` | MIT; ships Codex metadata |
| **Riddled** (riddled.ai) | Hosted notebook where AI comments in the margin ("thinks with you"/ask modes, draws) | Closed source; study UX only |
| **CodeMirror 6** | Editor | Verify exact license |
| **log4brains** | ADR static site | Apache-2.0; **stale (last commit Dec 2024)**, don't depend on it |
| **Basic Memory** | Markdown memory MCP | AGPL-3.0; study only |
| **force-graph** | Canvas graph lib for later | MIT |
| **Agent Memory Atlas** | Catalog of open-source agent memory systems | Site only; skim for patterns |

**Agent platform facts (check again before building):**
- Claude Code and Codex both follow the open Agent Skills standard; one `SKILL.md` can serve both. Claude: `.claude/skills/<name>/SKILL.md`. Codex: `.agents/skills`.
- Claude Code `PreToolUse` supports `additionalContext` and decisions `allow | deny | ask | defer`; Edit/Write inputs carry `file_path`.
- Codex has a real hook system (`PreToolUse`, `SessionStart`, `UserPromptSubmit`, etc.), but `PreToolUse` has **no `ask`**, edits arrive as `apply_patch` text (parse paths from `tool_input.command`), hooks need hash-based trust review, `additionalContext` is capped (~2,500 tokens by default).
- Nimbalyst's README says Codex does not run plugin hooks; current Codex docs say plugin-bundled hooks exist. **Conflict. Test on my Codex version.**
- Symlink `CLAUDE.md` to `AGENTS.md` (Plannotator and Pocock both do this).

**Other evidence notes:**
- Retrieval-practice effects are real in general (g ~0.5), but may shrink for complex material like decisions; treat quiz-lite as a hypothesis.
- An LLM ADR-violation study (arXiv 2602.07609) reached ~91% accuracy at best, weak on implicit/infrastructure decisions, so drift checks stay advisory.
- No evidence found on developer retention mechanics. Avoid streaks and counters.

---

## 9. Build order

### Weekend prototype (do this first, no UI)
**Review gate:** continue de-risking only until the current results have been reviewed. Do not start UI, the full decision schema, or MCP implementation. Ten real notebook paragraphs produced provisional grades of 5 useful (including one correct abstention), 5 generic, 0 wrong; only 1/4 expected quiet cases abstained and only 6/10 notes passed the full citation/output delivery contract. The margin feature is not ready for the MVP. See NOTES.md for evidence, limitations, and remaining blockers.

1. Hand-write 10-15 decision files in one real repo of mine, including 3-4 dead ideas with reasons.
2. Write the `PreToolUse` hook (~80 lines): match edit paths, print matching decisions as `additionalContext`. Add the `SessionStart` digest.
3. Use it for real work for two days. Measure:
   - Did the agent avoid a dead idea or cite a decision? (count)
   - How often was an injection irrelevant? (count)
   - Hook latency.
4. Optional Sunday: tiny local page (one decision per screen, keys 1/2/3, Tab, Enter, `d`) served by a ~150-line server that writes the markdown, plus a `propose` CLI.

**Success:** resurfacing prevented at least a couple of real re-suggestions, startup under 2s, and I didn't turn it off.
**Failure:** noisy or irrelevant injections, or I disabled it. Then reconsider: a thin skill on top of Nimbalyst may beat a new product.

### v1
- Decision files + CLI/MCP, `PreToolUse` resurfacing, `SessionStart` digest, tiering with one-key override.
- Decisions list view (status and path filters), card UI with commit-before-reveal and logged peek.
- Strike-through parser, fork-from-here. Claude Code first; Codex via skills + AGENTS.md, hooks after testing.

### v1.5
- Learn branches with human-written takeaway merge and quick-merge escape hatches.
- Margin AI in ask-only mode; diagrams (Mermaid-style) rendered in the margin.

### v2
- Retroactive mining skill, weekly summary, quiz-lite (opt-in), git/PR links, advisory drift checks, optional graph.

---

## 10. Open questions (`TODO(me)`: I decide, Claude proposes options)

- [ ] Project name and one-line pitch.
- [ ] License for my project (must stay compatible with anything I reuse; avoid AGPL code).
- [ ] Node vs Bun vs compiled binary for hooks (benchmark first).
- [ ] Build from scratch vs fork/extend Nimbalyst Wiki.
- [ ] Default tier rules and the sensitive-paths file format.
- [ ] How aggressive is "aggressive" by default, and what is the per-user dial?
- [ ] Which repo do I dogfood on for the weekend prototype?
- [ ] Learn-branch merge: how much AI summary is shown, and when?
- [ ] Codex parity: when to attempt hooks vs staying with skills + MCP.

---

## 11. Definition of done for "it's working"

A week after making a decision, without the tool open, I can explain and defend it. If I just clicked through, this has become a worse Plannotator and the design needs to change.

## 12. Verified de-risking status (2026-11-06)

- **Transcript storage and freshness:** both VS Code extensions use session files accessible through the installed CLIs. New Codex requests/replies and a user-sent marker in Claude's third turn were visible while the extension backends were running. This establishes visibility, not a measured append-latency SLA.
- **Reader stress tests:** streamed the three largest local files by bytes for each provider. Largest Claude: 563,044,148 bytes, 48,004 records, 252 visible user-led turns, 6.38s with tracemalloc, 5.33MiB peak traced Python allocation. Largest Codex: 108,092,132 bytes, 4,338 records, 50 visible user-led turns, 0.45s, 65.58MiB peak (large individual JSON records). Ten tail turns retained for each. These are history-scan measurements, not hook latency or total process RSS.
- **Identity:** actual repositories had up to 71 Claude and 59 Codex competing top-level session files. Explicit older-session selection was verified for both. Newest modification time is a documented heuristic, not proof of which conversation the user intends.
- **Compaction:** summaries/replacement histories are counted and excluded from human turns. The reader exposes malformed, incomplete, oversized, invalid-encoding, and clipped-text diagnostics. It reads historical visible log messages; arbitrary branch reconstruction and exact post-compaction model context remain unverified.
- **Margin evidence:** ten tool-free, nonpersistent Claude calls used real notebook passages only; private transcript contents stayed local. Sonnet 5 generated the notes; CLI model usage also reported Haiku 4.5. Latency was 7.20s median / 9.87s nearest-rank p95, one sample per case. All supplied quote strings and IDs checked out, but four notes lacked required bracketed citations. Zero confirmed fabricated project facts is a limited observation, not a reliability guarantee. Two speculative question alternatives were unsupported; general-knowledge/hypothesis labeling remains insufficiently exercised.
- **Remaining blockers:** human review of provisional grades and the Windows budget; over-intervention on settled text; reliable citation delivery; notebook context selection; repeated sampling; general-knowledge versus hypothesis calibration; linked-transcript margin quality under a local-data constraint; corpus-scale hook performance and dispatcher overhead.
- **Privacy:** raw sessions, parsed excerpts, inventories, model inputs/outputs and detailed local evaluation evidence live under ignored `spike/results/`. Do not add these to Git. No private transcript text was sent to a model during this evaluation.
