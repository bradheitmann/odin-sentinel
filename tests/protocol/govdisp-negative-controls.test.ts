import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  appendRegistryEvent,
  queryRegistryEvents
} from "../../src/protocol/event-registry/index.js";
import {
  appendGovernanceOverheadEvent,
  evaluateAttemptCeiling,
  evaluateMetaGovernanceDepth,
  evaluateOverheadBudget,
  GOVERNANCE_OVERHEAD_BUDGET,
  recordBudgetExhaustion,
  type GovdispRegistryStoreLike
} from "../../src/protocol/service.js";

describe("govdisp Wave-1 required negative controls (odin-scp-applicable)", () => {
  it(
    "Control 4: Reset/restaff/requeue/rename after attempt three — Wave-1 must refuse attempt four with ATTEMPT_REFUSED",
    () => {
      // Wave-1: immutable attempt accounting derives ATTEMPT_REFUSED when the
      // attempt_index exceeds 3 for the same stable_objective_id across resets,
      // restaffs, requeues, renames, cures, and reruns. The ceiling binds to the
      // immutable stable_objective_id, so no laundering vector resets the count.
      const store: GovdispRegistryStoreLike = { appendRegistryEvent, queryRegistryEvents };
      const base = mkdtempSync(join(tmpdir(), "odin-govdisp-control4-"));
      try {
        const scope = "control-4";
        const objective = "obj-control-4";
        let sequence = 0;
        const appendAttempt = (trigger: string): void => {
          sequence += 1;
          const result = appendRegistryEvent(scope, {
            schema_version: "govdisp.event.v1",
            event_id: `evt-c4-${sequence}`,
            ts: "2026-08-23T00:00:00Z",
            stable_objective_id: objective,
            event_class: "ATTEMPT",
            event_type: "ATTEMPT_STARTED",
            trigger
          }, base);
          expect(result.ok).toBe(true);
        };

        // Three attempts spent (start, then a reset and a restaff); the ceiling is 3.
        appendAttempt("start");
        appendAttempt("reset");
        appendAttempt("restaff");

        // Attempt four arrives via a requeue/rename-style vector and is refused by name.
        const refused = evaluateAttemptCeiling(store, scope, objective, "rename", base);
        expect(refused.ok).toBe(true);
        if (!refused.ok) return;
        expect(refused.permitted).toBe(false);
        if (refused.permitted) return;
        expect(refused.refusal.name).toBe("ATTEMPT_REFUSED");
        expect(refused.refusal.code).toBe("attempt_ceiling");
        expect(refused.refusal.stable_objective_id).toBe(objective);
        expect(refused.refusal.attempt_index).toBe(4);
        expect(refused.refusal.ceiling).toBe(3);
        expect(refused.refusal.trigger).toBe("rename");
      } finally {
        rmSync(base, { recursive: true, force: true });
      }
    }
  );

  it(
    "Control 5: Governance task audits its own audit at depth two — Wave-1 must emit named BREAK_GLASS_RECORDED refusal",
    () => {
      // Wave-1: GD-DEC-001 caps meta-governance depth at one audited layer.
      // Any audit-of-audit requires a machine-recorded break-glass event and
      // human authority; without it, the attempt must be refused.
      //
      // Landed (SLICE-GOVDISP-DEPTH-DEV-001): evaluateMetaGovernanceDepth
      // derives audit depth statelessly from the registry and REFUSES a depth-2
      // audit-of-audit with a named meta_governance_depth refusal unless a
      // valid BREAK_GLASS_RECORDED event (authorizing_human + named concrete
      // contradiction) is recorded for the same stable_objective_id.
      const store: GovdispRegistryStoreLike = { appendRegistryEvent, queryRegistryEvents };
      const base = mkdtempSync(join(tmpdir(), "odin-govdisp-control5-"));
      try {
        const scope = "control-5";
        const objective = "obj-control-5";
        let sequence = 0;
        const nextId = (prefix: string): string => {
          sequence += 1;
          return `evt-c5-${prefix}-${sequence}`;
        };

        // Depth 1: an audit of ordinary work is recorded (permitted under the cap).
        const firstAudit = appendRegistryEvent(scope, {
          schema_version: "govdisp.event.v1",
          event_id: nextId("audit"),
          ts: "2026-08-23T00:00:00Z",
          stable_objective_id: objective,
          event_class: "AUDIT",
          event_type: "AUDIT_OPENED",
          target: { kind: "ordinary_work" }
        }, base);
        expect(firstAudit.ok).toBe(true);
        if (!firstAudit.ok) return;
        const firstAuditId = firstAudit.event.event_id;

        // Depth 2 with no break-glass recorded: refused by name.
        const refused = evaluateMetaGovernanceDepth(
          store, scope, objective,
          { kind: "audit", target_event_id: firstAuditId },
          base
        );
        expect(refused.ok).toBe(true);
        if (!refused.ok) return;
        expect(refused.permitted).toBe(false);
        if (refused.permitted) return;
        expect(refused.refusal.name).toBe("AUDIT_REFUSED");
        expect(refused.refusal.code).toBe("meta_governance_depth");
        expect(refused.refusal.stable_objective_id).toBe(objective);
        expect(refused.refusal.depth).toBe(2);
        expect(refused.refusal.cap).toBe(1);
        expect(refused.refusal.detail).toContain("BREAK_GLASS_RECORDED");

        // With a machine-recorded BREAK_GLASS_RECORDED event carrying human
        // authority and a named contradiction, the same re-audit is permitted.
        const breakGlass = appendRegistryEvent(scope, {
          schema_version: "govdisp.event.v1",
          event_id: nextId("bg"),
          ts: "2026-08-23T00:00:00Z",
          stable_objective_id: objective,
          event_class: "BREAK_GLASS",
          event_type: "BREAK_GLASS_RECORDED",
          authorizing_human: "operator",
          contradiction_ref: "GDR-20260823-control5"
        }, base);
        expect(breakGlass.ok).toBe(true);
        if (!breakGlass.ok) return;

        const permitted = evaluateMetaGovernanceDepth(
          store, scope, objective,
          { kind: "audit", target_event_id: firstAuditId },
          base
        );
        expect(permitted.ok).toBe(true);
        if (!permitted.ok) return;
        expect(permitted.permitted).toBe(true);
        if (!permitted.permitted) return;
        expect(permitted.authorized_by).toBe("break_glass");
        expect(permitted.break_glass_event_id).toBe(breakGlass.event.event_id);
      } finally {
        rmSync(base, { recursive: true, force: true });
      }
    }
  );

  it(
    "Control 6: Exceed governance-overhead budget with no outcome transition — Wave-1 must emit TERMINAL_BLOCKED with no new proof chain",
    () => {
      // Wave-1: GD-DEC-002 enforces a governance-overhead budget per stable
      // objective. Crossing the budget must emit one TERMINAL_BLOCKED event
      // instead of spawning additional proof or control work.
      //
      // Landed (SLICE-GOVDISP-BUDG-DEV-001): evaluateOverheadBudget derives the
      // overhead count statelessly and refuses at exhaustion with a named
      // governance_overhead_budget refusal; recordBudgetExhaustion appends
      // EXACTLY ONE TERMINAL_BLOCKED (the invariant is derived — a second call
      // is refused terminal_already_recorded); once terminally blocked, further
      // governance-overhead appends are refused objective_terminally_blocked.
      const store: GovdispRegistryStoreLike = { appendRegistryEvent, queryRegistryEvents };
      const base = mkdtempSync(join(tmpdir(), "odin-govdisp-control6-"));
      try {
        const scope = "control-6";
        const objective = "obj-control-6";

        // Spend the entire governance-overhead budget on attempts with zero
        // outcome transitions: nothing but overhead exists for the objective.
        for (let sequence = 1; sequence <= GOVERNANCE_OVERHEAD_BUDGET; sequence += 1) {
          const attempt = appendRegistryEvent(scope, {
            schema_version: "govdisp.event.v1",
            event_id: `evt-c6-${sequence}`,
            ts: "2026-08-23T00:00:00Z",
            stable_objective_id: objective,
            event_class: "ATTEMPT",
            event_type: "ATTEMPT_STARTED",
            trigger: "start"
          }, base);
          expect(attempt.ok).toBe(true);
        }

        // The budget is exhausted: the next overhead event is refused by name.
        const evaluation = evaluateOverheadBudget(store, scope, objective, base);
        expect(evaluation.ok).toBe(true);
        if (!evaluation.ok) return;
        expect(evaluation.permitted).toBe(false);
        if (evaluation.permitted) return;
        expect(evaluation.refusal.name).toBe("GOVERNANCE_OVERHEAD_BUDGET_REFUSED");
        expect(evaluation.refusal.code).toBe("governance_overhead_budget");
        expect(evaluation.refusal.stable_objective_id).toBe(objective);
        expect(evaluation.refusal.count).toBe(GOVERNANCE_OVERHEAD_BUDGET);
        expect(evaluation.refusal.budget).toBe(GOVERNANCE_OVERHEAD_BUDGET);

        // On breach the terminal guard appends EXACTLY ONE TERMINAL_BLOCKED.
        const recorded = recordBudgetExhaustion(store, scope, objective, {
          event_id: "evt-c6-terminal",
          ts: "2026-08-23T00:00:01Z",
          content_hashes: [{ path: "protocol/resources/governance-overhead-budget.yaml", sha256: "c".repeat(64) }]
        }, base);
        expect(recorded.ok).toBe(true);
        if (!recorded.ok) return;
        expect(recorded.appended).toBe(true);

        const terminalQuery = queryRegistryEvents(scope, { stable_objective_id: objective, event_class: "TERMINAL" }, base);
        expect(terminalQuery.ok).toBe(true);
        if (!terminalQuery.ok) return;
        expect(terminalQuery.events).toHaveLength(1);
        expect(terminalQuery.events[0].event_type).toBe("TERMINAL_BLOCKED");

        // The exactly-one invariant is derived, not stored: a second
        // exhaustion call is refused by name and appends nothing.
        const duplicate = recordBudgetExhaustion(store, scope, objective, {
          event_id: "evt-c6-terminal-2",
          ts: "2026-08-23T00:00:02Z",
          content_hashes: [{ path: "protocol/resources/governance-overhead-budget.yaml", sha256: "c".repeat(64) }]
        }, base);
        expect(duplicate.ok).toBe(true);
        if (!duplicate.ok) return;
        expect(duplicate.appended).toBe(false);
        if (duplicate.appended) return;
        expect(duplicate.refusal.code).toBe("terminal_already_recorded");
        expect(duplicate.refusal.existing_event_id).toBe("evt-c6-terminal");

        // Subsequent proof appends are refused: no new proof chain can start.
        const proofAppend = appendGovernanceOverheadEvent(store, scope, {
          schema_version: "govdisp.event.v1",
          event_id: "evt-c6-proof",
          ts: "2026-08-23T00:00:03Z",
          stable_objective_id: objective,
          event_class: "AUDIT",
          event_type: "AUDIT_OPENED",
          target: { kind: "ordinary_work" }
        }, base);
        expect(proofAppend.ok).toBe(true);
        if (!proofAppend.ok) return;
        expect(proofAppend.appended).toBe(false);
        if (proofAppend.appended) return;
        expect(proofAppend.refusal.code).toBe("objective_terminally_blocked");

        // The log holds exactly the spent budget plus the one terminal event:
        // the terminal event spawned no new proof or control work.
        const finalQuery = queryRegistryEvents(scope, { stable_objective_id: objective }, base);
        expect(finalQuery.ok).toBe(true);
        if (!finalQuery.ok) return;
        expect(finalQuery.events).toHaveLength(GOVERNANCE_OVERHEAD_BUDGET + 1);
      } finally {
        rmSync(base, { recursive: true, force: true });
      }
    }
  );

  it.skip(
    "Control 7: Ordinary planning emits no Markdown or human view by default — Wave-1 must refuse default human-view generation",
    () => {
      // Wave-1: GD-DEC-12 prohibits rendering or storing human-readable registry
      // views by default. Ordinary planning must not produce Markdown or other
      // human views unless explicitly requested.
    }
  );

  it.skip(
    "Control 8: Explicit human-view request requires requested_by plus registry digest binding — Wave-1 must validate binding before emitting view",
    () => {
      // Wave-1: GD-DEC-12 requires requested_by and source_registry_digest to be
      // recorded when a human view is explicitly requested. Without both fields
      // the view generation must be refused.
    }
  );

  it.skip(
    "Control 9: Finding without owner or delivery event remains inactive and non-closable — Wave-1 must refuse FINDING_CLOSED without FINDING_OWNED and FINDING_DELIVERED",
    () => {
      // Wave-1: GD-DEC-005 states a finding is not active until it has an
      // accountable owner and delivery event. A finding lacking both must remain
      // inactive and must not be closable.
    }
  );

  it.skip(
    "Control 10: Unwired enforcement hook or unknown role/tool — Wave-1 must fail-closed with refusal",
    () => {
      // Wave-1: GD-DEC-10 requires authenticated, fail-closed hooks. An unknown
      // role, tool, artifact kind, or hook registration state must be denied.
    }
  );
});
