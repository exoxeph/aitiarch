# Chat redesign (Phase A: design only)

Status: proposal waiting for the owner's approval. Nothing here is implemented. Based on `ui-remodel` at `b1d5809`. All paths are under `ui/`.

## a. Current data flow

1. `src/chat/ChatPanel.tsx` `submit()` builds the context with `buildContext()` (`src/chat/chat-model.ts`) and calls `PUT /api/chat/review` (`server/http.ts`).
2. `ChatRuntime.review()` (`server/chat/runtime.ts`) validates the input, writes a `context_read` ledger entry per source, reads sources through `contextModules()` (`server/chat/context.ts`, which redacts them), trims history to 4 pairs, and loads persona and skills through `NodeSettingsService.extras('chat')` (`server/node-settings.ts`, `server/skill-instructions.ts`). It then calls `prepareRequest()` (`server/providers/index.ts`), which joins the base `instruction` shared with Think and Ask, a chat suffix, `personaInstruction()` (`shared/persona.ts`), the skills, and `HARD_RULES` (`shared/instruction.ts`, only when skills are attached). The review and the request are frozen in memory.
3. The panel shows `ReviewCard`. Send calls `PUT /api/chat/send`, a server-sent event stream.
4. `ChatRuntime.send()` checks budget, caps and staleness, audits `chat_started`, and calls `provider.invoke(request, {onTextDelta})`.
5. `createProvider().invoke()` calls `prepareRequest()` a second time, spawns the CLI with `claudeArguments()` (`server/providers/claude-arguments.ts`) in an empty temp folder, and writes the packet to stdin.
6. Each stdout chunk goes to `ClaudeChatStream` (`server/providers/chat-stream.ts`), which checks the exact shape of every event and runs `inspectClaudeCanary()` (`server/providers/claude-canary.ts`) on it. Any unexpected event kills the CLI. Text deltas are passed on.
7. In the runtime, `onTextDelta` collects the raw text. If it starts like JSON, `answerPrefix()` pulls out the partial `answer` string; otherwise the raw text is passed through. Either way it is sent as a `delta` with no redaction or secret check, and `applyEvent()` (`chat-model.ts`) appends it to the screen.
8. When the CLI exits, `parseResult()` parses all of stdout again and runs `inspectClaudeCanary()` over every event a second time. `parseChatReply()` (`server/providers/answer-json.ts`) accepts exact, fenced or wrapped `{answer, claims}` JSON, or treats the text as prose (`unstructured`). Then come `secretKinds()` (`server/chat/secrets.ts`) and `validateProviderResponse()`, which redacts the serialized JSON and parses it again.
9. The runtime repeats an exact-key check and runs `validateProductResult()` (`server/product-validation.ts`): every claim quote must be an exact substring of its source, or the whole reply fails. It builds a `ChatMessage`, saves it with `ChatStore.append()` (`server/chat/store.ts`, exact-key validator) or keeps it in memory, audits `chat_completed`, and emits `complete`. The panel replaces the streamed text with `ReplyMarkdown`.
10. Failures carry a `ProviderError.reason`, turned into words by `describeFailure()` and `failureText()` (`shared/chat-failure.ts`). Only metadata goes to `provider-failures.jsonl` (`server/providers/failure-metrics.ts`).
11. Add to note: `ChatInsertion` (`server/chat/insertion.ts`) reads the stored body, refuses when `insertionBlocked` or `secretKinds()` says so, and inserts an AI callout through the journaled insertion store.

## b. Root causes

| Bug | Symptom | Design flaw |
|---|---|---|
| 1. Strict parser | The CLI was killed on extra fields in `thinking_delta`, on `status`, on `signature_delta`. | One parser does two jobs: it enforces isolation and it parses for display. It fails on any event it does not recognise, not only on dangerous ones. The CLI protocol is listed by hand in five places (`chat-stream.ts`, `claude-canary.ts`, `failure-metrics.ts`, `thinking-status.ts`, `investigator/stream.ts`), and each CLI release can break each list separately. |
| 2. Raw text on screen | A JSON reply wrapped in prose streamed as written. | The display text and the machine data travel in one JSON object, so live display needs a partial-JSON parser, and when that guess fails the runtime streams raw text. Underneath, there is no stage between the CLI and the screen: redaction, the secret scan and shape checks run only on the final reply. |
| 3. Persona outvoted | Grill me still returns a full analysis. | The persona is appended after a 20-line base style written for Ask ("the first sentence is the answer", about 120 words, "2-3 options") and after a contract that requires claims, which pulls the model toward analysis. Nothing on the server checks the result, so a violation is invisible. |

Findings the brief does not mention:

