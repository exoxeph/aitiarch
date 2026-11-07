# Anchoring holdout cases

Place at least ten cases here as separate `.json` files. The randomized stress
test and existing fixtures do not read them. Run this from `ui/`:

```powershell
npm run test:holdout
```

Each JSON file has this shape:

```json
{
  "before": "First paragraph.\n\nSelected text.\n\nLast paragraph.",
  "from": 18,
  "to": 32,
  "after": "First paragraph.\n\nSelected text.\n\nLast paragraph.",
  "expected": { "from": 18, "to": 32 }
}
```

Use `"expected": null` when the ink must remain orphaned. `from` and `to`
are zero-based UTF-16 offsets in the `before` string; expected offsets refer
to `after`. Use `\n` line endings in JSON strings, as the editor normalizes
line endings before anchoring. The runner treats each file as a separate case
and reports its filename on failure.

`npm run test:holdout` gates the mapping path using both versions and exits
nonzero on any failure. It also runs in the regular test suite.
`npm run test:holdout:search` reports strict search using only the captured
selector and the new text, and always exits zero, including on malformed input
(reported as errors). Its expected misses remain cases 04, 06, 08, 11 and 13.
An optional `expectedMapping` overrides `expected` for mapping only; otherwise
both paths use `expected`. Neither case text nor expectations are relaxed.

These cases are yours. Once added, they are an evaluation set; the anchoring
rules will not be tuned against their contents.
