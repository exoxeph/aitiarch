# Product response validation and offline replay

This audit records the checks present at `788ccaa`, before instrumentation. No acceptance rule, prompt, event allowlist, mapping rule or provider flag changes in this slice. No live call ran. Ask remains unverified and Slice B stays paused.

## Existing checks

Provider output is parsed with the approved single-fence decoder, serialized, redacted and parsed again. `response_schema` requires a string `answer` and an array `claims`; it does not reject additional JSON keys. Production and replay share `validateProviderResponse` and `validateProductResult` rather than maintaining separate validators.

| Fixed rule | Existing source at audit baseline | Requirement | Plausible with a normal 2,100-character answer and a few claims? |
| --- | --- | --- | --- |
| `response_schema` | `ui/server/providers/index.ts:135` | String `answer`, array `claims`. | Yes: missing, renamed or mistyped fields. Already passed on the last call. |
| `result_id` | `ui/server/assistance.ts:80` | ID equals frozen request ID. | Unlikely: the adapter supplies it. |
| `result_provider` | `ui/server/assistance.ts:80` | Provider equals `claude`. | Unlikely: the adapter supplies it. |
| `answer_type` | `ui/server/assistance.ts:80` | Answer is a string. | Unlikely after the provider check. |
| `answer_empty` | `ui/server/assistance.ts:80` | Answer has non-whitespace text. | No for a substantive answer. |
| `answer_length` | `ui/server/assistance.ts:81` | At most 100,000 UTF-16 string units, before product-layer redaction. | No at this length. |
| `claims_array` | `ui/server/assistance.ts:81` | Claims form an array. | Unlikely after the provider check. |
| `claims_count` | `ui/server/assistance.ts:81` | At most 32 claims. | No with only a few claims. |
| `model` | `ui/server/assistance.ts:82` | Null or a string matching `^[\w.:-]{1,100}$`. | Possible if a returned identifier has a space or another unsupported character. |
| `claim_source` | `ui/server/assistance.ts:86` | Claim resolves to nonempty frozen source text. `N1` is the note; other IDs must match supplied decisions. Product requests supply no decisions. | Yes: missing/misnamed `sourceId`, or an invented ID. |
| `claim_quote_type` | `ui/server/assistance.ts:87` | Claim's `quote` is a string. | Yes: the prompt says “an exact quotation” without explicitly naming the `quote` key. |
| `claim_quote_empty` | `ui/server/assistance.ts:87` | Quote contains non-whitespace text. | Possible. |
| `claim_quote_length` | `ui/server/assistance.ts:87` | Quote is at most 240 UTF-16 string units. | Yes: a reasonable paragraph citation can exceed this. |
| `claim_quote_exact` | `ui/server/assistance.ts:87` | Quote appears verbatim in its frozen, redacted source. | Yes: paraphrases, ellipses, punctuation and newline changes fail. Matching the selection specifically is not required. |
| `product_processing` | `ui/server/assistance.ts:90` | Fallback classification for an unexpected processing exception, not an extra acceptance rule. | Possible, but unproven. |
| `ink_persist` | `ui/shared/ink.ts:45`, `ui/server/ink-store.ts:99` | Existing schema, size, attachment and concurrency checks; fallback classification for persistence failure. | Possible from storage/mapping state, but produces `persistence_error`, not the observed `error`. |

Leading hypotheses: exact quotation mismatch; missing/misnamed claim keys or unknown source; a quote over 240 characters; model identifier. There is insufficient evidence to select a cause. Nothing here relaxes a rule or changes the prompt.

There are no separate exact-key or object-shape checks on individual model claims. The application reads `sourceId` and `quote` and constructs the stored evidence itself. Extra model fields, including takeaway/why/failed-reason fields, are not checked by the model-response validator or copied into ink. The prompt forbids generating those fields and the user's human-owned content; there is no semantic scanner that proves an answer body obeys that instruction.

Source references use the frozen redacted note, not the note after a user edit. The product redacts the answer again before storing it. A missing/deleted/ambiguous anchor preserves an answer as an orphan; it does not reject the answer.

Stream isolation is an earlier gate (`ui/server/providers/claude-canary.ts:45`): exactly one init, explicit empty tool/MCP/plugin arrays, no hook/tool attempts or unknown events, assistant text present, exactly one successful non-error result and no created files. The parser does not require the result to be the last event. The provider also checks `is_error` truthiness. These event checks and their allowlists remain unchanged.

