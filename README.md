# Aitiarch

A local-first decision notebook for understanding and defending architectural
choices made while coding with AI. This workspace contains feasibility tools
and a local notebook UI with separately stored ink and explicit Claude assistance.
See [UI setup and fixture checks](ui/README.md). Proactive requests remain off.

- [BRIEF.md](BRIEF.md): original vision and human-owned decision principles.
- [JOURNEY.md](JOURNEY.md): chronological engineering account and measured lessons.
- [NOTES.md](NOTES.md): technical findings and unresolved issues; earlier sections
  are historical snapshots.
- [Approved minimal MVP plan](docs/superpowers/plans/2026-11-06-minimal-aitiarch-mvp.md).
- [Final validation](spike/INTERVENTION-V3-VALIDATION.md) and
  [unblinded comparison](spike/INTERVENTION-V3-COMPARISON.md).
- [Archive and restoration](ARCHIVE.md), [cleanup audit](CLEANUP-AUDIT.md), and
  [verification](CLEANUP-VERIFICATION.md).

Prompt experiments are frozen. A remains the experimental baseline; B is not
adopted. Proactive comments are disabled. The user approved the minimal defaults
and selected `<project>`, with `.aitiarch/notebook.md` and
`.aitiarch/decisions/`. No prototype transcript transmission is authorized.
The long-term notebook, inline assistance, branching and learning vision remains
intact. Read [prototype/README.md](prototype/README.md) for commands and NOTES.md for measurements.

`spike/` retains the tested transcript bridge, advisory hook fixture, validators,
historical experiment tooling and eight regression-test modules. Historical
scripts and examples in [spike/README.md](spike/README.md) describe past execution;
they are not authorization to rerun model calls, resume conversations, regenerate
review keys or overwrite frozen outputs. Artifact-dependent verifiers require
restoring the archive to a separate local directory first.

Run the retained offline suite from this directory:

```powershell
python -B -m unittest discover -s spike -p 'test_*.py' -v
node --check spike/pre-tool-use.cjs
```

The suite requires Python and Node, makes no model calls and creates no canonical
decisions. Keep transcripts and evaluation evidence local. Existing ignore rules
for results, scratch files and bytecode remain unchanged.
