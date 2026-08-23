import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendRegistryEvent,
  queryRegistryEvents
} from "../../src/protocol/event-registry/index.js";
import {
  appendGovernanceOverheadEvent,
  BUDGET_NOT_EXHAUSTED_CODE,
  deriveOverheadAccounting,
  evaluateOverheadBudget,
  GOVERNANCE_APPEND_REFUSAL_NAME,
  GOVERNANCE_OVERHEAD_BUDGET,
  GOVERNANCE_OVERHEAD_BUDGET_CODE,
  OBJECTIVE_TERMINALLY_BLOCKED_CODE,
  OVERHEAD_BUDGET_REFUSAL_NAME,
  recordBudgetExhaustion,
  TERMINAL_ALREADY_RECORDED_CODE,
  TERMINAL_BLOCKED_REFUSAL_NAME,
  type AppendGovernanceOverheadEventResult,
  type EvaluateOverheadBudgetResult,
  type GovdispRegistryStoreLike,
  type RecordBudgetExhaustionResult
} from "../../src/protocol/service.js";

// ---------------------------------------------------------------------------
// STORY-GOVDISP-003 — governance-overhead budget + single terminal-blocked
// event.
//
// GD-DEC-002: governance overhead must terminate in exactly ONE blocked event
// instead of spawning more proof work. The budget evaluator counts
// governance-overhead events (the countable classes ATTEMPT, FINDING,
// BREAK_GLASS, AUDIT — TERMINAL and BUDGET never count) per stable objective
// and refuses at exhaustion with a named governance_overhead_budget refusal.
// The terminal guard appends EXACTLY ONE TERMINAL_BLOCKED on breach (the
// invariant is derived, not stored: a duplicate call is refused
// terminal_already_recorded). Once terminally blocked, further
// governance-overhead appends are refused objective_terminally_blocked via the
// service-layer guard; storage stays shape-only. Every evaluator is a pure,
// stateless derivation over the append-only registry.
//
// These tests use the REAL registry storage module (temp-dir base) injected
// into the service layer, mirroring tests/protocol/govdisp-depth.test.ts.
// ---------------------------------------------------------------------------

const store: GovdispRegistryStoreLike = { appendRegistryEvent, queryRegistryEvents };

const tmpRoots: string[] = [];

function makeTmpBase(): string {
  const dir = mkdtempSync(join(tmpdir(), "odin-govdisp-budget-"));
  tmpRoots.push(dir);
  return dir;
}

