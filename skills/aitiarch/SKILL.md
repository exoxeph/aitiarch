---
name: aitiarch
description: Load for ANY request involving Aitiarch (install, set up, start, open, use this plugin, a repo link, or the explicit command), whatever the wording. Discover state and perform only missing local setup, without chat questions or model calls.
---

Experimental. Source setup is required today: Node >=24 (or the package's higher engines minimum), `npm ci` and `npm run build`. No standalone release artifact exists yet.

## One discovery-driven flow

Use this same discovery-first checklist after every trigger, whatever the wording. Do not turn discovery into chat questions about install location, build approval, project folder or ignore consent. The host's command-approval prompt supplies command consent; honor its refusal without bypasses or a second chat prompt. Never weaken another repository's safety rules.

Both Claude Code and Codex must run setup steps strictly one at a time, each to completion: never batch or parallelize copy, npm, init, doctor or start. Give EVERY command an explicit absolute working directory in the host shell tool, including the read-only planner. Use the absolute project folder for discovery/copy; after copying use the absolute appHome for all remaining commands. Check each exit code before starting the next command. Commands below are separate tool calls, not a batch. appHome comes only from the planner, never inside the project or plugin cache. No chat questions for these defaults; the host's own approval prompts supply consent.

### Sandbox blocks and the single terminal fallback

Distinguish an EPERM/EACCES host sandbox block on writing outside the workspace from a user refusal. On a sandbox block, request the host's normal command approval once per step, for exactly the same command and absolute working directory. Never retry with another technique or silently choose another location; never hand-copy source and never write into the plugin cache. If the user declines, STOP; do not work around that decision. If there is no approval path, STOP without executing further commands. Print ONE complete command with the actual absolute paths substituted (no unresolved variables), explaining that it copies source if needed, runs npm ci/build if needed, initializes private mode and merges `/.aitiarch/` into this project's `.gitignore` if needed, then runs doctor and start:

Resolve the Node executable that passed discovery to its absolute path (`$nodeExecutable` below). Use the host shell's invocation syntax; for PowerShell print:

```powershell
& "$nodeExecutable" "$pluginRoot/ui/scripts/plugin-setup.mjs" run --project "$project" --yes-ignore
```

Tell the user: run this in a normal terminal, or allow outside-sandbox commands, then tell me to continue. The user's own execution consents to the displayed private-ignore merge. Never execute this fallback without the host's approval where required. The helper executes the sequence serially with explicit absolute working directories and no shell strings. On continuation, run discovery again: reuse a complete version-stamped build and an existing notebook, never repeat completed copy/build/init steps. Never treat a failed or null build marker as completed. Report any planner `skippedChecks` (ancestor inspection denied by host sandbox); final targets and deepest existing components still require strict inspection.

1. Discover. Preserve the original current working directory. Project = the path the user named, otherwise that original cwd. Claude package root is `${CLAUDE_PLUGIN_ROOT}` (host substitution in this body, not an assumed shell variable). Codex supplies the loaded SKILL.md file path in its skill listing: resolve `../..` from its directory. Do not assume PLUGIN_ROOT is exported to a skill shell; it is documented for hooks only. Never search private host directories. Check `node --version` first; missing/too-old Node is a prerequisite error, never permission to install a replacement. Run the read-only planner from the original cwd with quoted separate arguments:

   ```powershell
   node "$pluginRoot/ui/scripts/plugin-setup.mjs" --project "$project"
   ```

   It resolves appHome in code: `AITIARCH_HOME` override, otherwise Windows `LOCALAPPDATA/Aitiarch/app`, macOS `~/Library/Application Support/Aitiarch/app`, Linux `${XDG_DATA_HOME:-~/.local/share}/aitiarch/app`. The planner selects the normal config resolver (`AITIARCH_CONFIG_DIR` override supported), checks safe/writable folders and returns the steps, version and build marker. Do not substitute the plugin cache as notebook, config or build cwd. Refuse unsafe folders and name a dedicated project subfolder to use instead. A linked `.aitiarch` is unsafe. Do not inspect credentials, notes or real host configuration during discovery.

2. Prepare. If `buildRequired` is false, reuse appHome untouched. If true (including version mismatch or `build-version.json` with `{"version":null}`), rebuild from scratch without a question: recopy all filtered source, then npm ci and build. Never reuse an unstamped dist. Execute through the host shell under its normal approval mechanism, without an additional chat question:
   - With explicit absolute working directory `$project`, run `node "$pluginRoot/ui/scripts/plugin-setup.mjs" --project "$project" --copy-source`. Await its successful exit before doing anything else. This helper validates required runtime entries, creates appHome and atomically marks `build-version.json` invalid (`{"version":null}`) before source updates. It copies the plugin root with exclusions for dependencies, build/test outputs, Git, private/protected files and notebooks; it skips every source symlink/junction and refuses linked required entries or destination paths. Never follow links or copy by hand. Optional LICENSE/notices are copied if present; absence is not a failure. A missing required runtime entry is a named build failure, not a reason to clone an invented URL. Never delete an installation or any existing directory.
   - With explicit absolute working directory `$appHome`, run `npm --prefix "$appHome/ui" ci` as its own command. Wait for completion and check the exit code. Only then, in another command with the same absolute working directory, run `npm --prefix "$appHome/ui" run build`. The prefix makes both commands independent of the caller's cwd. npm ci replaces dependencies only in this app-owned install under the host's approval, never in the plugin cache or user's project. Show the exact target in the command prompt. Stop on a nonzero exit; do not stamp success or start an older build.
   - Only after both succeed, write the planner's buildMarkerContent to buildMarker. Re-run the planner; it must now report `buildRequired:false` before continuing. Same-version re-runs with intact source, dependencies, dist and marker skip this work.

3. Initialize. If `initializeRequired` is false, use the existing `.aitiarch` and never overwrite or migrate it. Otherwise run the unchanged wrapper with private defaults. The host prompt must explicitly show this command and explain that it merges `/.aitiarch/` into this project's `.gitignore`; this is the only authorized Git-file change. Do not hide that effect inside a generic “setup” approval, self-approve it or use an approval bypass. When the host has no command-consent mechanism, stop with that restriction rather than silently editing a Git file.

   ```powershell
   node "$appHome/ui/scripts/aitiarch.mjs" init "$project" --private --yes-ignore
   ```

   Report init's exact created paths and ignore-line change. Preserve all existing note bytes, BOM, CRLF, hooks, CLAUDE.md and AGENTS.md. No Git means filesystem-private, not Git-protected. If ignore writing/verification fails, private persistence remains disabled; stop and report the write blocker. Shared mode is not ready until slice 9; do not claim it is safe or change an existing notebook's sharing policy.

4. Doctor and start. After missing work only, run these from a safe cwd outside the cache. Use the planner/init notebook path, not its parent. Doctor is local metadata only, never a login or inference test. Follow its prerequisite result; unavailable providers still permit AI-off use. Do not set HOME or reuse CLI credentials. Config must stay separate from the notebook, app and plugin cache.

   ```powershell
   node "$appHome/ui/scripts/aitiarch.mjs" doctor
   node "$appHome/ui/scripts/aitiarch.mjs" start --project "$notebook"
   ```

   Check each exit code. Keep the process available as requested by start/open; report the actual local URL printed by the server, never guess a port. AI-off smoke check: verify the page loads without sending a message; do not type in or alter an existing notebook. Automated development checks use synthetic notebooks and an empty temp AITIARCH_CONFIG_DIR only.

5. Report. A few lines: app build reused or installed/rebuilt, project/notebook location, exactly what init/ignore changed (or “existing notebook reused; no init changes”), and the actual local URL. No success claim after a failed step.

## Blockers

Stop and explain an actual blocker with its folder or prerequisite; never solicit the four setup choices again. The categories below include denied host commands, malformed/missing source and unsafe paths/config. Host permission denial is final, not a workaround invitation.
<!-- blockers:start -->
- Node missing or below engines minimum.
- Build failure.
- Folder not writable.
- Unsafe project folder.
<!-- blockers:end -->

Unsafe projects include the user's home itself, a drive/filesystem root, system folders, and anything inside a plugin cache or the app install. Use a dedicated writable project folder outside those locations. A missing/unverifiable host package path is a build-source blocker. Read-only or missing project directories are write blockers. Never create a project somewhere else as fallback.

Never call a provider during setup or after installation. Never enable a provider, sign in, read credentials or send Think/Ask/chat/Council/Investigate/diagram requests. No hooks, MCP server or automatic onboarding is bundled. Never generate human-owned takeaway, Why or failed-reason text. Keep source immutable; never write notes or config inside the plugin cache. Host commands use quoted separate arguments; the explicit run helper spawns Node/npm with shell:false. A server is reused only when version, app folder and notebook root all match; stop and report a mismatch, never silently show another notebook.

Host path references: [Claude](https://code.claude.com/docs/en/plugins/manifest-reference), [Codex](https://learn.chatgpt.com/docs/build-skills). Actual host activation, command approval and installation require owner testing; static skill checks cannot prove a host will follow every instruction.
