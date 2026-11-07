# Try Aitiarch on a disposable notebook (Windows)

This trial uses three newly written synthetic notes about **Pocket Queue**, an invented repair-request web app. Nothing was copied from a real notebook. The folder is `aitiarch-trial` in your Windows Documents folder; its `.aitiarch` contains `plan.md`, `decisions.md`, and `launch.md`. The initial files use UTF-8 with a BOM and CRLF line endings.

Creating this guide did not start a server or call a provider. Running the commands below starts the app; sending a reviewed request makes a real call through your own provider and consumes its allowance. Closing summaries and follow-ups are additional calls, so choose which checks to perform. There are no automatic AI requests.

## Start with Claude

Use PowerShell. You need Node 24 or newer, the UI dependencies already installed, and your own native Claude executable already installed and signed in. Aitiarch does not handle your Claude credentials. These commands do not install packages or sign you in.

Initialize Git **only in the disposable trial folder**, so Aitiarch can verify ignore coverage for private drafts and the anchor cache:

```powershell
$trial = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'aitiarch-trial'
$root = Join-Path $trial '.aitiarch'
if (!(Test-Path -LiteralPath (Join-Path $root 'plan.md'))) { throw 'Synthetic trial notes not found.' }
if (!(Test-Path -LiteralPath (Join-Path $trial '.git'))) { git -C $trial init }
```

Then build and start the UI from the Aitiarch checkout:

```powershell
Set-Location 'G:\Aitiarch\ui'
npm run build
if ($LASTEXITCODE -ne 0) { throw 'Build failed; do not start.' }
$claudeExe = (Get-Command claude.exe -CommandType Application -ErrorAction Stop).Source
npm start -- --root "$root" --claude "$claudeExe" --port 0
```

`--root` points directly to the trial's `.aitiarch`, not its parent. `--port 0` asks Windows for a free port. Startup prints `AITIARCH_READY` with a `url` and opens that URL in your browser. If it does not open, copy the printed URL and run this in a second PowerShell window:

```powershell
$trialUrl = Read-Host 'Paste the url from AITIARCH_READY (http://127.0.0.1:PORT/)'
Start-Process $trialUrl
```

Keep the server terminal open. Stop it with **Ctrl+C**. Claude is the default provider for this guide, but the executable must be explicitly supplied with `--claude`; starting without either provider flag leaves AI disabled. If isolation/version checks disable Claude, stop and report the message; do not bypass the checks or substitute a shell wrapper.

Open `plan.md` from the file tree. When offered, explicitly click **Add /.cache/ to root .gitignore**. In a thread, explicitly click **Add /ui-state.json* to root .gitignore** to enable private human drafts. These buttons merge these exact lines into the trial root's `.gitignore`:

```gitignore
/.cache/
/ui-state.json*
```

Until ignore coverage is verified, the anchor snapshot cache is not persisted and takeaway drafts stay in memory. Dismissing the draft notice does not enable persistence. No ignore file was created while preparing this trial.

## Optional: uses your ChatGPT plan allowance

For a later trial, stop the Claude server first, then run:

```powershell
Set-Location 'G:\Aitiarch\ui'
$root = Join-Path (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'aitiarch-trial') '.aitiarch'
npm start -- --root "$root" --chatgpt-plan --port 0
```

