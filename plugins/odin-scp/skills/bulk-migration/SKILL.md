---
name: bulk-migration
description: "odin-scp-integrated cascade of ONE change across MANY targets under SCP governance: federated pod per target, boot receipts + delegation receipts + CMUX delivery proof, exec-gated commit (TEAM-PM cannot self-authorize), independent adversarial QA per target, a live control-panel dashboard, count-agnostic preservation, harness message-format matrix, blocked-target rollover (Team B→F), and pre-staged model-pinned exec/pod continuity. Use when the same governed change must land on a known target set and every landing must be SCP-claim-bound and independently verified."
version: 1.0.0
updated: 2026-06-20
---

# bulk-migration (odin-scp-integrated)

Runs a verified fleet cascade **inside the SCP control plane**. It binds the generic bulk-migration
procedure to odin-scp primitives: minimal boot receipts, terminal-locator identity, `[SCP-DELEGATE]`
receipts, CMUX delivery proof, adversarial QA verdicts, and claim-bound closure.

**Companion:** the **standalone** form lives in `edge_agentic_orchestration_system/src/skills/bulk-migration/`
(self-contained, odin-scp-*compatible*). That form holds the domain-generality table (software / data /
ML-AI / sysadmin / device-fleet / mobile), the five-object model, the five invariants, the failure-mode
table, and the worked `references/control-panel.py` dashboard. **Read it for the domain model; read THIS
for the SCP bindings.** Keep the two synchronized — edit the declared source first, then propagate.

Origin: RFC v2.3 hookchain sync across 18 repos (2026-06-20), run by a droid TEAM-PM + claude DEV +
pi QA pod under an A/EXEC-ODIN that was itself a mid-sweep continuation after the first EXEC died.

## When to use

Introduce this skill when the operator asks to **apply one change across many SCP-governed targets** with
per-target branch-visible + QA-accepted proof and zero collateral damage — e.g. propagating a governance
hook, a config, a migration, or a policy bundle across a repo/host/device fleet.

## SCP role bindings

| bulk-migration step | SCP role / artifact |
|---|---|
| Owns the cascade, surface/staffing custody, per-target rotation | **A/EXEC-ODIN** |
| Owns the roster (operator/Team-A-EXEC modify only) | **A/EXEC-PM** |
| Routes the per-target pod loop; relays readiness; may NOT self-authorize the commit | **TEAM-PM** (`pod_control`) |
| Applies the change with an explicit minimal selector | **DEV** (`implementation`) |
| Independent adversarial verify; emits the only valid verdict | **QA** (`quality`, read-only) |
| Each seat boots to a role-declaring receipt and holds | **SCP boot receipt** → `BOOTSTRAPPED_IDLE` |
| Activation + per-target instructions | **`[SCP-DELEGATE]`** |
| Delivery is proven, not assumed | **CMUX delivery proof** (`send` + submit + read-back) |
| Closure is branch-visible AND QA-accepted | **claim-bound closure** |

## The exec-gated commit cadence (the load-bearing SCP pattern)

The TEAM-PM must NOT authorize the persist. Per target:

1. **A/EXEC-ODIN resets the pod into the target** (quit → cd target → relaunch → boot → context → delegate) so each seat loads the target's native gates. EXEC owns this; PM does not spawn/move surfaces.
2. **TEAM-PM audit** (read-only): preconditions hold. HALT+escalate ONLY if a TARGET artifact is wrong — not on collateral-state count drift (see Count-agnostic preserve).
3. **TEAM-PM dispatches DEV** to apply with an **explicit minimal selector** (exact pathspec / scoped migration) — never a blanket selector.
4. **TEAM-PM activates QA** (independent, read-only) → real `B_QA_VERDICT` (PASS/FAIL). The PM may not stand in for QA.
5. **TEAM-PM double-checks + reports `STAGED-READY-FOR-ODIN`** with the QA verdict, then HOLDS. No commit.
6. **A/EXEC-ODIN independently re-verifies ground truth** (verify + preserve contracts from scratch) → issues **`COMMIT-AUTHORIZED`**.
7. **DEV commits** — the native pre-commit chain MUST run (never `--no-verify`); self-verifies it landed.
8. **A/EXEC-ODIN re-verifies the persisted artifact** (committed blob == canonical, parent correct, preserve intact) → updates the dashboard → rotates to the next target.

