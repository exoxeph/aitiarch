# Editor interaction pass implementation plan

> Execute inline with Superpowers test-driven development and verification before completion.

Goal: complete the user's compact selection panel, code editing and searchable Markdown insertion menu, preserving the Word-style navigation gates.

Architecture: retain CodeMirror and its unchanged source document. Pure placement and code transaction helpers feed scoped view extensions. Reuse the existing autocomplete listbox and formatting commands. No provider, ink, ledger or owned-field changes.

Constraints: design-d3 only; fake providers; synthetic fixtures; BOM/CRLF byte identity; explicit staging; no cleanup outside the repository; no new dependencies; no push. Screenshots outside the repository.

## 1. Compact selection panel

- [ ] Test placement: right, left, below; viewport edges and occupied margin cards.
- [ ] Replace the one-row tooltip with grouped controls; every control has an accessible name and tooltip. Preserve frozen selection and human-only failed-reason input.
- [ ] Keep the narrow fallback in a reserved dock below the editor, rather than covering the next paragraph. Maintain roving keyboard access and Escape return.
- [ ] Real-pointer checks and existing navigation/ink-layout regressions; commit.

## 2. Code editing

- [ ] Failing tests for always-hidden fences, scoped indent/outdent, indent-preserving Enter, bracket/quote pairs, empty removal, exit and Escape/Tab focus escape.
- [ ] Implement transactions only for explicit keyboard commands inside code bodies. Keep header language and Copy; hint explains focus escape.
- [ ] Measure existing lazy highlighting. Limit optional highlighting to the requested language set and omit additions exceeding 40 KB gzip.
- [ ] Test byte-exact undo and real keyboard input; commit.

## 3. Markdown menu and final verification

- [ ] Failing tests for groups, names, descriptions, shortcuts, synonyms and plain Markdown insertions. Preserve no-match/path/Escape behavior.
- [ ] Render accessible icons, groups and descriptions through the existing completion listbox; keyboard arrows, Home/End, Ctrl+arrows and active descendant.
- [ ] Update affected browser expectations and add real-key/pointer gates. Run full units, typecheck, native load, held-out anchoring and all browser suites.
- [ ] Document unsupported Word formatting and the code focus escape; commit.

Review risks: selection geometry during double-click; long selections and narrow screens; incomplete code fences and multi-range selections; Enter before autocomplete opens; keyboard focus leaving code; save/undo byte identity. Tests use synthetic notes and fake providers only.