Do not combine `--claude` and `--chatgpt-plan`. Provider selection is per server, not a toolbar dropdown. ChatGPT-plan remains disabled unless its explicit flag is supplied. Use the printed URL as above. The connection panel shows the plan-allowance notice and **Manage usage** link to [ChatGPT Settings → Usage](https://chatgpt.com/settings/usage). On Plus, this shares the five-hour allowance with other ChatGPT-plan use, including Codex and ChatGPT.

Existing local sign-in is retained; do not sign out merely to switch back to Claude. **Load account models** makes a network request; sign-in and any inference also need your explicit approval. Choose a catalog model before sending. **Requests per hour** / **Save cap** sets the cap; the default is 2. Automatic requests stay off. Do not change the cap just to force a limit test.

## Manual checklist

All selections, edits, and insertions below belong in the disposable notes only. AI answers are visibly labeled **AI**. The initial answer can be visible immediately; the **closing summary** is the part withheld until your takeaway or explicit Skip. The AI must never write, suggest, or pre-fill your takeaway, your why, or a failed reason.

| Check | Steps | Expected result |
| --- | --- | --- |
| Think | In `plan.md`, select the paragraph beginning “We plan to store requests”. Click **Think on this**, or press **Ctrl+Enter**. Review the frozen selection and **Exact redacted request**, then click **Send to Claude** when ready. | One explicit request. The validated answer appears as AI ink attached to that selection; no answer is accepted while still partial. The note text has no added IDs or anchors. |
| Ask | Select the “postpone accounts” paragraph. Click **Ask...**, enter “Which deferred feature would most threaten this demo if omitted?”, click **Review request**, inspect it, then **Send to Claude**. | One explicit request using the captured selection. The question stays in memory; after reload a stored answer has a clear question-unavailable placeholder. |
| Empty takeaway / withheld summary | Click **Open thread** on an answer, or use the right panel's **Activity** tab and select its thread. | A new **Your takeaway** box is empty. No AI text is offered as its draft. **AI closing summary** says “Hidden until you submit your takeaway or explicitly Skip takeaway.” A previously saved human draft may restore after reload if ignore coverage is verified. |
| Submit | Type your own short takeaway and click **Submit my takeaway**. | Your text is saved to the ink sidecar and displayed as **Your submitted takeaway**. Markdown is unchanged at this point. The summary is unlocked. If none exists, **Request closing summary** appears; it does not call automatically. To obtain one, review that separate request and explicitly click **Send thread request**. |
| Preview, insert, undo | Click **Preview insertion**. Read the preview; first cancel it, then preview again and click **Insert my takeaway**. Focus the editor and press **Ctrl+Z**. | Cancel changes no Markdown. Confirm inserts only your submitted text through the editor's normal transaction and compare-and-write. Undo removes that insertion; the submitted takeaway and history remain in the sidecar. Untouched Markdown bytes, CRLF, and BOM are preserved. |
| Skip a second thread | Open the Ask thread, leave its takeaway empty, and click **Skip takeaway**. | It shows **Takeaway explicitly skipped** with a timestamp, distinguishable from an untouched thread. An existing closing summary is revealed; otherwise **Request closing summary** becomes available. No summary is invented or requested automatically. **Reopen takeaway** allows a later human submission; it cannot make already seen text unseen. |
| Edit while loading | On another unique paragraph, review and send a request. While it is waiting, insert an unrelated sentence above the selection. | The submitted selection stays frozen. The delayed answer follows the original text through the edit. If the request finishes before the edit, this did not exercise the race; record it as untested rather than automatically sending another call. |
| Delete while loading / orphan | Optionally repeat on a disposable paragraph and delete the entire selected paragraph while waiting. | The answer survives in the orphan list rather than attaching to unrelated text. Known candidates appear as **Attach here?** choices first; otherwise select replacement text and use **Re-attach to selected text**, review, then **Save re-attachment**. A stale selection is rejected. Existing human takeaways survive orphaning. |
| External edit | With `plan.md` open, run the Notepad command below. Add a sentence elsewhere, save, and return to Aitiarch. Also try this while a takeaway is half-typed. | The file watcher updates the page. Disjoint edits merge, while a conflicting edit requires resolution rather than silently overwriting. The human takeaway draft remains intact. External edits never become provider requests automatically. |
| Dismiss / Restore | Click **Dismiss thread**, then find its dismissed entry in **Activity** and click **Restore thread**. | Dismiss hides the active conversation but preserves replies, submitted takeaway, and history. The dismissed entry explains this and offers Restore. Restore brings it back. |
| Delete | Click **Delete thread…**, choose **Keep thread** first, then repeat and choose **Confirm delete thread**. | Cancel preserves it. Confirm removes that thread, replies, takeaway, and private draft; it cannot be undone. Any text you previously inserted into Markdown remains. |
| Reload | Reload the browser after saving a takeaway or Skip; reopen the note and thread. | Ink, submitted takeaways, Skip timestamp, and any orphan are preserved. Questions show the memory-only placeholder. Drafts restore only when ignore coverage was verified before persistence. |

Open the synthetic file in Notepad from a second PowerShell window:

```powershell
$trialPlan = Join-Path (Join-Path (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'aitiarch-trial') '.aitiarch') 'plan.md'
notepad.exe "$trialPlan"
```

Do not deliberately change encoding or line endings in the other editor when checking byte preservation. To inspect the BOM and CRLF without changing a file, use this before and after your edits:

```powershell
$bytes = [IO.File]::ReadAllBytes($trialPlan)
$text = [Text.Encoding]::UTF8.GetString($bytes)
[pscustomobject]@{
    Utf8Bom = ($bytes.Length -ge 3 -and $bytes[0] -eq 239 -and $bytes[1] -eq 187 -and $bytes[2] -eq 191)
    BareLfCount = [regex]::Matches($text, '(?<!\r)\n').Count
}
```

Expected: `Utf8Bom` is `True`, `BareLfCount` is `0`. These two checks verify encoding/line endings, not all unchanged bytes: compare the text with your intended edits as well. Ink is in `.aitiarch/ink/`, ledger entries in `.aitiarch/ledger.json`, and verified private drafts in `.aitiarch/ui-state.json`; inspect only this synthetic root. No user question or transcript should be persisted there.

## Failure checks and messages

Use **Cancel request** while an initial request is pending, or **Cancel reply** for a pending follow-up. A separate interactive Claude terminal is not Aitiarch's headless child; stopping it is not a reliable failure test. To simulate app interruption, stop the Aitiarch server with Ctrl+C while a request is pending, restart with the same trial root, and reload. Do not kill unrelated Claude processes, edit credentials, or spend allowance trying to force remote errors.

The thread panel uses these messages. An initial request/review can instead show the more specific CLI availability error, or “Request failed or interrupted. Open thread for details.” Some failures require a real remote condition and are not safely reproducible on demand; record those as untested.

| Condition | Thread message / expected behavior |
| --- | --- |
| No enabled provider / failed isolation checks | “Provider disabled. Enable it explicitly at server startup.” Review may say “This CLI has no verified no-tools contract; invocation is disabled.” Do not bypass it. |
| Missing CLI / not signed in / unavailable | “Provider unavailable. Check your CLI or connection.” Review may say “CLI not found. Install your own CLI, then retry.” or “Sign in using your own CLI, then retry.” |
| Hourly cap | “Hourly cap reached. No request was sent.” |
| Plan usage limit | “Plan usage limit reached. No automatic retry.” |
| Answer validation | “Answer rejected by validation. No partial answer was accepted.” |
| App interrupted during a request | “Request interrupted. No automatic retry.” |
| CLI or stream format changed | “Provider format changed or stream incomplete. No partial answer was accepted.” Some invalid CLI responses instead map to the validation message. |
| Deadline | “Request timed out. No automatic retry.” |
| Explicit cancellation | “Request cancelled. No partial answer was accepted.” |
| Child process exits / other provider failure | “Provider request failed. No automatic retry.” |
| Saving the accepted answer failed | “Saving failed. Retry saving only; no new provider call.” Use the save-only retry button, not another provider request. |

## Private usage logs

For **ChatGPT-plan**, completed response usage is recorded outside the repo at `%LOCALAPPDATA%\Aitiarch\chatgpt-plan\usage.jsonl`. It contains timestamps and numeric `input`, `cached`, `output`, and `reasoning` token counts for Aitiarch's own completed calls. A completed stream can have a usage entry even if subsequent answer validation rejects it; this is not a count of accepted answers or a view of all account usage. Cached tokens are part of input; reasoning tokens are part of output, so do not add them twice.

This reads only the usage file, not credentials:

```powershell
$usageLog = Join-Path $env:LOCALAPPDATA 'Aitiarch\chatgpt-plan\usage.jsonl'
if (Test-Path -LiteralPath $usageLog) {
    Get-Content -LiteralPath $usageLog -Tail 20 |
        ForEach-Object { $_ | ConvertFrom-Json } |
        Select-Object at, provider, input, cached, output, reasoning
} else {
    'No ChatGPT-plan usage log yet.'
}
```

**Current Claude limitation:** there is no persistent successful-call usage log or own-call/token panel wired into the product. Its adapter returns usage in memory, but successful-call totals are not saved for later inspection. `%USERPROFILE%\AppData\Local\Aitiarch\metrics\provider-failures.jsonl` contains metadata for failures, including numeric usage only when the CLI reported it. It is not a complete usage ledger. To see just those failure counters locally:

```powershell
$failureLog = Join-Path $env:USERPROFILE 'AppData\Local\Aitiarch\metrics\provider-failures.jsonl'
if (Test-Path -LiteralPath $failureLog) {
    Get-Content -LiteralPath $failureLog -Tail 20 |
        ForEach-Object { $_ | ConvertFrom-Json } |
        Select-Object wallMs, usage
} else {
    'No Claude failure metrics log yet.'
}
```

Neither log supplies remaining requests, account-wide allowance, or a dollar price. Do not open, share, or copy `credentials.json`, any login file, or a transcript into this repo. Stop the server when finished; the disposable notes remain available for another trial.