afterEach(() => {
  while (tmpRoots.length > 0) {
    const dir = tmpRoots.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

let eventSeq = 0;

function eventBase(objectiveId: string) {
  eventSeq += 1;
  return {
    schema_version: "govdisp.event.v1",
    event_id: `evt-budget-${eventSeq}`,
    ts: "2026-08-23T00:00:00Z",
    stable_objective_id: objectiveId
  };
}

/** Evidence binding carried by terminal records in these tests. */
const POLICY_HASH = {
  path: "protocol/resources/governance-overhead-budget.yaml",
  sha256: "b".repeat(64)
};

function attemptEvent(objectiveId: string) {
  return {
    ...eventBase(objectiveId),
    event_class: "ATTEMPT" as const,
    event_type: "ATTEMPT_STARTED" as const,
    trigger: "start" as const
  };
}

function findingEvent(objectiveId: string) {
  return {
    ...eventBase(objectiveId),
    event_class: "FINDING" as const,
    event_type: "FINDING_OPENED" as const,
    finding_id: "finding-1"
  };
}

function breakGlassEvent(objectiveId: string) {
  return {
    ...eventBase(objectiveId),
    event_class: "BREAK_GLASS" as const,
    event_type: "BREAK_GLASS_RECORDED" as const,
    authorizing_human: "operator",
    contradiction_ref: "GDR-20260823-budget"
  };
}

function auditEvent(objectiveId: string) {
  return {
    ...eventBase(objectiveId),
    event_class: "AUDIT" as const,
    event_type: "AUDIT_OPENED" as const,
    target: { kind: "ordinary_work" as const }
  };
}

function budgetCrossedEvent(objectiveId: string) {
  return {
    ...eventBase(objectiveId),
    event_class: "BUDGET" as const,
    event_type: "BUDGET_CROSSED" as const,
    budget_kind: "tokens" as const
  };
}

function terminalBlockedEvent(objectiveId: string) {
  return {
    ...eventBase(objectiveId),
    event_class: "TERMINAL" as const,
    event_type: "TERMINAL_BLOCKED" as const,
    content_hashes: [POLICY_HASH]
  };
}

function terminalCompletedEvent(objectiveId: string) {
  return {
    ...eventBase(objectiveId),
    event_class: "TERMINAL" as const,
    event_type: "TERMINAL_COMPLETED" as const,
    content_hashes: [POLICY_HASH]
  };
}

/** Append `n` raw ATTEMPT overhead increments for the objective. */
function seedOverhead(base: string, scope: string, objectiveId: string, n: number): void {
  for (let index = 0; index < n; index += 1) {
    const result = appendRegistryEvent(scope, attemptEvent(objectiveId), base);
    expect(result.ok).toBe(true);
  }
}

/** Raw-append a TERMINAL_BLOCKED for the objective; returns its event_id. */
function seedTerminalBlocked(base: string, scope: string, objectiveId: string): string {
  const result = appendRegistryEvent(scope, terminalBlockedEvent(objectiveId), base);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("unreachable");
  return result.event.event_id;
}

/** Count events for the objective, optionally of one class. */
function logSize(base: string, scope: string, objectiveId: string, eventClass?: string): number {
  const queried = queryRegistryEvents(
    scope,
    eventClass === undefined
      ? { stable_objective_id: objectiveId }
      : { stable_objective_id: objectiveId, event_class: eventClass },
    base
  );
  expect(queried.ok).toBe(true);
  if (!queried.ok) throw new Error("unreachable");
  return queried.events.length;
}

function budgetRefusalOf(result: EvaluateOverheadBudgetResult) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("unreachable");
  expect(result.permitted).toBe(false);
  if (result.permitted) throw new Error("unreachable");
  return result.refusal;
}

function budgetPermittedOf(result: EvaluateOverheadBudgetResult) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("unreachable");
  expect(result.permitted).toBe(true);
  if (!result.permitted) throw new Error("unreachable");
  return result;
}

function exhaustionAppendedOf(result: RecordBudgetExhaustionResult) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("unreachable");
  expect(result.appended).toBe(true);
  if (!result.appended) throw new Error("unreachable");
  return result;
}

function exhaustionRefusalOf(result: RecordBudgetExhaustionResult) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("unreachable");
  expect(result.appended).toBe(false);
  if (result.appended) throw new Error("unreachable");
  return result.refusal;
}

function overheadAppendedOf(result: AppendGovernanceOverheadEventResult) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("unreachable");
  expect(result.appended).toBe(true);
  if (!result.appended) throw new Error("unreachable");
  return result;
}

function overheadRefusalOf(result: AppendGovernanceOverheadEventResult) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("unreachable");
  expect(result.appended).toBe(false);
  if (result.appended) throw new Error("unreachable");
  return result.refusal;
}

// ---------------------------------------------------------------------------
// deriveOverheadAccounting — stateless pure derivation
// ---------------------------------------------------------------------------

