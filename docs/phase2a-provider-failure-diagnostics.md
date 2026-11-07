# Provider failure diagnostics and stream-format review

The help-recognition fix is committed separately as `f03d7b2`. This diagnostic
change was committed as `c536db3`. The later result-shape instrumentation and
recorded diagnostic below were committed as `5ce1ee7`. The subsequent approved
bounded fence normalization and subtype measurements below are uncommitted.
The system-event allowlist and isolation requirements remain unchanged.

## Private failure records

Failed `Provider.invoke` attempts append one JSON record to
`%USERPROFILE%/AppData/Local/Aitiarch/metrics/provider-failures.jsonl` on Windows
(`~/.config/Aitiarch/metrics/` elsewhere). Nothing is written beneath the
repository or a notebook's `.aitiarch` folder. Successful calls create no failure
log. Appends are serialized. Unsafe link targets are rejected; a write failure
keeps the provider failure and adds a plain notice that metrics could not be saved.

Only these fields are recorded:

| Field | Meaning |
| --- | --- |
| `exitCode`, `signal` | Process outcome, or null when unavailable |
| `stderrCategory` | `none`, `authentication`, `timeout`, `rate_limit`, or `other` |
| `stdoutBytes` | Total stdout bytes observed |
| `events` | Ordered `{type, subtype, count}` runs; consecutive equal names are counted together |
| `parseError` | First JSON error: stage (`event` or `result`), kind, line and UTF-16 offset within that line/result; null if absent |
| `finalResultPresent` | Whether a parsed final-result event was observed, including an error result |
| `wallMs` | Elapsed milliseconds through failure, including startup and termination |
| `usage` | Numeric usage counters, labeled by event, message or model source |
| `resultShape` | Booleans/numbers describing non-empty text, starting fence, whole-result JSON validity, answer/claims key presence, UTF-16 character length, first result parse error and an observation-only wrapped-object probe |
| `isolation` | Existing canary's registry/event counts and pass observation, plus file count; unknown counts are -1 |

Error kinds are `empty`, `unexpected_end`, and `syntax`; an unavailable offset is
null. Event names come from a finite vocabulary: arbitrary names become
`unknown`, so an unexpected type cannot smuggle private text into the log.
Unknown numeric usage keys become `unknown_1`, etc.; their values are retained,
but arbitrary keys and model names are discarded. Usage entries are observations,
not a total: final and per-message counters can overlap and must not be summed.

`resultShape.parseErrorKind` is numeric: 0 means none/not attempted, 1 empty,
2 unexpected end, 3 syntax. Its position is -1 when unavailable/not applicable.
Key-presence booleans concern the entire parsed result only; when JSON parsing
fails they are false, which does not establish whether a wrapped object has
those keys. `wrappedObjectJson` only checks whether the span from the first
opening brace to the last closing brace is a JSON object surrounded by other
text. It never supplies a value to the answer parser. A metadata-only callback
can observe successful or failed calls in memory; it cannot alter acceptance.

No messages, prompts, output excerpts, stderr text, exception text, session/turn
identifiers, request identifiers, model names or file names enter the record.
Raw buffers exist only in memory. The existing 256 KiB combined-output safety
limit remains; event/usage observations cover retained output, while byte counts
include discarded stdout chunks. The observer cannot recover malformed or
discarded events. Windows files inherit the user's configuration-directory ACL;
POSIX creation requests directory mode 0700 and file mode 0600.

Tests use synthetic fake CLIs and temporary logs only. Truncated JSON, unknown
event, hook event, empty result, non-zero exit and stderr-only failure all reject
and record metadata. Additional tests cover privacy, event ordering, numeric
usage, unknown parse offsets, forbidden destinations, successful calls producing
no log, and safe reporting of log-write failure.

## Official documentation findings