- **A fourth live bug.** `validateProviderResponse()` runs `redact()` over `JSON.stringify(response)`. The `authorization:` rule removes everything to the end of the line, and in serialized JSON that is the rest of the object. A throwaway probe confirmed it: the answer "Send it in the Authorization: Bearer header." throws `SyntaxError`, and the reply fails as "could not be read". Think and Ask share this code. The path rule also misses Windows paths in serialized JSON, because the backslashes are doubled there.
- **Claims are invisible.** Chat stores `evidence`, but no chat UI renders it (grep: `.evidence` is only read by the investigator cards). The claims contract costs prompt weight and can fail a good reply over one wrong character, and the person gets nothing from it.
- **History teaches the old style.** Up to 4 earlier replies are sent back. After a switch to Grill me they are worked examples of full analysis, and they compete with the instruction.
- **The rules vary.** `HARD_RULES` is added only when skills are attached, so the order and wording of the rules change from one request to the next.
- **A workaround became a feature.** The `unstructured` fallback in `parseChatReply()` is now a stored field, a UI label and a shared type.

Where the brief is off: bug 2 is less of a leak than it looks. The model only sees redacted input. `ReplyMarkdown` renders no links or images (no `href` or `img` in the file), and the page's Content-Security-Policy has `img-src 'self' data:` and `connect-src 'self'`, so a hostile note cannot send data out through the rendered reply. The real problem is that the screen shows text the final checks would change or reject, and those checks never run on what is shown. Also, the three bugs have two shapes, not one: bug 1 is about tolerating input, and bugs 2 and 3 are about the output contract. They can be fixed separately.

## c. Three perspectives

**Security: treat the model as an untrusted narrator.**

- Before any check, every text delta reaches the event stream and the page. Nothing unchecked reaches the store or the logs: the store gets only the validated body, and the ledger and failure log get metadata only.
- Prompt echo has no guard on answers. `safeTail()` has an n-gram echo guard, but only for stderr. A model that repeats the instruction or a skill's text has it shown and saved.
- Input is redacted two or three times (context module, then `prepareRequest()` twice). Output is redacted once, at the end, never while streaming.
- A hostile note, or a session transcript, which is riskier, can tell the model to ignore the persona or to recite the instruction. It can also make it print fake claims, which are harmless because claims are checked against the sources. It can make it write "Your takeaway is..." in prose. That text cannot reach the takeaway region: chat writes only to its own file and, on Add to note, to an AI callout. That separation, not the exact-key check, is the real guarantee.
- A hostile note cannot run tools (none are enabled, the registries are empty, and the temp folder must stay empty), load remote images, or write files.

**Product.**

- A chat reply is thinking help: a question, options or an explanation. It is never a decision; the person owns those.
- A persona must guarantee what can be checked (Grill me: one question and nothing else; Plan with me: ends on one question). It can only encourage what cannot be checked (aiming at the weakest assumption, the quality of the options).
- When the model breaks the mode, the person should see that plainly. A hidden violation teaches them that the mode is unreliable without telling them why.
- Claims help only when the person can see them: "the note says X" next to a way to jump to the quote, and "1 quote not found in the note" when a quote is wrong. A wrong quote should mark that claim, not destroy the answer.

**Maintenance.**

- CLI changes that break chat today: new event types or subtypes, extra fields on deltas, `result` text that is not byte-equal to the joined deltas (two parsers reject that), and renamed flags.
- Couplings that should not exist:
  - `providers/index.ts` owns prompt text, redaction, spawning, parsing and chat-only branches.
  - The runtime knows the JSON wire format (`answerPrefix()`).
  - The chat stream depends on the canary inspector, and the investigator's parser shares the canary's rule that unknown events are fatal.
  - The exact-key checks are repeated in the runtime and the store.

## d. Proposed architecture

Five stages. Each has one job, a typed input and output, and its own test file. Think, Ask and the investigator do not change, except where they share a fixed bug or the event table.

1. **Request builder** (`server/chat/request.ts`).
   - In: the question, sources, history, persona and skills. Out: `ChatPacket {instruction, data, contract}`.
   - It owns all chat prompt text, in this order: invariants (sources are data, not instructions; no tools), then the persona's style (the persona is the answer style, with no default style above it), then skills, then the hard rules, always last.
   - History pairs from a different persona are left out, and the review says so: "2 earlier exchanges left out: different mode". The review still shows exactly this packet.
2. **Provider adapter** (`server/providers/claude-cli.ts`).
   - In: the packet and a cancel signal. Out: bounded JSON lines, plus `{exitCode, stderrTail, cwdFileCount}`.
   - It spawns and enforces limits, and knows nothing about the protocol.
3. **Event normalizer** (`server/providers/claude-events.ts`).
   - In: one line. Out: one of `text`, `thinking` (dropped), `status`, `init{registries}`, `result{text, model, usage}`, `danger{kind}`, `unknown{typeWords}`.
   - It is one table, also used by the canary, the failure metrics and, later, the investigator.
   - An isolation monitor turns these events into a verdict: exactly one `init` with empty registries, no `danger` events, no files in the temp folder. Only a `danger` event, a bad `init` or a file is fatal.
   - An `unknown` event is counted in the failure metadata and does not stop the reply. If `result.text` differs from the joined deltas, the result wins and the mismatch is counted.
