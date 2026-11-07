# Installed CLI isolation check and proposed canary

Checked 2026-11-07, using local metadata commands only. No inference, login,
credential inspection or provider network call was requested. Versions:
**Claude Code 2.1.205**, **codex-cli 0.167.0**. Sources are the installed
`claude --version`, `claude --help`, `codex --version`, `codex exec --help`
and `codex features list`. No session or notebook was opened.

## Flags the current adapters pass

Claude Code:

| Argument | Installed help establishes | Result |
| --- | --- | --- |
| `-p` / `--print` | Print response and exit | Present; noninteractive |
| `--safe-mode` | Disables customizations including CLAUDE.md, skills, plugins, hooks and MCP; admin policy still applies; built-in tools remain normal | Present; requires separate tools switch |
| `--tools ""` | Empty string disables the built-in tool set | Present; explicit no-tools meaning |
| `--max-turns 1` | No corresponding help entry | **Unverified**; may be hidden, not evidence that it was removed or renamed |
| `--no-session-persistence` | Print-mode sessions are not saved and cannot resume | Present; does not claim to disable every possible diagnostic/telemetry write |
| `--strict-mcp-config` | Only explicitly supplied MCP configurations are used | Present; adapter supplies none |
| `--setting-sources ""` | Selects setting sources | Present; empty-string semantics are not explicitly documented here; safe mode is the independent customization guard |
| `--disable-slash-commands` | Disables all skills | Present |
| `--output-format json` | Single-result JSON output | Present; complete tool-event observation needs a separate streaming canary harness |

`--bare` is not a replacement: installed help says it excludes subscription
OAuth/keychain auth. It would violate the intended login model. No bypass or
alternate credential mechanism was introduced.

Codex:

| Argument | Installed help establishes | Result |
| --- | --- | --- |
| `exec` | Noninteractive invocation | Present; does not mean one internal model turn |
| `--json` | JSONL events on stdout | Present |
| `--ephemeral` | No persisted session files | Present; not a promise of zero diagnostics/telemetry |
| `--ignore-user-config` | Skips user config; retains CLI-managed authentication | Present; not a global hooks/MCP/tools guarantee |
| `--sandbox read-only` | Read-only sandbox policy for commands | Present; **tools can still execute** |
| `--skip-git-repo-check` | Allows an empty non-repository working directory | Present |
| `-c key=value` | Configuration override mechanism | Present; this alone does not establish every key's semantics |
| `features.shell_tool=false` | Feature name exists in local feature registry | Does not disable all tools |
| `features.incremental_tools=false` | Feature name exists in local feature registry | Does not disable all tools |
| `features.sleep_tool=false` | Feature name exists in local feature registry | Does not disable all tools |
| `web_search="disabled"` | Arbitrary config override syntax is documented; this value's semantics are absent from exec help | Unverified by this check |
| stdin `-` | Prompt is read from stdin | Present |

No global no-tools or single-turn guarantee is advertised. No missing flag
has been silently substituted with a weaker one. The feature registry also
lists other tool capabilities; turning off three named features is insufficient.

## Startup behavior and observed results

Each adapter starts a cached version/help probe when constructed. Probes use
empty disposable OS-temp working directories, an environment allowlist,
closed stdin, no shell, a five-second limit per command and a 128 KiB output
limit. No prompt or context is sent. Output remains in RAM. A failed probe,
missing option or changed option meaning disables invocation with an explicit
message. Updating the CLI requires constructing a new adapter to recheck it.

The same startup code was exercised against both installed CLIs:

- Claude: disabled, cannot verify `--max-turns` from installed help.
- Codex: disabled, cannot verify the global no-tools and single-turn guarantees.

Fake tests cover every required argument, changed tools semantics, failed
metadata commands, eager/cached startup and rejection of read-only as a
substitute for no tools. The fake Codex's explicitly empty mock tool registry
is accepted only for the fake contract. It cannot certify a real CLI.
Unverified production invocation stays disabled even if all help checks pass.

On Windows, a PowerShell/npm shim is not launched as shell command text. The
Codex check used the installed package's Node entrypoint with explicit args;
Claude used its native executable. Machine-specific paths are not recorded here.

## Canary proposal — not authorized or run

This isolation canary is separate from the later two-action product check.
Plan **one request per provider**, sequentially, with no retries or fallback.
First resolve the missing isolation guarantees using authoritative local or
vendor documentation; report any required contract change before running.
Approval does not bypass a failed isolation check.

For each provider, create a new empty OS-temp directory outside every project.
Keep credentials CLI-managed. Use the verified no-tools, single-turn and
non-persistence settings, plus Codex read-only sandboxing. Do not enable tools
to make the canary work. Send a short synthetic instruction requesting that
the model create `canary.txt` through a file-writing or shell tool and then
return a short answer. No notes, decisions, transcripts or source paths are sent.

Observe the complete structured event stream in RAM. Claude's installed help
advertises `--output-format stream-json` and `--verbose`; that observation
profile must have its own fake contract test before use. Codex already emits
JSONL. Do not use the current final-answer-only parser as evidence that no tool
ran. Count tool requests, tool executions and denied attempts. Unknown events
that prevent complete classification make the result inconclusive, never pass.

Pass only if an answer arrives, no tool call or attempt occurs, and no
`canary.txt` exists anywhere in the disposable directory. Inspect the directory
after completion; report other file writes as isolation findings. Timeout,
authentication failure or unclassifiable events fail the check. Preserve only
a sanitized aggregate result in the repo; runtime prompts, outputs and traces
remain private/in-memory. No product integration follows automatically.

Quota estimate for **each** provider request: approximately 300–800 tokens of
application-supplied input and 50–200 visible answer tokens. CLI/system context
adds an unknown number of input tokens, potentially thousands; reasoning can
add output usage. These are not total-token caps or guarantees of plan quota.
The two calls together target 600–1,600 application-input tokens and 100–400
visible-output tokens, plus that overhead. A timeout cannot undo usage. Record
reported usage when available, never infer remaining subscription allowance.

Stop for explicit human approval before either inference call. With the current
unresolved contracts, neither provider is ready for a live canary yet.
