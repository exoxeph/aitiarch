# Local evidence archive

The complete pre-cleanup workspace was archived before any deletion. It contains
private transcripts and evaluation material. Keep it local and out of Git;
do not publish the archive, manifest or extracted evidence.

Archive directory:
`<private-archive>`

| File | Purpose |
|---|---|
| `aitiarch-before-cleanup.zip` | All 326 original files, original relative paths, and an embedded manifest. |
| `manifest.json` | Every original path, byte count, SHA-256 and audit category. |
| `inventory.csv` | Same per-file inventory in tabular form. |
| `verification.json` | Initial CRC, complete membership and hash verification. |

ZIP SHA-256:
`6615e22a58bb85d963979a5b2f8057dd6b7462cda31ed0a265d8cd920bf80467`

Manifest SHA-256:
`46c3ebd514ff36e714c76ceea2825e9af99ced71eb9ef9b5cadafd795d83f525`

The user's approval authorized removing the exact 252 evidence files listed in
[CLEANUP-AUDIT.md](CLEANUP-AUDIT.md) from `spike/results/` after verification.
Thirty disposable cache/scratch files were also archived before cleanup. All
original source, tests, fixtures, prompts, documentation and configuration were
byte-identical at cleanup. BRIEF.md, NOTES.md and the MVP proposal were not
rewritten during cleanup. Later approved status annotations do not alter their
immutable originals inside the ZIP.

## Reference mapping

Every historical reference beginning `spike/results/` in the original documents
maps to the **identical member path inside this ZIP**. In `spike/README.md`,
`results/...` resolves to that same `spike/results/...` prefix. These references
are archived references, not live checkout links. They are intentionally retained
in the unchanged historical documents. The manifest and the cleanup audit list
the individual members; directory references mean all members under that prefix.

| Evidence family | ZIP member prefix |
|---|---|
| Initial transcript, margin and hook probes, including failures | `spike/results/` top-level files |
| Large-session and live-message checks | `spike/results/reliability-v2/` |
| Original ten real paragraphs | `spike/results/margin-eval-v2/` |
| Earlier byte-exact ten-case preservation ZIP/manifest | `spike/results/preserved/` |
| Six-pair actual conversation-context experiment | `spike/results/paired-context-v1/` |
| Original/approved v3 proposals | `spike/results/intervention-v3-original-proposal/`, `spike/results/intervention-v3-proposal/` |
| Forty frozen outputs, prompts, usage, approval, blind packet/key and returned review ZIP | `spike/results/intervention-v3-run/` |
| Imported original reviewer bytes and unblinded analysis | `spike/results/intervention-v3-final-analysis/` |
| Offline validation replay, failures and code snapshots | `spike/results/intervention-v3-validation-replay/` |

Duplicate inputs, prompts, reports and code snapshots remain inside the archive:
their location records provenance even where their hashes match. Failed outputs,
denied initial hook probes and reviewer judgments were not selectively discarded.

## Restoration and verification

Use a fresh local directory outside the active project. Verify the ZIP hash
first, extract with an ordinary ZIP utility, then compare extracted files with
`manifest.json`. Preserve the archive and never extract private material into a
tracked repository. Extracted original paths support historical artifact readers;
do not rerun the model launchers or mutate frozen output folders.

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath '<private-archive>\aitiarch-before-cleanup.zip'
```

`verify_consolidation.py` in the external archive directory performs read-only
CRC/member/hash checks, compares retained original files against the manifest,
checks local Markdown file targets against live files or archived member paths,
and checks privacy ignore rules in a temporary Git repository using path strings
only. It never sends transcripts or calls a model. Its final machine-readable
report is `final-verification.json`; see [CLEANUP-VERIFICATION.md](CLEANUP-VERIFICATION.md).

On 2026-11-07, readability, ZIP/manifest hashes, all 326 archived files and 125
historical integrity entries were reverified before updating approval status.
This is ordinary persistent local storage, not a temporary directory; future
drive availability is not guaranteed. The cleanup-time verifier also expects
original active documents, so it will flag intentional later document edits.
Use the adjacent `verify_archive.py` to verify archive contents independently.
Pre-update documents are additionally preserved under
`<private-approval-archive>\`.

The archive is on the same G: drive. This is a verified relocation, not a
separate-device backup or a commitment to retain this absolute path forever.
Moving it later requires updating this index. All hashes remain portable.
