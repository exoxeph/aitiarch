# ChatGPT plan provider: fake-server slice

Status: implemented behind `--chatgpt-plan`, disabled by default. No real sign-in,
OpenAI authentication/API request, browser launch or live inference was performed
for this slice. The tests use loopback servers, ephemeral signing keys and generated
fake tokens. They are not evidence of real-account eligibility or live compatibility.

## Reviewed sources and wire inventory

The following official pages were re-read for this implementation. Endpoint and
parameter names below are documented; implementation restrictions are identified
separately. No pricing, model names or estimated message allowances are asserted.

| Page | Documented contract used |
| --- | --- |
| [Overview](https://developers.openai.com/siwc/token-sharing-open-source) | The local/open-source flow supports dynamic registration; a pre-issued client ID, client secret or partner key is not required for that flow. Host identity persists across restarts. |
| [Registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in) | Authorization endpoint `https://auth.openai.com/api/accounts/authorize`; initial `client_id=dynamic_agent_client`, `agent_name_hint=Aitiarch`, stable `ext_agent_host_id=urn:uuid:<UUIDv4>`; returning sign-in reuses issued `client_id` and can send retained `id_token_hint`. Parameters: `response_type=code`, `redirect_uri`, `scope`, `resource`, `state`, `nonce`, `code_challenge_method=S256`, `code_challenge`. Callback `code`, `state`, issued `client_id`. Token endpoint `https://auth.openai.com/api/accounts/oauth/token`; form fields `grant_type=authorization_code`, issued `client_id`, `code`, `code_verifier`, identical `redirect_uri`, `resource`. |
| [Accounts and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions) | Refresh uses the token endpoint with `grant_type=refresh_token`, issued `client_id`, `refresh_token`, `resource`; omit `scope`. Serialize rotating refreshes. Discover `revocation_endpoint`; form POST `token`, `token_type_hint=refresh_token`, `client_id`; empty HTTP 200 is success. Clear local tokens and retain registration/host identity. Plus shares one five-hour allowance across apps; that rule does not apply to Pro. |
| [Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference) | `GET https://api.openai.com/v1/models`, bearer access token; catalog fields `models`, `visibility`, `slug`, `display_name`. Display listed models in server order; send selected `slug` as `model`. `POST https://api.openai.com/v1/responses`; bearer header, JSON content type, `input`, `instructions`, `store:false`, `stream:true`. Final success requires `response.completed`. |
| [Token reference](https://developers.openai.com/siwc/token-sharing-open-source/token-reference) | Token response fields used: `access_token`, `refresh_token`, `id_token`, `token_type`, `expires_in`, `scope`. `earliest_refresh_at` is documented but not interpreted here. Access-token authentication metadata stays opaque. |
| [Errors and recovery](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery) | Exact codes below; distinguish usage, eligibility, authorization and unsupported-capability failures. No fallback to API-key billing. |
| [Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations) | Use the supported Responses subset. Omit tools, unsupported generation controls and `previous_response_id`. Send context explicitly. |
| [UI/UX guidelines](https://developers.openai.com/siwc/ui-ux-guidelines) | Continue with ChatGPT entry, first-connection acknowledgment, plan-allowance notice, Manage usage link to `https://chatgpt.com/settings/usage`. Do not imply a separate allowance. |

The exact requested scope string is:

```text
openid profile email offline_access resource.invoke chatgpt.tokens.use.direct
```

The resource is `https://api.openai.com/v1`. The callback is
`http://127.0.0.1:<ephemeral-port>/auth/callback`; authorization and code exchange
use the identical URI. Nothing opens a browser automatically for OAuth.

Additional official references: [ID-token validation and discovery](https://developers.openai.com/siwc/website)
documents issuer `https://auth.openai.com` and discovery at
`https://auth.openai.com/.well-known/openid-configuration` (`issuer`,
`authorization_endpoint`, `token_endpoint`, `jwks_uri`). Accounts and sessions adds
`revocation_endpoint`. JWKS and revocation URLs are read from discovery, not guessed.
Only reviewed HTTPS origins/endpoints are accepted. The JWT verifier currently
supports RSA/RS256 only, checks the published signing key, issuer, audience,
expiry, issuance time, nonce and stable account subject, and fails closed on
other algorithms. This limited algorithm support is an implementation choice,
not a claim about all real OpenAI tokens.

The [Responses streaming reference](https://developers.openai.com/api/reference/resources/responses/streaming-events)
supplies `sequence_number`, `response.output_text.delta` / `delta`, lifecycle
events and the completed response's `usage.input_tokens`,
`usage.input_tokens_details.cached_tokens`, `usage.output_tokens`, and
`usage.output_tokens_details.reasoning_tokens`. Example numbers are not quotas.

## Request preview at STOP 1

These are the exact application-supplied headers and body keys. All runtime
content is redacted; no captured prompt or output is kept in this document.
The selected model comes from the signed-in account catalog, never a hardcoded
model name. Node adds ordinary transport headers such as Host and Content-Length.

```http
POST https://api.openai.com/v1/responses
Authorization: Bearer <REDACTED_ACCESS_TOKEN>
Content-Type: application/json
```

```json
{
  "model": "<SELECTED_CATALOG_SLUG>",
  "input": [{
    "role": "user",
    "content": "<JSON-serialized redacted frozen request: id, action, question, selection, note, decisions, turns>"
  }],
  "instructions": "<shared strict invoked-answer instructions>",
  "store": false,
  "stream": true
}
```

There is no tools field. The shared instructions require the single-object
answer/claims contract, exact `sourceId` and `quote` fields, verbatim source
quotes of at most 240 characters, and no human takeaway, why or failed reason.
The existing selection freeze, diff mapping, orphan preservation, v2 ink and
shown/dismissed ledger are reused. No OAuth material enters ink or the ledger.

Authorization navigation uses the documented parameters above. Code exchange,
refresh and revocation are form-encoded POSTs with
`Content-Type: application/x-www-form-urlencoded`; no client secret or API key
is sent. Model discovery supplies only `Authorization: Bearer <REDACTED>`.

## Storage and safety

Windows token file:
`%LOCALAPPDATA%\Aitiarch\chatgpt-plan\credentials.json`.
Unix fallback: `~/.config/Aitiarch/chatgpt-plan/credentials.json`.
Private `usage.jsonl`, `failures.jsonl` and `cap.json` are siblings. Host and
account/client registration metadata remain in credentials.json after sign-out;
access, refresh and ID tokens are removed. No tokens enter browser storage.

The provider refuses repository paths, notebook-root paths, `.aitiarch` paths,
links/junctions and unsafe existing files. Windows initialization installs and
verifies an owner-only ACL; unsupported permissions disable the provider. Unix
uses directory mode 0700 and file mode 0600. Writes are atomic; a private
exclusive lock serializes session changes across instances/processes. An
abandoned lock fails closed rather than risking refresh-token reuse.

Startup and availability do not contact OpenAI. Discovery, sign-in, catalog
loading, sign-out and inference require explicit actions. The hourly cap defaults
to two requests; the user can set 1–100. Each inference HTTP attempt counts,
including retry attempts. Automatic inference is absent. Usage is recorded only
from successful completed events, including when later answer validation fails.
No invented remaining-request count or dollar price is displayed.

Each network operation has a deadline. HTTP 503 can retry at most twice, with
bounded backoff and Retry-After. If Retry-After exceeds the short retry budget,
stop rather than retry early. A stream already opened is never automatically
replayed. Usage-limit failures never retry and pause the provider. Sign-out
stops active requests, attempts revocation and clears local credentials even
if revocation fails; the UI then says remote revocation was not confirmed.

| Exact documented code | UI meaning |
| --- | --- |
| `subscription_sharing_usage_limit_exceeded` (429) | Plan limit reached; Manage usage; no retry. |
| `subscription_sharing_user_not_eligible` (403) | Account/workspace/policy is not eligible. |
| `subscription_sharing_usage_unavailable` (503) | Usage cannot currently be checked. |
| `subscription_sharing_unsupported_capability` (400) | Request capability is unsupported. |
| `subscription_sharing_invalid_user` (401) | Account permission cannot be validated. |
| `subscription_sharing_route_not_supported` (403) | Route is unsupported. |
| `chatpass_v2_scope_not_authorized` (403) | Permission grant does not cover this request. |
| `chatpass_v2_invalid_authorization_context` (403) | Authorization context is invalid. |
| `subscription_sharing_user_unavailable` (503) | Account/workspace lookup is unavailable. |

Failure logs contain fixed rule/error identifiers, HTTP status, ordered-protocol
event counts, rejected field names/types/lengths and elapsed time only. Native
errors, response messages, prompts, IDs, tokens and streamed text are discarded.
Stream text stays in request memory; only a validated answer follows normal ink
persistence. No raw result or event capture is saved.

## Unknowns and explicit limitations

- Real account eligibility, dynamic registration availability and actual granted
  scopes remain untested. Documentation permits the local flow without an
  interest form; an actual approval requirement would stop the work.
- Actual signing algorithms and optional stream payloads have not been observed.
  Unreviewed event names/top-level event fields, non-text output items, missing numeric usage
  details or unsupported signing algorithms fail closed. No live allowlist
  expansion is authorized.
- The token reference names `earliest_refresh_at` without a usable timing contract
  in the reviewed page; it is not guessed or used. Refresh follows expires_in.
- One saved account is supported, by request. Multi-account switching is deferred.
- Real Plus account limit/usage responses, visibility of app-specific limits,
  and equivalence to Codex CLI costs remain unknown. No rate-limit or App Server
  probes have been made. See [usage evidence](openai-usage-and-limits.md).
- The fake transport validates behavior, not OpenAI's live stream shape or actual
  quota charges. No model/pricing assumptions are embedded in production code.

## Verification and approval boundaries

Verification: 481 tests passed, one optional test skipped; all 13 held-out mapping
cases passed with zero wrong attachments. Typecheck and production build passed.

Run `npm test`, `npm run typecheck` and `npm run build` inside `ui/`; these use
local fixtures and fake loopback services only. No browser checks or real CLI
invocations are required for Slice B's automated tests.

STOP 1: review this inventory, storage and request before any real sign-in.
Only after approval may the user use browser sign-in themselves. Start on a
disposable notebook with `--chatgpt-plan --no-open`; explicitly connect and load
the catalog. Do not select a model name in documentation on the user's behalf.

STOP 2: after sign-in, show the exact redacted request for one synthetic Think
call and wait for separate approval. Expected budgeting estimate: about 6,000
input and 1,500 output tokens, not a quota promise. Plus use shares the five-hour
allowance with Codex and ChatGPT. The approved test must disable 503 retries so
exactly one inference request is sent. Report actual completed usage, duration
and any unreviewed protocol field/event. No call is approved by this document.
Keep the provider disabled by default; sign out/revoke when the user requests it.
