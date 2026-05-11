# Recommended Starter Team

ODIN is opinionated, but not rigid.

The profiles below are a good starting point for a visible multi-agent session.
They are not bundled dependencies. Install and configure the harnesses you want,
then point them at ODIN Sentinel through MCP.

## Executive Office

| Role | Suggested Harness | Suggested Model Class | Why |
| --- | --- | --- | --- |
| `A/EXEC-PM` | Codex CLI | GPT-5.5-class frontier reasoning model | Stable coordination, claim-bound reporting, and careful instruction handling. |
| `A/EXEC-ODIN` | Codex CLI | GPT-5.5-class frontier reasoning model | Sentinel work: staying awake, polling, quality control, and closeout hygiene. |
| `A/EXEC-ASST` | Claude Code | Claude Haiku-class fast assistant model | Low-latency ledger work, reminders, artifact indexing, and simple checks. |
| `A/EXEC-RSCH` | Droid | Kimi K2.6-class orchestration model | Research, alternatives, synthesis, and context recovery. |
| `A/EXEC-QA` | Droid | Kimi K2.6-class review model | Independent process review, evidence checks, and drift detection. |

## Development Pod

| Role | Suggested Harness | Suggested Model Class | Why |
| --- | --- | --- | --- |
| `<TEAM>/TEAM-PM` | Claude Code | Claude Opus/Sonnet-class coding model | Pod orchestration, task decomposition, dispatch, and worker follow-up. |
| `<TEAM>/ODIN` | Codex CLI | GPT-5.5-class frontier reasoning model | Lightweight pod sentinel duties, blocker detection, and quality reminders. |
| `<TEAM>/DEV-1` | Droid | Kimi K2.6-class coding model | Bounded implementation work. |
| `<TEAM>/QA-1` | Crush | GLM-5.1-class independent review model | Independent QA with a different review style from the implementer. |
| `<TEAM>/SHADOW-1` | Droid | Kimi K2.6-class review model | Second-pass critique, architectural concerns, and risk surfacing. |

## Notes

Use faster models for ledger work, routine research, and low-risk monitoring.
Use stronger models for coordination, implementation, QA, and places where the
cost of a missed detail is high.

The defaults live in `protocol/model-profiles.yaml`. Change them freely.