describe("deriveOverheadAccounting (stateless derivation)", () => {
  it("derives a zero count for an objective with no events", () => {
    const base = makeTmpBase();
    const result = deriveOverheadAccounting(store, "scope-empty", "obj-empty", base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.accounting.stable_objective_id).toBe("obj-empty");
    expect(result.accounting.count).toBe(0);
    expect(result.accounting.per_class).toEqual({});
    expect(result.accounting.budget).toBe(GOVERNANCE_OVERHEAD_BUDGET);
    expect(result.accounting.remaining).toBe(GOVERNANCE_OVERHEAD_BUDGET);
    expect(result.accounting.terminal_blocked_present).toBe(false);
    expect(result.accounting.terminal_blocked_event_ids).toEqual([]);
  });

  it("counts exactly the countable classes with a per-class breakdown", () => {
    const base = makeTmpBase();
    const scope = "scope-classes";
    const objective = "obj-classes";
    expect(appendRegistryEvent(scope, attemptEvent(objective), base).ok).toBe(true);
    expect(appendRegistryEvent(scope, findingEvent(objective), base).ok).toBe(true);
    expect(appendRegistryEvent(scope, breakGlassEvent(objective), base).ok).toBe(true);
    expect(appendRegistryEvent(scope, auditEvent(objective), base).ok).toBe(true);

    const result = deriveOverheadAccounting(store, scope, objective, base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.accounting.count).toBe(4);
    expect(result.accounting.per_class).toEqual({ ATTEMPT: 1, FINDING: 1, BREAK_GLASS: 1, AUDIT: 1 });
    expect(result.accounting.remaining).toBe(GOVERNANCE_OVERHEAD_BUDGET - 4);
    expect(result.accounting.terminal_blocked_present).toBe(false);
  });

  it("never counts TERMINAL or BUDGET events toward the budget (countable-class boundary)", () => {
    const base = makeTmpBase();
    const scope = "scope-boundary";
    const objective = "obj-boundary";
    seedOverhead(base, scope, objective, 3);
    const terminalId = seedTerminalBlocked(base, scope, objective);
    expect(appendRegistryEvent(scope, budgetCrossedEvent(objective), base).ok).toBe(true);
    expect(appendRegistryEvent(scope, terminalCompletedEvent(objective), base).ok).toBe(true);

    const result = deriveOverheadAccounting(store, scope, objective, base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Six events in the log, but only the three overhead increments count.
    expect(logSize(base, scope, objective)).toBe(6);
    expect(result.accounting.count).toBe(3);
    expect(result.accounting.per_class).toEqual({ ATTEMPT: 3 });
    expect(result.accounting.terminal_blocked_present).toBe(true);
    expect(result.accounting.terminal_blocked_event_ids).toEqual([terminalId]);
  });

  it("is deterministic and stateless: repeated derivation over the same log is identical", () => {
    const base = makeTmpBase();
    const scope = "scope-derive-det";
    const objective = "obj-derive-det";
    seedOverhead(base, scope, objective, 5);

    const first = deriveOverheadAccounting(store, scope, objective, base);
    const second = deriveOverheadAccounting(store, scope, objective, base);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.accounting).toEqual(first.accounting);
  });

  it("fails closed with a named rejection when the store, scope, or objective is unusable", () => {
    const noStore = deriveOverheadAccounting({} as never, "scope-x", "obj-x");
    expect(noStore.ok).toBe(false);
    if (noStore.ok) return;
    expect(noStore.rejections[0].code).toBe("store_unavailable");

    const badScope = deriveOverheadAccounting(store, "", "obj-x");
    expect(badScope.ok).toBe(false);
    if (badScope.ok) return;
    expect(badScope.rejections[0].field).toBe("scope");

    const badObjective = deriveOverheadAccounting(store, "scope-x", "  ");
    expect(badObjective.ok).toBe(false);
    if (badObjective.ok) return;
    expect(badObjective.rejections[0].field).toBe("stable_objective_id");
  });
});

// ---------------------------------------------------------------------------
// evaluateOverheadBudget — under-budget permits, exhaustion refuses by name
// ---------------------------------------------------------------------------

