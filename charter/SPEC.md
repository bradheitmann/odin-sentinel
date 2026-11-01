# charter — the contract (SPEC)

Version: `charter v1`. This document is normative: where a file, the binary, and this document disagree, the disagreement is a defect in one of them. How this version bumps is defined in [GOVERNANCE.md](GOVERNANCE.md).

## The object

A project under charter carries a `charter/` directory that makes the questions research never asks (cost, bound, proof, owner, stop) mandatory, in writing, before design, before dispatch and before "done".

## The files (normative)

| File | Required content | Enforced by |
|---|---|---|
| `charter/charter.toml` | `charter_version = "1"`; optional `spec_version` (must equal the binary's supported spec); `project`; `owner`; `[slice_zero]` description/command/`proven_on`; `[verification_budget]` qa_attempts_per_slice, repair_cycles_per_slice, review_families_required | `check`, `check --strict` (schema) |
| `charter/INTENT.md` | the intent card: underlying job (not symptom), beneficiary, situation, outcome, non-goals, 3 guarantees, largest uncertainty, premise check; no template bullet left valueless | `check` |
| `charter/GUARANTEES.yaml` | a list; each entry: `id`, `statement`, `owner`, `proof`, `cost_per_run`, `if_dropped`, `status`; `proven` requires proof + cost (contract layer) and every entry requires owner/proof/cost (strict layer) | `check`, `check --strict` |
| `charter/LOOPS.yaml` | a list; each entry: `id`, `where`, `trigger`, `bound`, `cost_per_trip`, `stop_condition`, `who_decides_extension`; optional integer `trips` (a loop past its bound's leading number is a strict refusal) | `check`, `check --strict` |
| `charter/STOP-RULES.md` | rules identified `S<n>`, unique, one per line | `check` (change requires an owner decision), `check --strict` (hygiene) |
| `charter/DONE/<slice>.md` | the numbered proof list, written before dispatch, never grown during it; each proof names a reopen step and a fail-without mutant; accepted slices carry `reopened: <run-id> <sha256>` markers | `check --strict`, `gate`, `receipt` |
| `charter/STATE.md` | leave-state: proven/not proven, last-green/last-red commands, next three bounded items, open owner decisions; a recorded HEAD at most `max_commits_behind` (default 20) commits behind; rewritten after every acceptance | `check`, `check --strict` |
| `charter/owner-decisions/<date>-<slug>.md` | an owner decision; a relaxation (`relaxes: S<n>`) needs two distinct `approved_by:` signers | `check` |
| `charter/.dispatch/<slice>.{sha256,json}` | the dispatch pin: DONE hash, brief sha256, base commit, acceptance state | `gate`, `check` |
| `charter/.freeze/<slice>.json` | the frozen bytes: head, manifest sha256, per-file hashes, the green CI run | `freeze`, `receipt --verify-tree` |
| `charter/COST.jsonl` | one JSON row per cost record (schema `charter.cost/1`); never fabricated | `cost`, `check --strict` (warning) |

## The commands (normative exit codes)

Every command exits 0 on success, 1 on a typed refusal (the refusal text names the file, rule, proof, or loop), 2 on usage errors.

- `charter check [--strict]` — contract validity; strict adds schemas, proof discipline, loop bounds, rule hygiene, spec version.
- `charter state --write` — regenerates STATE.md's git facts, preserving hand-written sections.
- `charter gate <slice> --dispatch [--brief <file>]` — pins the DONE hash, brief sha and base commit; contract must pass.
- `charter gate <slice> --accept [--receipt <file>]` — refuses DONE drift and receipt citation mismatch; records `state: accepted`.
- `charter freeze <slice>` — records the tree manifest.
- `charter receipt <file> [--verify-tree <dir>] [--allow-same-family <decision>]` — validates a `charter.receipt/1` receipt (a pre-rename legacy receipt id is still accepted as an alias); accepted verdicts require no critical/high defect, every proof reopened and marked, frozen-bytes citation, and a verifier model family different from the author's.
- `charter loops audit` — trips vs bounds, with the ledger's totals.
- `charter cost add|show` — the cost ledger.
- `charter brief <role> [slice]` — a role contract with the charter embedded.
- `charter init [--intent-file <file>] [--project <name>] [--checklist]` — scaffold; `--checklist` prints the adoption steps.
- `charter sync-agents`, `charter hooks install [--force]`, `charter decision new <slug>`.

## What "done" means (normative)

Done is every proof in the slice's DONE list executed, its run reopened from the frozen bytes and compared, the tree frozen, the gate accepted, the STATE rewritten, and the Linux CI run on the frozen bytes green. "No findings" is never done.
