# Aitiarch UI — Phase 1 (shell and editor)

A local web notebook over plain markdown files. Your `.md` files are the only source of truth: the editor
never reformats your text, and line endings and BOM are written back byte-for-byte.

Needs Node 24+. Source lives here; **notes never do** — they stay in each project's `.aitiarch/` folder.

## Run it

```powershell
cd ui
npm install
npm run build                      # once (the built bundle is not committed yet)

# then, inside the project you want to open (it must contain a .aitiarch folder):
node <aitiarch-source>\ui\server\main.ts                          # default root: .\.aitiarch
node <aitiarch-source>\ui\server\main.ts --root <project>\.aitiarch   # any other folder
```

The server listens on `127.0.0.1` only, on a port derived from the notebook path (same project → same
address). Options: `--port N` (0 = any free port), `--no-open`. `npm run dev` runs Vite with hot reload
against the same server (`npm run dev -- --root <folder>`).

## Check Phase 1 yourself

**Automated** (real Edge/Chrome, separate-process edits, throw-away fixture notebooks in your temp folder):

```powershell
cd ui
npm run check:phase1
```

It types in one paragraph while another process edits a different paragraph, and fails unless your text
and cursor survive, the outside edit shows up in the editor within 1000 ms, and the bytes on disk are
exactly right (LF, and CRLF + BOM). It also checks the same-paragraph conflict flow, that opening a note
changes nothing on disk, and that a note with mixed line endings keeps every byte outside your edit.
Screenshots and a JSON report go to `check/out/`.

**By hand:**

```powershell
cd ui
npm run build
npm run fixture                    # practice notebook in check/manual/ + the app, on port 43999
```

1. In the browser, click at the **end of the “Alpha” paragraph** and keep typing slowly.
2. In a second terminal, while you type: `node check/external-edit.mjs`
3. The “Charlie” paragraph changes within a second; your cursor and text don't move.
4. To see a conflict: edit the Alpha paragraph from the terminal instead
   (`node check/external-edit.mjs check/manual/.aitiarch/check.md "Alpha paragraph"`). A marker appears with
   *Keep mine / Take theirs / View both*, and autosave pauses until you choose.

## Tests

`npm test` (unit + HTTP + the real server process), `npm run typecheck`.

## How saving and live sync work

- Autosave after ~500 ms of no typing. Every save is a **compare-and-write** against the file version the
  editor last saw: if the file changed on disk, the save is refused and the change is merged first.
- An outside change is diffed against the last version the editor saw and applied as a minimal edit
  *underneath* your unsaved typing, so your cursor and text stay put. If it lands in a paragraph you're also
  editing, that paragraph gets a conflict marker and saving pauses. Nothing is overwritten until you choose.
- Honest limit: no filesystem offers an atomic compare-and-swap. The server re-checks right before the
  atomic rename and verifies right after, which makes the race window tiny but not zero.
- Watching = `fs.watch` for speed **plus** a 250 ms stat-poll fallback (Windows editors that save by rename,
  network drives, missed events).

## Security model (this process can write to your notes)

Loopback only · Host and Origin checks (DNS-rebinding / cross-site) · per-launch cookie token +
`X-Aitiarch` header + JSON content-type on every write · paths confined to the notebook root (junctions and
symlinks that escape are refused) · `runs/`, `measurements/`, `backups/` are never listed or served ·
strict Content-Security-Policy (no inline scripts, no remote loads) · Mermaid at `securityLevel: strict`
plus DOMPurify · links open only for `http(s)`/`mailto`.

## What's in Phase 1 — and what isn't

In: file tree, tabs (restored from `ui-state.json` inside the notebook folder), CodeMirror 6 live preview
(headings, emphasis, lists, code, links, `[[wikilinks]]`, frontmatter, Mermaid, `~~text~~ {failed: reason}`),
format toolbar with **S = failed** (reason is yours; “Don't know yet” writes `{failed: ?}`), read-only
Properties panel, Ctrl+P commands, Ctrl+O quick switcher, live sync.

Phase 2a now adds inline ink, the margin rail, orphan review and explicitly requested Claude answers.
Anchors live only in JSON sidecars; no ids are added to Markdown. Threads, decision cards,
branches, track changes and outline/backlinks remain later work. Wikilinks never create files.

## Later

- Decide which parts of `.aitiarch/` a normal user commits (notebook, decisions) versus ignores (usage,
  runs, measurements, backups, `ui-state.json`).
- Decide how the built bundle ships (not committed for now).

## Invoked AI (Slice A)

Aitiarch calls your own Claude CLI and never handles Claude credentials. Codex is disabled.
The optional ChatGPT plan provider stores ChatGPT tokens in a protected local
file outside the repo and notebook root; it is disabled unless `--chatgpt-plan`
is supplied. See [the fake-server implementation and approval stops](../docs/chatgpt-plan-provider.md).
The policy on third-party use of Claude plan logins is unsettled; a working
integration does not establish permission under a subscription agreement.
See [the approved Task 3 design](../docs/phase2a-task3-design.md) and
[Slice A checks and live-check approval boundary](../docs/phase2a-task3-product-check.md).

After building, configure an absolute native executable with
`node server/main.ts --root <disposable-project>/.aitiarch --claude <absolute-claude-executable> --no-open`.
Configuration checks version/help only; it makes no model call. Select text and use **Think on this**
(Ctrl/Cmd+Enter) or **Ask...**. Review the frozen, redacted packet, then explicitly **Send to Claude**.
Do not perform the live fixture check until separately approved. No automatic requests run.

`npm run check:invoked` builds the UI and exercises it in Edge against an injected fake provider,
using only an OS-temp synthetic fixture. It never discovers an installed provider. Screenshots
in `check/out/` are generated, ignored review artifacts. `npm test` includes the held-out mapping gate.