describe("evaluateOverheadBudget (budget verdicts)", () => {
  it("permits under budget with the remaining count", () => {
    const base = makeTmpBase();
    const scope = "scope-under";
    const objective = "obj-under";
    seedOverhead(base, scope, objective, 2);

    const permitted = budgetPermittedOf(evaluateOverheadBudget(store, scope, objective, base));
    expect(permitted.stable_objective_id).toBe(objective);
    expect(permitted.count).toBe(2);
    expect(permitted.budget).toBe(GOVERNANCE_OVERHEAD_BUDGET);
    expect(permitted.remaining).toBe(GOVERNANCE_OVERHEAD_BUDGET - 2);
    expect(permitted.accounting.terminal_blocked_present).toBe(false);
  });

  it("refuses by name at exhaustion: count == budget leaves no room for another overhead event", () => {
    const base = makeTmpBase();
    const scope = "scope-breach";
    const objective = "obj-breach";
    seedOverhead(base, scope, objective, GOVERNANCE_OVERHEAD_BUDGET);

    const refusal = budgetRefusalOf(evaluateOverheadBudget(store, scope, objective, base));
    expect(refusal.name).toBe(OVERHEAD_BUDGET_REFUSAL_NAME);
    expect(refusal.code).toBe(GOVERNANCE_OVERHEAD_BUDGET_CODE);
    expect(refusal.code).toBe("governance_overhead_budget");
    expect(refusal.stable_objective_id).toBe(objective);
    expect(refusal.count).toBe(GOVERNANCE_OVERHEAD_BUDGET);
    expect(refusal.budget).toBe(GOVERNANCE_OVERHEAD_BUDGET);
    expect(refusal.event_class).toBe("BUDGET");
    expect(refusal.field).toBe("overhead_count");
    expect(refusal.detail).not.toBe("");
    expect(refusal.detail).toContain("recordBudgetExhaustion");
    expect(Object.keys(refusal).sort()).toEqual([
      "budget",
      "code",
      "count",
      "detail",
      "event_class",
      "field",
      "name",
      "stable_objective_id"
    ]);
  });

  it("stays refused beyond the budget (no silent recovery as the count grows)", () => {
    const base = makeTmpBase();
    const scope = "scope-over";
    const objective = "obj-over";
    seedOverhead(base, scope, objective, GOVERNANCE_OVERHEAD_BUDGET + 1);

    const refusal = budgetRefusalOf(evaluateOverheadBudget(store, scope, objective, base));
    expect(refusal.code).toBe("governance_overhead_budget");
    expect(refusal.count).toBe(GOVERNANCE_OVERHEAD_BUDGET + 1);
    expect(refusal.budget).toBe(GOVERNANCE_OVERHEAD_BUDGET);
  });

  it("does not count TERMINAL or BUDGET events: an objective at budget - 1 stays permitted after them", () => {
    const base = makeTmpBase();
    const scope = "scope-eval-boundary";
    const objective = "obj-eval-boundary";
    seedOverhead(base, scope, objective, GOVERNANCE_OVERHEAD_BUDGET - 1);
    seedTerminalBlocked(base, scope, objective);
    expect(appendRegistryEvent(scope, budgetCrossedEvent(objective), base).ok).toBe(true);

    const permitted = budgetPermittedOf(evaluateOverheadBudget(store, scope, objective, base));
    expect(permitted.count).toBe(GOVERNANCE_OVERHEAD_BUDGET - 1);
    expect(permitted.remaining).toBe(1);
    expect(permitted.accounting.terminal_blocked_present).toBe(true);
  });

  it("is stateless: repeated evaluation over the same log yields the identical verdict", () => {
    const base = makeTmpBase();
    const scope = "scope-eval-det";
    const objective = "obj-eval-det";
    seedOverhead(base, scope, objective, GOVERNANCE_OVERHEAD_BUDGET);

    const first = evaluateOverheadBudget(store, scope, objective, base);
    const second = evaluateOverheadBudget(store, scope, objective, base);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.permitted).toBe(false);
    expect(second.permitted).toBe(false);
    if (first.permitted || second.permitted) return;
    // Identical log in, identical verdict out — no state is stored anywhere.
    expect(second.refusal).toEqual(first.refusal);
    expect(second.accounting).toEqual(first.accounting);
  });

  it("fails closed with a named rejection when the store, scope, or objective is unusable", () => {
    const noStore = evaluateOverheadBudget({} as never, "scope-x", "obj-x");
    expect(noStore.ok).toBe(false);
    if (noStore.ok) return;
    expect(noStore.rejections[0].code).toBe("store_unavailable");
  });
});

// ---------------------------------------------------------------------------
// recordBudgetExhaustion — the terminal guard (exactly one TERMINAL_BLOCKED)
// ---------------------------------------------------------------------------

