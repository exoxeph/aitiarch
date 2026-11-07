# Anchoring holdout cases

Place your ten cases here as separate `.json` files. This folder starts with no
cases; the randomized stress test and existing fixtures do not read it. After
you add them, run this from `ui/`:

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

These cases are yours. Once added, they are an evaluation set; the anchoring
rules will not be tuned against their contents.
