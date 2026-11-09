# Invoked diagrams implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Optional, strictly validated invoked diagrams, local rendering, explicit recoverable insertion.
**Architecture:** Shared JSON validator and escaped SVG serializer; lazy browser ELK/layout/view; server intent journal for asset/ledger recovery.
**Tech Stack:** Existing TypeScript, CodeMirror, React, Vite, elkjs 0.12.1; no new dependency.
**Spec:** docs/diagrams-contract.md

## Global constraints
No provider calls; synthetic fixtures only; preserve Markdown bytes, anchors and human-owned fields; explicit staging on design-d3; protected files untouched; no push. Follow AGENTS.md.

## Review focus
- Invalid optional diagram must not reject a valid text answer.
- Layout is not an untrusted route for arbitrary SVG or filesystem paths.
- Ledger failure after insertion must survive reload without duplicate insertion.
- Diagram/ELK stays lazy and is shared with Mermaid.
- Narrow widgets must dispose asynchronously loaded controls on destruction.

## Tasks
1. [x] Write and observe failing validator/prompt/provider tests. Implement shared diagram JSON contract; optional accepted diagrams through both providers, assistance, threads, sidecar. Run focused tests/typecheck; commit explicit paths.
2. [x] Write failing layout/serializer/browser gates. Implement lazy measured ELK layouts and explicit sequence/comparison layouts, one SVG serializer, accessible blob controls, larger view, export. Measure bundle graph and runtime deduplication. Commit explicit paths after tests.
3. [x] Write failing intent/asset/ledger recovery and BOM/CRLF insertion/undo tests. Implement confined assets, durable intents, preview/prepare/complete/reconcile endpoints, normal editor insertion and persistent repair notice. Run tests; commit explicit paths.
4. [x] Add 12-case fake fixture set and three hand-built references to browser gate; run full unit, native, typecheck, holdout and existing browser gates with repository-local disposable roots and external screenshot destinations. Record results, limits and bundle deltas. No live calls.

## Verification record
- Baseline: b69a1a6. Approved contract matches prompt C; browser-side lazy ELK approved separately. No scope deviation requiring another design stop.
- Interfaces checked: provider optional diagram -> product validator -> ink/thread validators; browser geometry -> server serializer -> SVG asset; prepare intent -> editor compare/write -> idempotent ledger. Unknown diagram fields discard only the optional diagram.
- Validator/provider tests failed before implementation, then passed. A grouped-edge coordinate regression failed before applying ELK container offsets, then passed.
- Final fresh review found a dead-owner journal lock, false duplicate-insertion provenance and a larger-dialog lifecycle leak. Each received a regression observed failing, then passing. Full suite after fixes: 886 passed, one optional skip; typecheck, native 43 modules, held-out mapping 13/13.
- Browser diagram gate and editor-gates, threads, phase1, ink-mapping, ink-layout, invoked, thoughts passed. Fake providers only. Results: docs/diagrams-check.md.
- Ruling: when a diagram source widget is destroyed (including responsive replacement), close its larger modal and dispose its observers; user can reopen from the new widget. This prevents detached note controls; cost is an extra reopen after resizing.
- No new dependencies, live calls, notebook edits, merges or pushes. Protected untracked files remain untouched.