describe("recordBudgetExhaustion (terminal guard)", () => {
  it("appends exactly one TERMINAL_BLOCKED on breach; the duplicate call is refused terminal_already_recorded", () => {
    const base = makeTmpBase();
    const scope = "scope-guard";
    const objective = "obj-guard";
    seedOverhead(base, scope, objective, GOVERNANCE_OVERHEAD_BUDGET);

    const first = exhaustionAppendedOf(
      recordBudgetExhaustion(store, scope, objective, {
        event_id: "evt-guard-terminal",
        ts: "2026-08-23T00:00:01Z",
        actor_role: "B/DEV-1",
        content_hashes: [POLICY_HASH]
      }, base)
    );
    expect(first.event.event_class).toBe("TERMINAL");
    if (first.event.event_class !== "TERMINAL") throw new Error("unreachable");
    expect(first.event.event_type).toBe("TERMINAL_BLOCKED");
    expect(first.event.stable_objective_id).toBe(objective);
    expect(first.event.actor_role).toBe("B/DEV-1");
    expect(first.event.content_hashes).toEqual([POLICY_HASH]);
    expect(first.accounting.count).toBe(GOVERNANCE_OVERHEAD_BUDGET);
    expect(logSize(base, scope, objective, "TERMINAL")).toBe(1);
    expect(logSize(base, scope, objective)).toBe(GOVERNANCE_OVERHEAD_BUDGET + 1);

    // The exactly-one invariant is derived, not stored: the second call is
    // refused by name and appends nothing.
    const second = exhaustionRefusalOf(
      recordBudgetExhaustion(store, scope, objective, {
        event_id: "evt-guard-terminal-2",
        ts: "2026-08-23T00:00:02Z",
        content_hashes: [POLICY_HASH]
      }, base)
    );
    expect(second.name).toBe(TERMINAL_BLOCKED_REFUSAL_NAME);
    expect(second.code).toBe(TERMINAL_ALREADY_RECORDED_CODE);
    expect(second.code).toBe("terminal_already_recorded");
    expect(second.event_class).toBe("TERMINAL");
    expect(second.stable_objective_id).toBe(objective);
    expect(second.existing_event_id).toBe("evt-guard-terminal");
    expect(logSize(base, scope, objective, "TERMINAL")).toBe(1);
    expect(logSize(base, scope, objective)).toBe(GOVERNANCE_OVERHEAD_BUDGET + 1);
  });

  it("refuses budget_not_exhausted when invoked without a breach and appends nothing", () => {
    const base = makeTmpBase();
    const scope = "scope-premature";
    const objective = "obj-premature";
    seedOverhead(base, scope, objective, 3);

    const refusal = exhaustionRefusalOf(
      recordBudgetExhaustion(store, scope, objective, {
        event_id: "evt-premature-terminal",
        ts: "2026-08-23T00:00:01Z",
        content_hashes: [POLICY_HASH]
      }, base)
    );
    expect(refusal.name).toBe(TERMINAL_BLOCKED_REFUSAL_NAME);
    expect(refusal.code).toBe(BUDGET_NOT_EXHAUSTED_CODE);
    expect(refusal.code).toBe("budget_not_exhausted");
    expect(refusal.existing_event_id).toBeNull();
    expect(refusal.count).toBe(3);
    expect(refusal.budget).toBe(GOVERNANCE_OVERHEAD_BUDGET);
    expect(logSize(base, scope, objective, "TERMINAL")).toBe(0);
  });

  it("passes the store's union validation through unchanged: empty content_hashes is rejected at append", () => {
    const base = makeTmpBase();
    const scope = "scope-hashes";
    const objective = "obj-hashes";
    seedOverhead(base, scope, objective, GOVERNANCE_OVERHEAD_BUDGET);

    // The TERMINAL union member requires content_hashes (min 1); the guard
    // reuses that append-time validation instead of re-validating.
    const result = recordBudgetExhaustion(store, scope, objective, {
      event_id: "evt-hashes-terminal",
      ts: "2026-08-23T00:00:01Z",
      content_hashes: []
    }, base);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(
      result.rejections.some(
        (rejection) => rejection.field === "content_hashes" && rejection.event_class === "TERMINAL"
      )
    ).toBe(true);
    expect(logSize(base, scope, objective, "TERMINAL")).toBe(0);
  });

  it("fails closed with a named rejection when the store, scope, or objective is unusable", () => {
    const noStore = recordBudgetExhaustion({} as never, "scope-x", "obj-x", {
      event_id: "evt-x",
      ts: "2026-08-23T00:00:01Z",
      content_hashes: [POLICY_HASH]
    });
    expect(noStore.ok).toBe(false);
    if (noStore.ok) return;
    expect(noStore.rejections[0].code).toBe("store_unavailable");

    const badScope = recordBudgetExhaustion(store, "", "obj-x", {
      event_id: "evt-x",
      ts: "2026-08-23T00:00:01Z",
      content_hashes: [POLICY_HASH]
    });
    expect(badScope.ok).toBe(false);
    if (badScope.ok) return;
    expect(badScope.rejections[0].field).toBe("scope");

    const badObjective = recordBudgetExhaustion(store, "scope-x", " ", {
      event_id: "evt-x",
      ts: "2026-08-23T00:00:01Z",
      content_hashes: [POLICY_HASH]
    });
    expect(badObjective.ok).toBe(false);
    if (badObjective.ok) return;
    expect(badObjective.rejections[0].field).toBe("stable_objective_id");
  });
});