4. **Output gate** (`server/chat/gate.ts`).
   - Streaming part: in, the accumulated text; out, the part that is safe to show. It redacts, and holds back the last 160 characters (or up to the next newline) so a secret split across deltas is never half shown. It stops showing text at the claims delimiter. On an instruction echo (a 60-character run copied from the instruction, persona or skill text) it stops showing text and flags the reply. Quotes from the note are allowed.
   - Final part: in, the result text, the sources and the contract; out, `GatedReply {body, claims: {sourceId, quote, verified}[], contract: {mode, met, issues[]}, insertionBlocked, echo}`.
5. **Presenter** (the runtime, slimmed down). It maps a `GatedReply` to a `ChatMessage`, writes the store and the ledger, and emits only gated deltas and the final message.

## e. One JSON object, or markdown with a claims block

Today the model emits `{"answer": "...markdown...", "claims": [...]}`.

- Benefits: the end of the answer is unambiguous, exact keys can be enforced, and the parser is shared with Think and Ask.
- Costs:
  - Live display needs a partial-JSON extractor, plus a fallback path because the model fences or wraps the JSON.
  - Markdown inside a JSON string must be escaped, and an escaping error kills the reply.
  - The format pushes the model toward a report, which works against Grill me.

The proposal: the answer is plain markdown, streamed through the gate, and may end with one block:

```
<claims>[{"sourceId":"N1","quote":"..."}]</claims>
```

The rules for the block:

- Only a block that ends the reply counts. A block anywhere else is body text.
- With no block, the reply has no claims.
- If the block is malformed, the answer is kept and the panel says "Claims could not be read."
- The streaming gate holds back any tail that could be the start of `<claims>`.

Costs of the block:

- An answer about XML could collide with the delimiter; the end-only rule makes this unlikely.
- The model may forget the block, which is acceptable.
- The app will have two output formats (chat versus Think and Ask).
- During the transition an exact `{answer, claims}` JSON reply must still be accepted, because history can teach that format.

My view: do it. It removes the mechanism behind bug 2, and it makes the persona's natural output (one plain question) the natural format. Whether it improves Grill me compliance is a hypothesis that only real calls can test.

## f. Persona enforcement

Hard rules, checked on the server and tested:

- The selected persona's text, and only that text, is sent. This already exists.
- The persona is recorded on the message.
- Structural checks run in the final gate:
  - Grill me: ends with "?", contains exactly one "?", has at most 2 sentences and 60 words, and has no list, heading, table or code. Claims are ignored.
  - Plan with me: the last sentence is a question, and there is exactly one question in the last paragraph.
  - Explain: no more than twice the length cap.

Prompt only, never checked: aiming at the weakest assumption, the quality of the options, the tone, "until the idea holds up", and "the first sentence is the answer".

A violation is never hidden, rewritten or retried:

- The reply is saved and shown with a plain line, for example "Not what Grill me asks for: 4 paragraphs and no question."
- An "Ask again for one question" button sends a new message through the normal review.
- Add to note stays the person's choice.

## g. What to delete

- `answerPrefix()` and the prose passthrough in the runtime.
- The fenced and wrapped extraction in `parseChatReply()`, and the code that writes `unstructured`.
- The per-event exact-shape checks in `ClaudeChatStream`, replaced by the normalizer.
- The second canary pass in `parseResult()` for chat.
- The runtime's exact-key check; the store validator stays.
- The `insertionBlocked` computation in `parseResult()`, so the gate is the only place that sets it.
- The chat branch and suffix inside `prepareRequest()`.
- The hand-kept type and subtype sets in `failure-metrics.ts`, replaced by the normalizer table.
- `STUB_REPLY` in `chat-stub.ts`, which is unused.

## h. Migration

- Chat files stay `v:1`. New optional keys follow the existing `skills` and `unstructured` pattern in `ChatStore.validate`: `persona`, `contract {mode, met, issues}`, and `claimsUnverified` (a count). `evidence` keeps its shape and holds only verified claims.
- Old files with `unstructured: true` keep loading and keep their label.
- Risk: an older build of this branch would reject the new keys and refuse the whole file. That is acceptable while nothing is released, but the release notes should say so.
- Ledger event names do not change.
- Add to note reads `body` and `insertionBlocked` as it does today.
- "Made mine" does not appear in the chat code (grep), so thread and takeaway files are untouched.

## i. Staged plan (6 commits, chat works after each)