The official pages are rolling documentation, not a frozen 2.1.205 protocol
specification. Their full event inventory cannot be asserted for that installed
release. Existing captured 2.1.205 help verifies flag availability, not the exact
runtime stream. No new CLI invocation was used to fill that gap.

Print streaming is JSON Lines. Official streaming and hook-event examples use
`--verbose`; the product already passes it. Token deltas additionally require
`--include-partial-messages`, which the product does not request. The final line
is a result envelope; its `result` is text. Schema-constrained output uses
`--json-schema` and `structured_output`, not an implicit JSON guarantee for
`result`. In-run failures can be reported on stdout. Sources:
[programmatic print mode](https://code.claude.com/docs/en/headless#stream-responses)
and [structured output](https://code.claude.com/docs/en/headless#get-structured-output).

`--include-hook-events` adds lifecycle messages such as `system/hook_started`,
`system/hook_progress`, and `system/hook_response`. Some hook types lack start
events; empty observations do not prove no hook ran. The reference already
documents startup hook events without this flag. Source:
[CLI reference](https://code.claude.com/docs/en/cli-reference).

The SDK describes initialization, assistant, optional partial-stream, result,
status, retry and other event families. A success result includes `type`,
`subtype`, `is_error`, `result`, durations, turn count, usage, per-model usage,
identifiers and permission denials; structured output is optional. Error results
have error subtypes and error details rather than a required success answer.
Initialization carries `model`, tools/MCP/plugins, skills and slash commands.
Source: [message and result types](https://code.claude.com/docs/en/agent-sdk/typescript#sdkresultmessage).

## Comparison at the diagnostic baseline (`c536db3`)

| Finding | Current code and consequence |
| --- | --- |
| Extra JSON requirement | `parseResult` parses `result` again and requires `{answer, claims}`. Ordinary final prose or fenced JSON fails. Asking for JSON in a prompt is not a transport guarantee. `structured_output` is ignored and no schema flag is passed. |
| Narrow event vocabulary | `inspectClaudeCanary` accepts assistant/result/rate-limit/partial-stream and system/init, rejecting other events. Documented status, retry, auth-status, user and compaction events would fail. Some rejections are deliberate isolation controls; this is no approval to accept them. Exact availability in 2.1.205 remains unverified. |
| Model location | `parseResult` reads the model from the result envelope rather than initialization, so it can return null. |
| Partial usage | The product result keeps only top-level input/output counters. Cached and per-model usage are lost there. The new failure observer preserves numeric observations without changing that result. |
| Failure envelope handling | Non-zero exits are classified using stderr; error-result details on stdout are not mapped to specific product errors. They remain safely rejected with a generic message. |
| Final-event position | The parser finds one result anywhere; it does not require the result to be the last event. |
| Registry observation gap | The canary checks tools, MCP servers and plugins, but does not inspect initialization's skills or slash-command lists. Existing disabling flags remain required. |
| Hook proof limit | Hook-event rejection remains unchanged. Absence of events cannot prove that managed hooks/settings were absent. |

There is no verbose-flag mismatch, and lack of token-delta events is expected.
The extra JSON requirement and event rejection are possible explanations for the
earlier failure, not an established diagnosis: its missing metadata cannot be
reconstructed. No parser, event acceptance rule or isolation check was changed.

## Approved single diagnostic call

Run the metadata-only startup check first. Then make exactly one request through
the product provider path in an initially empty OS-temp directory outside the
repository. A synthetic note is created in a separate, initially empty disposable
fixture. Use the real Assistance Think request, with its frozen selection,
empty question and no transcript context; the product's existing JSON-answer
instruction remains in place. Use the exact product flags: print, safe mode, no persistence,
empty tools, strict empty MCP config, empty setting sources, disable-all-hooks
settings, disabled slash commands, stream-json, verbose and hook events (plus
only optional hardening verified by startup).

For the currently verified help (which does not expose `--max-turns`), the
argument vector is exactly:

```json
["-p", "--safe-mode", "--no-session-persistence", "--tools", "",
 "--strict-mcp-config", "--mcp-config", "{\"mcpServers\":{}}",
 "--setting-sources", "", "--settings", "{\"disableAllHooks\":true}",
 "--disable-slash-commands", "--output-format", "stream-json",
 "--verbose", "--include-hook-events"]
```

The request travels on stdin, with no positional prompt. Help/version preflight
is metadata-only; this one request itself is the canary, not an extra call after
a separate live canary.

Use the unchanged isolation observer and answer parser. Pass requires an answer,
empty tool/MCP/plugin registries, no hook/tool/unknown events and no files written.
On failure, save only the metadata above and stop; do not retry or make an Ask
call. On success, report numeric usage and elapsed time without preserving raw
events. Delete the synthetic temp directory after checking it. No ink, ledger,
prompt, output or transcript will be written to the repository.

Estimate: roughly 300–800 application-input tokens and 10–80 answer tokens,
including the product JSON wrapper; CLI/system overhead is unknown and can add
thousands of input tokens. The earlier 3,000 input + 300 output estimate is a
planning allowance, not a cap. Only reported usage can establish actual overhead.
This is an observational canary, with the managed-hook limitation above.

### Recorded result

Exactly one product provider invocation ran. Help/version preflight passed with
no managed-settings warning. The provider rejected the response and no retry or
Ask call ran. The fixture was deleted, its synthetic Markdown stayed unchanged,
and no raw response or transcript was persisted to the repository. The parser
function is unchanged from `c536db3`.

| Observation | Value |
| --- | --- |
| Provider error | `invalid_response` |
| Exit / stderr | 0 / none |
| Wall time | 33,197 ms |
| Stdout bytes | 20,637 |
| Events in order | system/init x1; rate_limit_event x1; system/unknown x17; assistant x2; result/success x1 |
| Tools / MCP / plugins | 0 / 0 / 0 |
| Hook events / tool attempts / files | 0 / 0 / 0 |
| Unrecognized events | 17 |
| Final result | Present, non-empty, 2,390 UTF-16 characters |
| Starts with a fence | true |
| Whole-result JSON | false |
| Wrapped JSON object probe | true |
| First JSON error | Result syntax error, stream line 22; character position unavailable |

Two independent blockers occurred: **(d)** first, the canary rejected `system`
events with unrecognized subtypes; **(a)** independently, a fenced result had a
valid JSON object inside but was not itself JSON. The sanitizer retained the
event type `system` but deliberately replaced the unknown subtype with
`unknown`. Its original spelling cannot be recovered from retained metadata.
There is no evidence here for wrong keys: key inspection did not run on a valid
whole-result object. The raw events were not retained to investigate further.

Final-result usage: 2 uncached input + 1,783 cache-creation input + 3,289
cache-read input = **5,074 input**, with **2,787 output** tokens. Per-model
counters additionally report **790 input and 16 output** in a separate bucket;
summing the per-model buckets gives **5,864 input and 2,803 output**. Message
usage observations repeat counters and are excluded from these totals. Cached
input is included according to Anthropic's
[documented token breakdown](https://platform.claude.com/docs/en/build-with-claude/prompt-caching#tracking-cache-performance).

Against 3,000 input + 300 output, the per-model aggregate is **2,864 additional
input and 2,503 additional output** tokens. The separate 790/16 bucket is
observable additional CLI-associated usage; no field separates all CLI/system
context from application input or reasoning from visible answer tokens. Exact
total CLI overhead therefore cannot be isolated from these counters.

### Earlier schema proposal — superseded by the approved fence rule below

First investigate the documented `--json-schema` mechanism (also listed in the
captured 2.1.205 help), requiring an object with only `answer` and `claims`, then
read and strictly validate `structured_output`. Require a non-empty bounded
answer, a bounded claims array, permitted fields and validated source references.
Do not extract arbitrary JSON from prose or tolerate fences. See the
[CLI structured-output documentation](https://code.claude.com/docs/en/headless#get-structured-output).

This is not yet an approved compatible fix: the SDK documentation explicitly
says schema mode adds a `StructuredOutput` tool and may use retries. Whether the
installed CLI's schema flag has identical behavior is unverified; it cannot be
assumed to preserve an empty tool registry and a single model turn. Our current
checks would reject those tool events. No formatter exception or retry behavior
will be introduced without a human decision. Source:
[StructuredOutput events](https://code.claude.com/docs/en/agent-sdk/structured-outputs#recognize-the-structuredoutput-tool-call).

Separately, identify the actual unknown system subtype before proposing an exact
allowlist addition and event-shape tests. Do not accept all `system` events, and
do not infer a harmless subtype from its count. Current metadata cannot identify
it, and no extra live call is authorized. Provider acceptance stays fail-closed;
Slice B remains paused.

## Approved bounded normalization and subtype capture

The parser now accepts plain JSON or exactly one complete outer triple-backtick
block, optionally tagged `json`, with only whitespace outside. Opening and
closing fences occupy their own lines; LF and CRLF are supported. It rejects
multiple blocks, prose outside, unsupported tags, an unclosed block, and fences
inside JSON strings (including escaped backticks). The decoded value still goes
through the existing answer/claims type checks and downstream evidence checks.
No `--json-schema` flag or system-event allowlist change is introduced.

Think appends one instruction to the unchanged contract:

> Return only one JSON object. No code fences or text before or after the JSON.

System subtype names are retained only when the whole name matches
`^[a-z][a-z0-9_]{0,39}$`; otherwise they become `unknown`. This rejects trailing
newlines too. `systemSubtypeCounts` aggregates across separated event runs.
Recording a valid identifier does not authorize its event: `system/status`, for
example, is counted but still rejected. The existing conservative hook detection
includes every hook-prefixed subtype and is unchanged. Fake hook-prefixed events
fail closed and record their count. These tests are synthetic, not evidence of
hooks running in a real session.

Raw result-shape fields remain raw-text observations. `parseError` now describes
JSON decoding after the approved outer-fence normalization, while
`resultShape.parseErrorKind` continues to describe whole raw-result JSON validity.
`resultShape.answerCharacterLength` reports the decoded answer's UTF-16 string
length, or -1 if unavailable; it is an observation, not a schema-acceptance flag.

`outputTokenSplit` reports explicitly supplied numeric thinking and text counters,
or -1 for each unavailable value. Recognized locations are
`usage.output_tokens_details.{thinking_tokens,reasoning_tokens,text_tokens}` and
`usage.{thinking_tokens,reasoning_tokens,text_tokens}`. These are conditional
observations, not a claim that this CLI version emits those fields. No split is
inferred from total output tokens, character lengths or thinking/text blocks.

### Next single Think check — approval required

Propose exactly one Think request on the same synthetic cache note and selection
used in the recorded diagnostic, through the product Assistance/provider path.
Use the same isolation flags and metadata-only startup preflight, no transcript
context, an initially empty external temporary fixture and the CLI's separate
empty working directory. The prompt has only the approved Think suffix above.
The event/file canary checks remain required and the fixture is deleted after
inspection. No retries or Ask call are allowed.

Capture only private metadata: the existing fields, original safe subtype names,
per-subtype counts, explicitly reported thinking/text output tokens, and decoded
answer length. Retained live metadata currently records no hook-prefixed subtype;
the old `unknown` values cannot be reconstructed. If the next record contains any
hook-prefixed system subtype, report that finding first and stop. Do not loosen
the allowlist after seeing an unfamiliar subtype.

Use approximately 6,000 input and 3,000 output tokens as a planning estimate,
based on the previous per-model totals of 5,864/2,803. It is not a cap; report
actual final and per-model usage and elapsed time. A thinking/text split may be
unavailable. No new live call has run or is authorized by this document.