// ---------------------------------------------------------------------------
// appendGovernanceOverheadEvent — the post-terminal refusal guard
// ---------------------------------------------------------------------------

describe("appendGovernanceOverheadEvent (post-terminal refusal)", () => {
  it("appends governance-overhead events while no TERMINAL_BLOCKED exists", () => {
    const base = makeTmpBase();
    const scope = "scope-pre-terminal";
    const objective = "obj-pre-terminal";

    const appended = overheadAppendedOf(appendGovernanceOverheadEvent(store, scope, attemptEvent(objective), base));
    expect(appended.event.event_class).toBe("ATTEMPT");
    expect(logSize(base, scope, objective)).toBe(1);
  });

  it("refuses every countable governance-overhead class once a TERMINAL_BLOCKED exists", () => {
    const base = makeTmpBase();
    const scope = "scope-post-terminal";
    const objective = "obj-post-terminal";
    seedOverhead(base, scope, objective, 2);
    const terminalId = seedTerminalBlocked(base, scope, objective);
    const sizeBefore = logSize(base, scope, objective);

    for (const candidate of [
      attemptEvent(objective),
      findingEvent(objective),
      breakGlassEvent(objective),
      auditEvent(objective)
    ]) {
      const refusal = overheadRefusalOf(appendGovernanceOverheadEvent(store, scope, candidate, base));
      expect(refusal.name).toBe(GOVERNANCE_APPEND_REFUSAL_NAME);
      expect(refusal.code).toBe(OBJECTIVE_TERMINALLY_BLOCKED_CODE);
      expect(refusal.code).toBe("objective_terminally_blocked");
      expect(refusal.stable_objective_id).toBe(objective);
      expect(refusal.terminal_event_id).toBe(terminalId);
      expect(refusal.event_class).toBe(candidate.event_class);
      expect(refusal.field).toBe("stable_objective_id");
    }
    // No refused candidate entered the log: the terminal event spawns no new
    // proof or control work.
    expect(logSize(base, scope, objective)).toBe(sizeBefore);
  });

  it("policy fires before shape: a malformed overhead payload on a blocked objective is refused by name", () => {
    const base = makeTmpBase();
    const scope = "scope-policy-first";
    const objective = "obj-policy-first";
    seedTerminalBlocked(base, scope, objective);

    const malformed = {
      schema_version: "govdisp.event.v1",
      ts: "2026-08-23T00:00:03Z",
      stable_objective_id: objective,
      event_class: "ATTEMPT",
      event_type: "ATTEMPT_STARTED"
    };
    const refusal = overheadRefusalOf(appendGovernanceOverheadEvent(store, scope, malformed, base));
    expect(refusal.code).toBe("objective_terminally_blocked");
    expect(logSize(base, scope, objective)).toBe(1);
  });

  it("keeps storage as the shape choke point: a malformed overhead payload on a clear objective is rejected by the store", () => {
    const base = makeTmpBase();
    const scope = "scope-shape";
    const objective = "obj-shape";

    const malformed = {
      schema_version: "govdisp.event.v1",
      ts: "2026-08-23T00:00:03Z",
      stable_objective_id: objective,
      event_class: "ATTEMPT",
      event_type: "ATTEMPT_STARTED"
    };
    const result = appendGovernanceOverheadEvent(store, scope, malformed, base);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(
      result.rejections.some(
        (rejection) => rejection.field === "event_id" && rejection.event_class === "ATTEMPT"
      )
    ).toBe(true);
    expect(logSize(base, scope, objective)).toBe(0);
  });

  it("passes non-overhead payloads through to the store unchanged (guard jurisdiction is the countable classes)", () => {
    const base = makeTmpBase();
    const scope = "scope-jurisdiction";
    const objective = "obj-jurisdiction";
    seedTerminalBlocked(base, scope, objective);

    // TERMINAL and BUDGET events are not governance overhead; the guard does
    // not policy them, and the shape-only store accepts the schema-valid ones.
    const terminalCompleted = overheadAppendedOf(
      appendGovernanceOverheadEvent(store, scope, terminalCompletedEvent(objective), base)
    );
    expect(terminalCompleted.event.event_class).toBe("TERMINAL");
    const budgetCrossed = overheadAppendedOf(
      appendGovernanceOverheadEvent(store, scope, budgetCrossedEvent(objective), base)
    );
    expect(budgetCrossed.event.event_class).toBe("BUDGET");

    // A non-object payload passes the guard untouched and is shape-rejected by
    // the store's choke point.
    const notAnEvent = appendGovernanceOverheadEvent(store, scope, "not an event", base);
    expect(notAnEvent.ok).toBe(false);
    if (notAnEvent.ok) return;
    expect(notAnEvent.rejections[0].code).toBe("invalid_event_shape");
  });

  it("fails closed with a named rejection when the store or scope is unusable", () => {
    const noStore = appendGovernanceOverheadEvent({} as never, "scope-x", attemptEvent("obj-x"));
    expect(noStore.ok).toBe(false);
    if (noStore.ok) return;
    expect(noStore.rejections[0].code).toBe("store_unavailable");

    const badScope = appendGovernanceOverheadEvent(store, "", attemptEvent("obj-x"));
    expect(badScope.ok).toBe(false);
    if (badScope.ok) return;
    expect(badScope.rejections[0].field).toBe("scope");
  });
});

