# Provider failure diagnostics and stream-format review

The help-recognition fix is committed separately as `f03d7b2`. This diagnostic
change is uncommitted. No provider call was made for this review. Answer parsing
and isolation acceptance rules are unchanged.

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

Error kinds are `empty`, `unexpected_end`, and `syntax`; an unavailable offset is
null. Event names come from a finite vocabulary: arbitrary names become
`unknown`, so an unexpected type cannot smuggle private text into the log.
Unknown numeric usage keys become `unknown_1`, etc.; their values are retained,
but arbitrary keys and model names are discarded. Usage entries are observations,
not a total: final and per-message counters can overlap and must not be summed.

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

## Comparison with unchanged code

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

## Proposed single diagnostic call — approval required

Run the metadata-only startup check first. Then make exactly one request through
the product provider path in an initially empty OS-temp directory outside the
repository, with no note store and no transcript context. The request question
is `reply with the word ok`; the product's existing JSON-answer instruction
remains in place. Use the exact product flags: print, safe mode, no persistence,
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

No diagnostic live call is approved by this document. Slice B remains paused.