### Persistence checks covered by `ink_persist`

These checks remain in the existing ink store, not duplicated in the offline answer validator:

- Exact v2 document keys, matching note path, null-or-SHA256 note version/text hash, at most 1,000 items.
- Exact item keys; unique 1–100-character ASCII IDs; answer/margin kind; string body up to 100,000 string units.
- Exact generation keys; matching request/item ID; Think/Ask action; Claude provider; model identifier; parseable creation timestamp; Boolean dismissed; known status; up to 32 evidence entries.
- Exact evidence keys; `N1` or `D1`–`D8` source ID; SHA256 source hash; string quote up to 240 units.
- Up to 100 historical anchors; exact anchor and position keys; valid quote/context/count/position values through `validateAnchor`.
- Attached ranges agree with anchor positions; orphan status has an allowed reason. Every attached quote must equal the current note slice.
- Sidecar up to 8 MiB; confined, unlinked paths; valid note encoding/size; exclusive lock; matching ink/note versions and text hash; concurrency recheck before atomic replacement.

An ink persistence rejection keeps the existing save-only retry behavior. Its diagnostic does not claim which nested storage check failed; replay cannot diagnose filesystem state or mapping from a raw model result alone.

## Private diagnostics

Product rejections append to the user's private `Aitiarch/metrics/product-validation-failures.jsonl`, alongside the existing provider metrics, outside both the repository and any `.aitiarch` root. A schema rejection also appears as `productValidation` in provider failure metadata. Each product record contains only a fixed `rule` enum and numeric `counts`: `answerLength`, `claimsCount`, `modelLength`, `claimIndex`, `quoteLength`, `sourceIdLength` and `sourceLength`. `-1` means unavailable or not applicable. The claim index is zero-based. Lengths use JavaScript UTF-16 units. No request IDs, source IDs, model names, quotes, answers, paths, prompts, transcripts or exception text enter the record. Diagnostic write failures do not change response acceptance or persistence behavior.

## Test-only offline replay

Node 24 or later, no provider process or network call:

```powershell
node ui/test/replay-product.mjs --result "$env:TEMP\aitiarch-private-replay\result.txt" --context "$env:TEMP\aitiarch-private-replay\context.json"
```

Both paths must be absolute and outside the repository, including canonical targets reached through links/junctions. Both are checked before either file is read. Linked files with multiple hard links and files larger than 1 MiB are refused. The script only reads the supplied files; it never discovers a notebook, captures a result, writes diagnostics or deletes evidence.

`result.txt` contains the exact result string from the CLI's final result event, including any outer fence. It is not the whole event stream. A separate external JSON context supplies `expectedId`, `resultId`, `provider`, `model`, `note` and `decisions` (objects with `id` and `text`). Capture these from the actual request/result metadata; `note` and decisions must be the exact frozen redacted sources sent to the provider. Do not reconstruct them from a subsequently edited note or guess a missing model value. There is no selection-only quotation check, so a selection is unnecessary for replay.

The script prints JSON lines with only fixed rule names and pass/fail booleans for checks actually reached. It stops at the first failure, exits nonzero on failure and zero on success. `response_format`, `replay_path` and `replay_context` identify decoding or harness-input failures, not additional product acceptance rules. Successful replay covers response validation only, not stream isolation, filesystem persistence or mapping. It neither fixes nor deletes the capture.

## Proposed next live call — approval required

One Think request only, using the same synthetic cache note and frozen selection, same product path and unchanged isolation flags. Run metadata-only capability preflight first; inspect the call's event/file isolation checks; stop on failure without retry. No Ask or Slice B work.

Use a disposable directory outside the repository. For this explicitly approved diagnostic capture only, retain the exact final result string plus the frozen redacted sources and actual result metadata needed by replay in a private temp subfolder. Do not retain the full event stream, session IDs, transcript or credentials. Do not print raw content. Keep these replay files until the user explicitly asks to delete them; remove disposable execution/note fixtures separately. No capture code or live call is added or run in this commit.

Expected usage: approximately **6,000 input and 1,500 output tokens**, including CLI overhead as an estimate, not a guarantee. Report actual returned usage and wall-clock time. After approval and capture, replay offline as needed, identify the first failed rule, then propose whether its rule or prompt should change. Do not apply that fix without approval.