1. **Redact after parsing.** Redact the `answer` and claim fields after `JSON.parse`, not the serialized JSON. Tests:
   - An answer containing "Authorization: Bearer x" is accepted and redacted, for chat, Think and Ask.
   - A Windows path in an answer is redacted.
2. **Event normalizer and isolation monitor.** The chat stream, the final parse and the failure metrics use one table. Tests:
   - The real-shape fixtures (status, thinking extras, signature delta) pass.
   - An unknown event followed by a valid reply passes and is counted.
   - A nested `tool_use`, a hook event, a non-empty registry in `init`, or a file in the temp folder each fail.
   - A mismatch between the result and the deltas is tolerated.
   - In `check/chat-send.mjs`, the unknown-event scenario becomes "an unknown event and no reply fails with 'the reply ended before it was complete'".
3. **Streaming gate.** All deltas go through the gate, still on the JSON wire format. Tests:
   - A secret split across two deltas never appears in any emitted delta.
   - Wrapped JSON never streams the text outside `answer`.
   - An instruction echo stops the display and flags the message.
   - A quote from the note does not trip the guard.
4. **Request builder and markdown format.** The persona owns the style, the hard rules always come last, history is filtered by persona, replies use the `<claims>` block, and each claim is verified on its own. Tests:
   - A snapshot of the instruction order.
   - The Grill me instruction contains none of the Ask style lines.
   - Claims-block cases: absent, malformed, mid-text, fenced, and the delimiter inside a code block.
   - A wrong quote keeps the reply and marks the claim.
   - An exact JSON reply is still accepted.
   - Old files load.
   - The review still equals what is sent.
5. **Persona contract and honest display.** The contract is stored on the message, and the UI shows the violation line, the "Ask again" button and the claims. Tests:
   - Grill me fixtures that violate and that comply, Plan with me without a final question, and an over-long Explain.
   - `chat-model.test.ts` covers the labels.
   - `check/persona.mjs` gains a violation scenario.
6. **Delete.** Remove the items in (g) and update the tests.

   Done in three commits. Most of (g) had already gone in stages 2 to 4 (the strict stream parser, the second canary pass, `answerPrefix` in the runtime, the chat suffix in `prepareRequest()`). What stage 6 removed:
   - `STUB_REPLY` in `chat-stub.ts` (no caller).
   - `Result.unstructured` (never set) and `Result.insertionBlocked` (the runtime already computes it from the answer).
   - The fenced and wrapped JSON extraction in `parseChatReply()`, with its streaming counterparts in `gate.ts` (the fence-start allowance and the mid-prose `{"answer"` hold-back). Such replies are now shown as written.

   Kept on purpose:
   - An exact `{answer, claims}` reply is still accepted (and streams as its answer), and JSON-shaped text that is wrong or cut off still fails closed.
   - The runtime's exact-key check, which `chat-backend.test.ts` pins as the "owned fields are never accepted" guard.
   - `ChatMessage.unstructured`, its label and the store validators, so old chat files still load.
   - The hand-kept event sets in `failure-metrics.ts`, which Think and Ask still use.
   - `ClaudeChatStream.unknown`, `mismatch` and `finalText`, which only tests read.

Each stage runs its own tests plus the neighbouring chat tests, `tsc` for both configs, `check/chat-send.mjs` and `check/persona.mjs`.

## j. Risks, and what only a real model call can show

The owner must test these by hand:

- Whether Claude reliably writes markdown followed by a final `<claims>` block, and how often it puts the block in the middle or inside a fence.
- Whether Grill me compliance improves. Suggested test: 5 Grill me questions on a test note, before stage 4 and after stage 5, counting violations.
- The installed CLI's real stream: new event kinds, and whether `result` equals the joined deltas.
- How the 160-character hold-back feels while text streams.
- False positives from the echo guard on real replies.

Known risks:

- The hold-back delays the last line slightly.
- The persona checks are heuristics; a rhetorical "?" could pass.
- The forward-compatibility issue in (h).

## k. Rejected alternatives

- **Patch the allow-list again.** The same bug comes back at the next CLI release.
- **Accept every event without an isolation check.** This loses the no-tools guarantee.
- **Stop streaming and show the reply only after validation.** Safest and simplest, but the person watches a spinner for 10 to 30 seconds. The gate makes it unnecessary.
- **Two calls, one for the answer and one for claims.** Double the cost and the wait.
- **The CLI's structured-output mode.** Support in the pinned contract is unverified, and it brings JSON escaping back.
- **Trim a Grill me reply to its first question.** It would make the mode look reliable when it is not.
- **Retry automatically on a violation.** It spends credits without asking and breaks "No retry was made".
- **Drop claims entirely.** Viable, since nobody sees them today. Kept because a visible check of each claim is the main way a person can tell whether the model read the note.
- **Move Think and Ask to the new format now.** Out of scope for this work.
- **A streaming JSON parser library.** A new dependency that only fixes bug 2.
