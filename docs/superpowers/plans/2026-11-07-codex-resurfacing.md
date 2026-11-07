# Codex advisory resurfacing implementation plan

**Spec:** The user's Codex Integration and Resurfacing Test request (2026-11-07).
**Goal:** Reuse accepted Markdown decisions for repository-local Codex apply_patch hooks.
**Architecture:** Share the existing bounded exact-record lookup; add one patch-input adapter and a local installer. No model, transcript, permission, or decision-writing code in hooks.

- [x] Add regression tests first: multi-file add/update/delete/move, Windows and absolute paths, malformed input, containment, accepted matching, advisory-only output, installation preservation.
- [x] Refactor existing lookup without changing Claude behavior; implement the Codex adapter and repository-local hooks.json installer.
- [x] Run prototype and frozen regression suites; benchmark fresh process launch and lookup separately.
- [x] Inspect installed runtime hook discovery/trust. User approved original then corrected Windows definition manually. Initial CLI edit did not run hooks; app-server diagnostic exposed PowerShell launch failure. Fixed documented Windows override, tested it, and verified recovery via native no-op patch. All attempts preserved, one persistent edit retained.
- [x] Verify source/decision/config hashes, site checks, document delivery versus compliance and independent VS Code fresh-session instructions.

Constraints: preserve all existing work and accepted rationale; configuration only in the dogfood repository; logs/evidence local and ignored; proactive comments disabled; no UI/MCP/schema/product expansion or new prompt experiments.

Execution note: Aitiarch is not a Git checkout, so no worktree or commits. The dogfood tree contains pre-existing changes; hash before/after rather than reset or stage them.

Results: 26 prototype + 57 frozen tests pass; site 59/59 and Astro check pass (four existing hints). Final review found/fixed missing standalone private exclusions with a failing regression first; follow-up review found no new important defect. Runtime success 384ms, body 2.4966ms. Independent fresh VS Code UI test and human usefulness remain unverified. CLI exec hook coverage remains uncertain. See NOTES.md for failures and loaded-machine timing ranges.