This maps cleanly onto an SCP delegation mode `commit_gate: exec`. Until odin-scp ships that field, carry
the gate explicitly in the `[SCP-DELEGATE]` (the PM stages + QA-verifies + reports STAGED-READY + WAITS;
the EXEC's `COMMIT-AUTHORIZED` is required).

## Harness message-format matrix (CMUX delivery)

Extends the 2026-06-13 send-vs-submit field report. Encode the recipient's format in every cross-agent instruction:

- **pi / GLM** submits on **every newline** → send **one single-line** message (` ;; ` separators). Multi-line boot contracts / QA checklists fragment and stall. (Two pi boots in the origin sweep stalled this way until re-sent single-line.)
- **droid** accepts multi-line, but a long paste during a busy transition can sit unsubmitted ("Enter to steer") → send when idle and send a **second Enter** if the first does not submit.
- **claude** accepts multi-line; its command gate scans full Bash text for bypass-flag strings → keep commit commands clean; brief API-retry self-heals.
- Always verify delivery by reading the surface back. `send` without a verified submit is undelivered.

## Count-agnostic preservation

Frame the preserve contract by EXCLUSION: "the change touches exactly {selector}; ALL other tracked
dirty/deletions + untracked are pre-existing WIP to preserve, whatever the count; STOP only if a TARGET
artifact is wrong." Booting a pod inside a target fires that target's SessionStart hooks (e.g.
intelligence-inbox routing), which can mutate collateral state AFTER any pre-scan — an enumerated
expected-state will false-halt (origin sweep: ariadne gained a 3rd inbox deletion post-scan; the PM
correctly halted; remedy was count-agnostic framing). Capture ground truth AFTER pod bring-up.

## Blocked-target rollover (Team B → F)

- A pod BLOCKED needing operator input → **pause it, spin up the next team letter** (B→C→D→E) to preserve throughput; the blocked pod's state is kept for resume.
- **STOP at Team F.** If F is also blocked, escalate to the operator.
- Rollover = a NEW SCP team (its own PM/DEV/QA on authorized harnesses/models with fresh boot receipts), never a re-staffing of the blocked seat.

## Exec / pod continuity (pre-stage before starting — HIGH severity)

The EXEC seat or a pod role can die mid-cascade. Pre-stage fallback at BOTH levels and **pin the model**:

- **Pod-role fallback** names (a) the authorized substitute harness (if any) and (b) the REQUIRED model+flags — never the harness default (a default is chosen for the harness, not the role; it can silently seat a non-agentic model in a control role and the pod stalls invisibly). No authorized fallback → "PAUSE + escalate," not "improvise."
- **EXEC fallback** = a boot contract any authorized agent assumes the seat from, carrying the operator-locked roster, the in-flight target worklist, the canonical/verify/preserve contracts, and "no roster/harness/model change without operator authorization."

This is not hypothetical: in the origin sweep the first A/EXEC-ODIN exhausted credits AND, before that, tried to substitute unauthorized harnesses (opencode/crush) at wrong default models for failed seats — the operator stopped it. The recovery that worked: operator-locked roster, pre-staged model-pinned boot contracts, EXEC seat re-assumed via boot contract.

## odin-scp gaps this skill currently works around (fix upstream)

1. `odin_get_role_profile` rejects team-prefixed slot ids (`B/QA`) — accept the canonical slot id.
2. Team-B staffing-audit receipt fields (`staffed_by`, `parent_surface_ref`, `column_index`, `team_letter`) are not in `required_fields` — mark conditionally-required for `team != "A"`.
3. No per-harness message-format matrix — add one (this skill carries the interim).
4. No `commit_gate: exec` delegation mode — this skill carries the gate explicitly.
5. No active detection of a TEAM-PM self-asserting QA — make QA-independence a restated boot-block constraint and have the EXEC verify a real verdict before authorizing.

See the companion field report `2026-06-20-rfc-v23-hookchain-sweep-odin-scp-field-report.md` for full detail.

## Procedure (SCP-bound)

0. **Scope** — enumerate the target set; write the change spec (+ canonical source), the deterministic verify contract, and the count-agnostic preserve contract.
1. **Stand up the control-panel dashboard** (companion `references/control-panel.py`); re-audit live, print `Counts:`, update after every commit.
2. **Order targets** easy→hard; outliers last.
3. **Per target**, run the exec-gated cadence above under SCP boot receipts + `[SCP-DELEGATE]` + CMUX delivery proof; capture per-target LEARNINGS/NEW_METHODS.
4. **On completion**, reconcile `Counts:` to N (no silent truncation) and file a field report to the coordinating inbox.

## Non-negotiables (inherited from odin-scp)

- Claim-bound closure: branch-visible persistence AND QA-accepted correctness. A summary/liveness check is not QA.
- Interchangeable by role, not by blurred authority: any harness may serve a role only after a clean boot block; the same seat must not QA and close its own work.
- Strict scope + zero-secret-output. Never bypass a native gate; never print secrets.
- Drafts are drafts: do not activate skills/packages from Downloads/temp/uncommitted checkouts — land them under the canonical repo path with proof first.
