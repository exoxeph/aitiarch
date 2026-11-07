# Minimal dogfood execution plan

**Goal:** Run the approved Markdown -> requested assistance -> comparison -> human
decision -> edit -> advisory resurfacing loop in `<project>`.
**Spec:** [Approved MVP proposal](2026-11-06-minimal-aitiarch-mvp.md).
**Architecture:** Small Python command reuses the transcript parser and evidence
validator; dependency-free Node hook quotes accepted Markdown records. No UI,
server, MCP, automatic proactive calls, rationale writer or transcript upload.

The user approved execution once paths were confirmed; that condition is met.
Execute inline. Source lives in `<aitiarch-source>\prototype`; the dogfood repository
receives ignored local Markdown and a local Claude hook setting only. No site
source, existing untracked assets, existing notebook text or remote state changes.
No worktree is required for the non-Git Aitiarch source workspace or ignored
local dogfood setup. No commits or new dependencies.

- [x] Add failing regression tests for initialization preserving existing files,
  request preview making no model call, allowed source paths, exact quotes/known
  references/inline citations, blank human rationale, explicit session selection,
  and fail-open accepted-only exact-path hooks.
- [x] Implement `prototype/aitiarch.py`: init/new/ask/context/feedback/report.
  Ask previews selected notebook/decision passages; only explicit `--send` invokes
  Claude, tool-free and nonpersistent. No transcript upload option. Save private
  outputs and latency/usage locally. Reject invalid evidence before displaying.
- [x] Implement `prototype/pre-tool-use.cjs`: fixed repository argument, accepted
  records only, literal relative path matching, quote source text unchanged,
  bounded context, no permission decision. Record local hook metrics.
- [x] Run new regressions plus all 57 historical tests. Install locally only
  after checks pass, preserving existing settings and private ignore rules.
- [x] Measure process/body timing with clearly labeled mechanical probes; leave
  actual usefulness feedback ungraded until the developer uses the workflow.
- [x] Document exact commands, privacy boundaries, remaining limits, archive
  accessibility and approved/proposed status. Preserve frozen prompt evidence.

Review focus: symlink/path escape, existing settings and notebook preservation,
untrusted source text, malformed model/hook output, measuring technical probes
without claiming human learning or usefulness. Tests cover the first four;
measurement provenance distinguishes smoke probes from real user feedback.

Executed inline. 18 prototype + 57 historical + 59 site tests pass. One real
requested assistance call completed, with frozen output and usage; no transcript
transmission. Accepted decisions and human feedback remain zero. The complete
human decision/edit/resurface loop and live fresh-session hook receipt are still
unobserved; technical fixtures are not counted as actual use.