// ---------------------------------------------------------------------------
// Per-objective isolation
// ---------------------------------------------------------------------------

describe("governance-overhead budget per-objective isolation", () => {
  it("leaves other objectives unaffected when one objective is terminally blocked", () => {
    const base = makeTmpBase();
    const scope = "scope-isolation";
    seedOverhead(base, scope, "obj-a", 2);
    seedTerminalBlocked(base, scope, "obj-a");

    // Objective A: overhead appends refused by name.
    const aRefusal = overheadRefusalOf(
      appendGovernanceOverheadEvent(store, scope, attemptEvent("obj-a"), base)
    );
    expect(aRefusal.code).toBe("objective_terminally_blocked");
    expect(aRefusal.stable_objective_id).toBe("obj-a");

    // Objective B: evaluation and appends are entirely unaffected.
    const bPermitted = budgetPermittedOf(evaluateOverheadBudget(store, scope, "obj-b", base));
    expect(bPermitted.count).toBe(0);
    expect(bPermitted.remaining).toBe(GOVERNANCE_OVERHEAD_BUDGET);
    const bAppended = overheadAppendedOf(
      appendGovernanceOverheadEvent(store, scope, attemptEvent("obj-b"), base)
    );
    expect(bAppended.event.stable_objective_id).toBe("obj-b");
    expect(logSize(base, scope, "obj-b")).toBe(1);

    // Objective B's own exhaustion lifecycle is independent of A's terminal.
    seedOverhead(base, scope, "obj-b", GOVERNANCE_OVERHEAD_BUDGET - 1);
    const bExhaustion = exhaustionAppendedOf(
      recordBudgetExhaustion(store, scope, "obj-b", {
        event_id: "evt-isolation-b-terminal",
        ts: "2026-08-23T00:00:05Z",
        content_hashes: [POLICY_HASH]
      }, base)
    );
    expect(bExhaustion.event.stable_objective_id).toBe("obj-b");
  });
});

// ---------------------------------------------------------------------------
// Service surface
// ---------------------------------------------------------------------------

describe("governance-overhead budget service surface", () => {
  it("exposes the derivation, evaluator, and guards on the protocol service", async () => {
    const { createProtocolService } = await import("../../src/protocol/service.js");
    const service = createProtocolService();
    expect(typeof service.deriveOverheadAccounting).toBe("function");
    expect(typeof service.evaluateOverheadBudget).toBe("function");
    expect(typeof service.recordBudgetExhaustion).toBe("function");
    expect(typeof service.appendGovernanceOverheadEvent).toBe("function");
  });
});
