---
name: aitiarch
description: Set up and start the experimental Aitiarch local notebook when the user requests it. Source setup is required; this workflow makes no model calls.
---

Experimental. Source setup is required today: Node >=24, `npm ci` and `npm run build` in the app's `ui` folder. There is no standalone release artifact yet.

## Resolve the package and app install

- Claude Code: the package root is `${CLAUDE_PLUGIN_ROOT}`. Claude substitutes this token in the loaded skill body; do not assume it is a shell environment variable.
- Codex: use the host-provided loaded SKILL.md file path (included in the skill listing). Resolve `../..` from that file's directory to get the package root. Do not use the shell cwd. Do not assume PLUGIN_ROOT is exported to a skill's shell: OpenAI documents that environment variable for hook commands only. If the actual loaded file path is unavailable, stop and ask for the installed package location; do not search private host directories.

Treat the plugin cache as immutable. Ask for an app-owned source checkout outside the cache to run Aitiarch from. An explicitly identified owner-managed checkout (including the local marketplace source checkout) may serve as the app install; a cached plugin copy may not. Verify `ui/scripts/aitiarch.mjs`, `ui/server/`, `ui/shared/`, `ui/package.json` and `docs/guide.md` exist there. Never install, build or run the server in a plugin cache. Do not copy files, clone, install packages or build without the user's explicit approval. Do not relocate or remove an existing installation.

Check Node first. If Node is missing or older than 24, stop with the prerequisite message “Install Node >=24, then run Aitiarch doctor.” Do not install Node or substitute another runtime.

If dependencies or `ui/dist` are missing, explain the source-build prerequisite and request explicit approval for `npm ci` and `npm run build`, run in the app-owned install's `ui` directory. Stop if approval is declined or either command fails. Do not run source setup merely because the plugin was installed.

## Choose the project, then doctor, init, start

Ask “Which project folder should Aitiarch use?” Do not infer it from the plugin cwd. Use an explicit absolute path approved by the user, outside the plugin cache and app installation. Existing notebooks are never migrated or overwritten. For the first smoke check, ask for a new throwaway project, not an existing personal notebook.

Use the normal OS config-folder resolver, or an explicitly user-selected `AITIARCH_CONFIG_DIR`. Config must live outside the plugin cache, app installation and notebook/project. Do not set HOME or reuse a host CLI's login/config directory. Never inspect credentials. For a smoke check, set `AITIARCH_CONFIG_DIR` to a fresh empty temp folder outside those locations. Keep all command arguments quoted; use argument arrays if the host provides them, never shell-evaluate user text.

Run these commands from the app-owned install; the wrapper resolves its runtime and dist relative to its own file, independent of shell cwd. In PowerShell, set `$install` to that checkout and `$project` to the approved project (the equivalent separate arguments work on other platforms):

```powershell
node "$install/ui/scripts/aitiarch.mjs" doctor
node "$install/ui/scripts/aitiarch.mjs" init "$project" --private
$notebook = Join-Path $project '.aitiarch'
node "$install/ui/scripts/aitiarch.mjs" start --project "$notebook"
```

Run one step at a time and inspect its exit code before continuing. Doctor checks local prerequisites and CLI metadata only; it does not test login or entitlement. If it reports a missing build or other prerequisite, show its next step and stop. A provider being unavailable does not prevent AI-off use.

Private is the default. Before init, explain: git privacy requires consent to add `/.aitiarch/` to the project's `.gitignore`. The `--private` flag alone does not grant that consent. Ask explicitly; only after a yes add `--yes-ignore` to the init command (or let the wrapper's interactive consent prompt ask it). Without consent or verified ignore coverage, report private persistence disabled and stop before start. Do not bypass verification or edit Git files yourself. With no Git repo, describe the result as filesystem-private, not Git-protected.

Shared mode is not ready: slice 9's private writers have not moved into `local/`. If the user requests it, explain this limitation before using `--shared`; saved threads may contain sensitive text and secret exclusion does not redact older saved data. Shared init currently reports not ready and exits nonzero; do not start or describe shared persistence as safe. It would require separate consent to add `/.aitiarch/local/` to `.gitignore`.

Use init's printed notebook folder (`$project/.aitiarch`), not its parent, as start's `--project` value. Init is create-if-absent, never permission to edit an existing note, hook, CLAUDE.md or AGENTS.md. If init fails or prints private persistence disabled, report it and stop. Do not retry with weaker protection.

## AI-off smoke check and boundaries

Never call a provider during this workflow, including as a post-install check. No hooks, MCP server or automatic onboarding is bundled. The marketplace's authentication policy does not add an authentication flow; this skill requires no login. Do not send Think, Ask, chat, Council, Investigate or diagram requests. Do not request API keys, inspect login files, enable a provider, or sign anyone in. An inference test requires separate explicit approval for that call.

AI-off smoke check: with the fresh config and new synthetic project only, open the local URL printed by start. Verify the Welcome note opens and ordinary typing/undo works without sending any AI request. Do not inspect the user's existing notes. Keep markdown byte-exact; never generate a takeaway, Why or failed reason. Report the app/notebook/config locations and any unavailable prerequisites; never write notes or config inside the plugin cache. Stop the smoke server when finished unless the user explicitly asks to keep it running.

Host references: [Claude plugin paths](https://code.claude.com/docs/en/plugins/manifest-reference), [Codex skill paths](https://learn.chatgpt.com/docs/build-skills), [OpenAI plugin packaging](https://developers.openai.com/plugins/build/plugins). Metadata and relative source layout are tested offline; neither host installation nor inference is verified by this package test.
