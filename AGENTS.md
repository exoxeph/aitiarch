# AGENTS.md

Rules for any AI agent working in this repository. They come from the owner and apply to every task. If a task seems to
need breaking one, stop and ask.

## Hard rules

1. **No live provider calls without approval.** Never call Claude, ChatGPT-plan, Codex or any other provider from tests,
   checks, scripts or the app while developing. Use the fake providers. A real call needs the owner's explicit approval
   for that call.
2. **Never touch the real `notebook.md`.** The owner's notebooks (including the trial notebook under
   `C:\Users\UseR\Documents\aitiarch-trial`) are theirs. Copy fixtures into a temp folder; never edit the originals.
3. **Markdown on disk stays byte-exact.** No normalising line endings, BOM, trailing newlines or whitespace. CRLF and BOM
   must round-trip. Rendering is display only: decorations never dispatch document changes. Edits come only from explicit
   user commands (typing, toolbar, slash menu, shortcuts, checkbox click) and only insert or replace plain Markdown text.
4. **AI never writes the takeaway, the "why", or a failed reason.** Those are the human's. The takeaway region, reveal
   logic, ink anchors, threads, orphans and the ledger do not change behaviour without approval.
5. **Transcripts never go in the repo.** No session transcripts, chat logs, prompts with private content or provider
   responses, in files, fixtures, commits or docs.
6. **Protected untracked files stay untouched and untracked:** `CLEANUP-*.md`, `docs/provider-hardening-plan.md`,
   `prototype/`, `spike/`, and the holdout ZIPs under `ui/test/anchoring-holdout/`. Do not edit, move, delete, stage or
   commit them. Also leave `AITIARCH-UI-SPEC.md` and `BRIEF.md` unedited.
7. **Stage explicit file paths only.** `git add <file> <file>`; never a directory, `git add .`, `-A` or `ui/test`
   wholesale. Run `git status --short` before every commit and check that nothing protected is staged.
8. **No merge and no push without approval.** Work on the current feature branch with small commits.

## Working notes

- Keep CodeMirror 6. Do not introduce ProseMirror, Tiptap, Lexical or any HTML-round-trip editor.
- A new dependency needs a licence, size and maintenance check, reported to the owner. No network fonts or CDN assets.
- Keep the Grove tokens (light and dark), WCAG AA contrast, and `prefers-reduced-motion`.
- Windows is first-class. Prefer PowerShell; Git Bash writes `bash.exe.stackdump` files (git-ignored).
- Do not run `git reflog expire` or `git gc` unless told to (see `docs/editor-notes.md`, "Before any push").
- Browser checks live in `ui/check/` and need `BATCH2A_OUTPUT` (or `GROVE_OUTPUT`) set to a folder outside the repo.
- Never remove a git worktree that contains a junction or symlink into `node_modules`; it can empty the real folder.
