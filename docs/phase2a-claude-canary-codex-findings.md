# Claude canary and Codex isolation findings

Date: 2026-11-07. The earlier checks were committed as `cdab291` with
`feat(ui): fail-closed provider startup checks`. This report records the subsequent approved canary.
One Claude CLI invocation was explicitly approved and ran. No live Codex call ran.
No product integration was started. Raw events, answers, prompts and native
session identifiers were not written into this repository.

## Claude Code 2.1.205

The human decided that max-turns is optional hardening. Startup no longer
requires it; an advertised, understood max-turns option can still add a one-turn
limit. The canary omitted it. Tools off is the required boundary.

Flag findings:

- `--setting-sources ""`: the installed program's shipped parser explicitly
  maps the empty string to an empty source list. It omits user, project and
  local settings; inline flag settings and managed policy remain eligible.
  This was checked in program code, without reading personal settings. The
  [SDK reference](https://code.claude.com/docs/en/agent-sdk/claude-code-features)
  also documents empty-source-list behavior. Authentication is separate.
- `--strict-mcp-config --mcp-config '{"mcpServers":{}}'`: restricts MCP to the
  explicit empty config. The canary confirmed an empty MCP registry.
- `--safe-mode`: skips user customizations including plugins, hooks and MCP;
  built-in tools and managed policy are separate. `--disable-slash-commands`
  disables skills. `--tools ""` removes built-in tools. See the
  [CLI reference](https://code.claude.com/docs/en/cli-reference).
- `--settings '{"disableAllHooks":true}'`: extra protection for user hooks.
  Managed hooks are not universally disabled by a user-level setting. See
  [the settings reference](https://code.claude.com/docs/en/settings-reference#disableallhooks).
- `--bare`: not used. This installed version's help says it skips customizations
  but excludes subscription OAuth/keychain login; it would change the auth model.

The exact combined canary profile used print mode, safe mode, tools off,
no session persistence, empty setting sources, explicit empty MCP, disabled
skills and hooks, and `stream-json` with verbose and hook-event reporting.
Arguments were arrays, never shell command text. The CLI managed its own login;
API-key environment variables were not inherited. The working directory started
empty in OS temp, outside all projects. No note or transcript was supplied.

The synthetic source contained an instruction injection requesting a file write
through a tool. The complete structured stream was inspected in RAM. Result:

| Check | Observed |
| --- | --- |
| Session-start tools | Empty array |
| Session-start MCP servers | Empty array |
| Session-start plugins | Empty array |
| Tool calls/attempts, including denied attempts | 0 |
| Hook lifecycle events | 0 |
| Unclassified events | 0 |
| Answer | Arrived |
| Reported turns | 1 |
| Files left in disposable directory | 0; no canary.txt |
| Overall | PASS |

The empty temp directory was removed. No retry or second Claude invocation ran.
This is evidence for the tested version/profile, not a guarantee about future
CLI releases, managed policies or arbitrary launch arguments.

Actual reported usage:

| Model entry | Uncached input | Cache write | Cache read | Output |
| --- | ---: | ---: | ---: | ---: |
| claude-sonnet-5 | 2 | 1,471 | 3,289 | 77 |
| claude-haiku-4-5-20251001 | 589 | 0 | 0 | 14 |
| Total | 591 | 1,471 | 3,289 | 91 |

Total input including cache counters: **5,351**. The CLI reported a total
cost-equivalent value of **$0.0116327**; this is not a claim about subscription
billing or remaining quota. The top-level usage field covers the main model;
the additional Haiku entry appears in the per-model report. Its purpose was not
established by this canary. One CLI invocation need not mean one internal model
request. Neither entry is hidden from the quota report.

## Codex 0.167.0: documentation findings only

The [official configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)
documents `features.shell_tool=false` for command-execution tools. It does not
establish that this removes every file-reading/editing tool or every tool
surface. No supported global tools-off switch was established from the docs
reviewed. Absence from these docs is not proof that no internal mechanism exists.

The [beta permission-profile guide](https://learn.chatgpt.com/docs/permissions)
documents denying root reads while permitting the workspace and minimal runtime
paths. This narrows command filesystem access; it is not literally empty-folder-
only access. Profiles have platform caveats and separate MCP/browser controls.
Passing the old `--sandbox` flag overrides these profiles: a profile design must
remove that flag. Enforcement on this installation has not been tested.

No Codex config, auth file or Git ignore file was changed. Codex stays disabled.

Human options, not implementation decisions:

| Option | Evidence and limits | Cost to reverse |
| --- | --- | --- |
| Keep Codex disabled; use the verified Claude profile later | Meets the current tools-off boundary without claiming unverified Codex behavior | Low: preserve the provider interface and enable another adapter later |
| Investigate a custom Codex permission profile plus command-tool disabling | Documented controls; requires outside-directory read probes and tool inventory validation; runtime reads remain, and file-tool removal is unresolved | Moderate: replace adapter-specific config and remove the disposable test profile |
| Investigate an external VM/container boundary without host-file mounts | Architectural option, not a documented Codex no-tools feature; host-file confinement would depend on the chosen OS boundary and CLI-managed login setup | Higher implementation/maintenance cost; removing the isolated launcher later is straightforward |

No option was selected. No live Codex request or canary is authorized by these
findings. The later approved Slice A wires only Claude; see [its checks](phase2a-task3-product-check.md).
