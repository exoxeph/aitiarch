# OpenAI usage and limits

Checked against public OpenAI documentation on 2026-11-07. This is documentation and a proposed panel design, not an enabled OpenAI integration. Claude remains the only active provider.

Labels: **Documented** means stated in a linked source; **Inferred** means an interpretation or proposed design, not a service guarantee; **Unknown** means not established by these pages or an approved account check.

## ChatGPT plan usage

| Status | Fact | Source |
| --- | --- | --- |
| Documented | Plus users share one five-hour usage limit across all apps using their ChatGPT plan, including private and open-source clients. An app has no separate allowance. | [Accounts and sessions: Tracking usage](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions#tracking-usage) |
| Documented | The five-hour usage limit does not apply to Pro users. | [Accounts and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions#tracking-usage) |
| Inferred | The Pro statement concerns that particular limit; it does not establish an absence of every possible restriction. | Same source; scope interpretation. |
| Documented | Users can review app usage and set each app's limits in ChatGPT Settings → Usage. | [Accounts and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions#tracking-usage) |
| Documented | Place a Manage usage link near the usage summary; indicate when the ChatGPT plan is being used. | [UI/UX guidelines](https://developers.openai.com/siwc/ui-ux-guidelines#link-to-chatgpt-usage) |

## App Server: documented fields

**Documented.** The following names come from [Codex App Server: Rate limits and Token usage](https://learn.chatgpt.com/docs/app-server#6-rate-limits-chatgpt). **Documented example values only:** values associated with `usedPercent`, `windowDurationMins`, `resetsAt` and `rateLimitsByLimitId` are illustrative, not observations of this user's account. Values are omitted here.

| Method | Documented fields |
| --- | --- |
| `account/rateLimits/read` | Request: `method`, `id`. Response: `id`, `result`. Result: `rateLimits`, `rateLimitsByLimitId`, `rateLimitResetCredits`. |
| Bucket fields | `limitId`, `limitName`, `primary`, `secondary`, `rateLimitReachedType`; field notes also identify `planType`, `credits` when returned. Window fields: `usedPercent`, `windowDurationMins`, `resetsAt`. |
| `rateLimitResetCredits` | `availableCount`, `credits`; detail fields: `id`, `resetType`, `status`, `grantedAt`, `expiresAt`, `title`, `description`. |
| `account/rateLimits/updated` | Notification: `method`, `params`. Example params: `rateLimits` containing `limitId`, `primary`; primary contains `usedPercent`, `windowDurationMins`, `resetsAt`. |
| `account/usage/read` | Request: `method`, `id`. Response: `id`, `result`. Result: `summary`, `dailyUsageBuckets`. Summary: `lifetimeTokens`, `peakDailyTokens`, `longestRunningTurnSec`, `currentStreakDays`, `longestStreakDays`. Bucket: `startDate`, `tokens`. |

**Documented.** `rateLimits` is the compatibility view; `rateLimitsByLimitId`, when present, maps metered identifiers to buckets. `resetsAt` uses Unix seconds. Earned-reset details can be null or capped; `availableCount` is authoritative. Usage-summary metrics and daily buckets may be null. Usage reads require Codex-services-backed authentication. The notification example is not a complete schema. [App Server](https://learn.chatgpt.com/docs/app-server#6-rate-limits-chatgpt)

**Unknown.** These sections do not specify the nested shape of bucket-level `credits`; it must not be invented from the separately documented earned-reset `credits` list.

## Errors and authentication tokens

**Documented.** `subscription_sharing_usage_limit_exceeded` (HTTP 429) means pause new ChatGPT-plan requests and direct the user to Usage settings. It does not by itself establish that the whole plan is exhausted or when it resets; an app limit may apply. `subscription_sharing_usage_unavailable` (HTTP 503) calls for bounded backoff. [Errors and recovery](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery#structured-responses-errors)

**Documented.** The Token reference describes authentication-token response fields, lifetimes and claims. It says to treat OpenAI authentication metadata as opaque. [Token reference](https://developers.openai.com/siwc/token-sharing-open-source/token-reference)

**Inferred.** Authentication-token lifetimes are not quota windows or inference-token counts. Do not derive remaining allowance from token expiry or decode opaque metadata to estimate usage.

## Unknowns reserved for an approved account check

All three questions below are **Unknown**. No authenticated requests were made for this document:

- What a real Plus account returns from the two reads and the rate-limit notification.
- Whether, and in which field, an app-specific limit appears. Multiple buckets alone do not establish that a bucket is an app limit.
- Whether equivalent Aitiarch and Codex CLI requests consume the same allowance. Local token totals alone cannot establish equal allowance cost.

Model names, message estimates and credit rates are intentionally excluded. Do not add them until the user verifies them against OpenAI's pricing page. No dollar conversion is proposed.

## Proposed usage panel

The following is **Inferred design**, constrained by the user's requirements; it is not a claim about an implemented feature or an OpenAI accounting guarantee.

- Show **Aitiarch activity**: count calls dispatched by Aitiarch and aggregate only token counts actually supplied in each response's usage fields. Associate updates with the same local request so streaming and final events cannot double-count it. Separate successful, failed and cancelled calls; absent token usage is **unavailable**, not zero. Retain provider identity and distinguish input/output or other categories only when actually supplied. Do not add a total to its component counts.
- Keep those local totals separate from any future account-wide readings. Label scope and last-updated time. Never turn percentages, tokens or example data into a remaining-requests estimate. Never show a dollar price.
- If ChatGPT-plan use is enabled in a separately approved future integration, show: “Using your ChatGPT plan can consume your allowance, shared with other apps. Review plan and app limits in ChatGPT Settings → Usage.” Place [Manage usage — ChatGPT Settings → Usage](https://chatgpt.com/settings/usage) beside the summary. Do not imply that today's Claude requests use that plan. The link target is the one supplied by the [UI/UX guidelines](https://developers.openai.com/siwc/ui-ux-guidelines#link-to-chatgpt-usage); it was not opened with an account.
- Automatic requests stay **Off** by default. If enabled in a later approved phase, require a user-set hourly call cap and check it before dispatch, including retries and concurrent calls. Display the local cap separately from OpenAI limits. This document does not enable proactive requests or begin Phase 2b.
- On a usage-limit error, pause affected requests and offer Manage usage. Show unavailable or stale account data honestly; do not infer a reset time or silently switch providers or billing paths. This follows [Errors and recovery](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery#structured-responses-errors).
- Store only accounting metadata needed for these counters. Do not put prompts, transcript text, credentials or account-token payloads into the repository, logs or ledger.

Execution boundary: this task reads public documentation only. No code changes, account login, credential access, App Server account calls or model calls are needed or authorized. Stop and report before any future step requiring credentials or a live call. This document does not authorize that testing.
