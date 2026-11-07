# Proposed anchor mapping through live sync

Status: approved with the user's snapshot/v2 changes and implemented on
`phase-2`. The context-margin experiment remains on its own branch.

## Mapping an open note

Use the actual CodeMirror transaction that changes the displayed note. For an
external edit, Phase 1 already computes `diffText(base.text, theirs.text)` and
turns those hunks into a `ChangeSet` in `NoteSession.mergeExternal`. Give ink
that same change set, together with its source text/hash. During a merge with
unsaved browser edits, use the rebased change set actually dispatched to the
editor, rather than applying disk offsets directly to the local draft.

Map each attached range once, in the ink state field, and use that single
result for inline ink, the margin and the orphan list. Map the start after an
insertion at its boundary and the end before an insertion at its boundary;
inserting inside the range extends it. Preserve a small edit inside the range
and recapture its current quote/context. A deleted range becomes an orphan;
a replacement of the whole range requires search or human review. A move
represented as deletion plus insertion can recover through an unambiguous
quote/context search. Never map an already orphaned selector as if its old
offsets belonged to the current text.

Before mapping, require the source hash and old range text to match the ink's
last-seen state. After mapping, verify the result against the new document.
Keep `originalAnchor`, manual `anchorHistory`, item IDs and bodies intact.
Update the current anchor and attachment together. Pause sidecar checkpointing
during conflicts; save against the resolved note and sidecar versions using
the existing compare-and-replace checks. A race leaves the old sidecar intact.
Keep draft mappings in memory until the Markdown save succeeds; checkpoint
the ink snapshot matching that acknowledged note version, while any newer
draft mappings remain in memory.

## Browser edits, Claude Code Edit, and ambiguity

Browser typing supplies an exact transaction, including whether an insertion
was before or after a selection. Use it directly. Claude Code's Edit reaches
Aitiarch as a changed file; while the note is open, use the retained old text
and Phase 1's external change set. The file watcher does not receive Claude's
structured edit operation, so it cannot infer that operation's intent.

A deterministic LCS tie-break is not proof of paragraph identity. Add an ink
ambiguity check alongside the existing hunks, without changing how Phase 1
edits the document. If equally valid alignments map the anchor to different
copies, orphan it and offer candidate locations. An identical copy inserted
directly beside the original is ambiguous for an external text-only diff;
the browser's explicit insertion transaction can identify the original.
Treat ambiguous character alignment and the diff's large-input replacement
fallback the same way. Position cannot settle an ambiguous alignment.

## Reopen and search fallback

Retain normalized previous text both in memory and in a private per-note
snapshot under `<root>/.cache/anchors/<sha256(relative-note-path)>.json`.
The snapshot stores `v: 1` (cache schema), `note`, `textHash` and full `text`.
Require its SHA-256 to match both its contents and the v2 ink document's
`lastSeenTextHash` before using it. Missing, malformed or mismatching snapshots
fall back to strict search. The sidecar is replaced before its snapshot; a
crash between them safely produces a hash mismatch rather than a wrong mapping.

Approved ignore line: `/.cache/` in `<root>/.gitignore`. The UI displays a
one-time notice with that exact line and file. Only its explicit setup button
writes the ignore file, merging with existing bytes and rules. Persistence
stays disabled until the folder is ignored. Git checks ignore status inside
repositories; temporary fixtures use an explicit ignore file. Linked cache
paths are rejected. Snapshots stay hidden from the note tree.

Use quote/context search in that situation. A quote unique at capture and
still occurring exactly once must attach. Originally repeated quotes are
orphaned: the margin experiment is not merged. Newly duplicated quotes without reliable mapping
remain orphaned when identity is uncertain. Similar text alone is a candidate
for human review, not proof that a deleted paragraph survived as an edit.
Keep every orphan and its candidate choices. Closed-app edits can use the
verified persisted snapshot, with the same ambiguity checks as live file edits.

## Ink format and migration

Propose ink format `v: 2` with one new document field:
`lastSeenTextHash: string | null`, a lowercase SHA-256 of UTF-8 encoded editor
text after BOM removal and LF normalization. Keep `noteVersion` as the existing
raw-byte hash for writes; CRLF/BOM changes can alter it without changing the
text hash. Attached ranges refer to the document identified by this hash;
orphan selectors may retain older provenance and are never blindly mapped.
Keep the existing item fields and stable, pretty-printed key order.

No real v1 sidecars were found. Read and write v2 only; reject v1 and future
schemas without modifying them. There is no migration or v1 reader. Keep the
existing note/sidecar version checks and atomic replacement. No operation
writes Markdown or adds IDs to it.

## Tests before implementation

Add failing tests for browser and external inserts before/after/inside a range;
small internal edits; deletion versus a similar surviving decoy; moves and
nonadjacent copies; adjacent identical copies with competing alignments; and
UTF-16 emoji boundaries. Test local/remote merges, conflicts and save races;
reload with equal/different/missing hashes; v1 rejection without migration; mixed
line endings/BOM; all orphan items retained; and unchanged Markdown bytes.
Run both seeded mixes and the 30-case set. Evaluate the human holdouts only
after the implementation is frozen; never change rules to fit those cases.
