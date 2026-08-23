import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendRegistryEvent,
  queryRegistryEvents
} from "../../src/protocol/event-registry/index.js";
import {
  ATTEMPT_CEILING,
  ATTEMPT_REFUSAL_NAME,
  deriveAttemptAccounting,
  evaluateAttemptCeiling,
  type AttemptAccounting,
  type EvaluateAttemptCeilingResult,
  type GovdispRegistryStoreLike
} from "../../src/protocol/service.js";

// ---------------------------------------------------------------------------
// STORY-GOVDISP-003 — attempt-ceiling evaluator laundering matrix.
//
// GD-DEC-004: retry laundering must become a named refusal. The evaluator is a
// pure, stateless derivation over the append-only registry: counts are derived
// from the registry's own ATTEMPT events at evaluation time and are NEVER
// stored or cached. The ceiling binds to the immutable stable_objective_id, so
// no laundering vector (reset / restaff / rename / cure / rerun / a fresh
// "start" for the same objective) resets the count.
//
// These tests use the REAL registry storage module (temp-dir base) injected
// into the service layer, mirroring tests/protocol/event-registry.test.ts.
// ---------------------------------------------------------------------------

const store: GovdispRegistryStoreLike = { appendRegistryEvent, queryRegistryEvents };

const tmpRoots: string[] = [];

function makeTmpBase(): string {
  const dir = mkdtempSync(join(tmpdir(), "odin-govdisp-attempt-"));
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

function attemptIncrement(objectiveId: string, trigger: string) {
  eventSeq += 1;
  return {
    schema_version: "govdisp.event.v1",
    event_id: `evt-att-${eventSeq}`,
    ts: "2026-08-23T00:00:00Z",
    stable_objective_id: objectiveId,
    event_class: "ATTEMPT" as const,
    event_type: "ATTEMPT_STARTED" as const,
    trigger: trigger as never
  };
}

function appendIncrement(base: string, scope: string, objectiveId: string, trigger: string): void {
  const result = appendRegistryEvent(scope, attemptIncrement(objectiveId, trigger), base);
  expect(result.ok).toBe(true);
}

/** Seed `count` prior attempts for an objective using the given trigger. */
function seedAttempts(base: string, scope: string, objectiveId: string, count: number, trigger: string): void {
  for (let index = 0; index < count; index += 1) {
    appendIncrement(base, scope, objectiveId, trigger);
  }
}

function refusalOf(result: EvaluateAttemptCeilingResult) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("unreachable");
  expect(result.permitted).toBe(false);
  if (result.permitted) throw new Error("unreachable");
  return result.refusal;
}

function permittedOf(result: EvaluateAttemptCeilingResult) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("unreachable");
  expect(result.permitted).toBe(true);
  if (!result.permitted) throw new Error("unreachable");
  return result;
}

// ---------------------------------------------------------------------------
// deriveAttemptAccounting — stateless pure derivation
// ---------------------------------------------------------------------------

describe("deriveAttemptAccounting (stateless derivation)", () => {
  it("returns a zero count and empty breakdown for an objective with no attempts", () => {
    const base = makeTmpBase();
    const result = deriveAttemptAccounting(store, "scope-a", "obj-empty", base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.accounting.stable_objective_id).toBe("obj-empty");
    expect(result.accounting.count).toBe(0);
    expect(result.accounting.per_trigger).toEqual({});
  });

  it("counts every attempt increment on the SAME counter regardless of trigger", () => {
    const base = makeTmpBase();
    const scope = "scope-b";
    const objective = "obj-mixed";
    appendIncrement(base, scope, objective, "start");
    appendIncrement(base, scope, objective, "reset");
    appendIncrement(base, scope, objective, "rerun");

    const result = deriveAttemptAccounting(store, scope, objective, base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.accounting.count).toBe(3);
    expect(result.accounting.per_trigger).toEqual({ start: 1, reset: 1, rerun: 1 });
  });

  it("never counts ATTEMPT_REFUSED records as attempts", () => {
    const base = makeTmpBase();
    const scope = "scope-c";
    const objective = "obj-no-double-count";
    seedAttempts(base, scope, objective, 3, "start");
    // A refusal RECORD may be appended for audit; it must not increment the count.
    eventSeq += 1;
    const refusedRecord = {
      schema_version: "govdisp.event.v1",
      event_id: `evt-att-${eventSeq}`,
      ts: "2026-08-23T00:00:00Z",
      stable_objective_id: objective,
      event_class: "ATTEMPT" as const,
      event_type: "ATTEMPT_REFUSED" as const
    };
    expect(appendRegistryEvent(scope, refusedRecord, base).ok).toBe(true);

    const result = deriveAttemptAccounting(store, scope, objective, base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.accounting.count).toBe(3);
    expect(result.accounting.per_trigger).toEqual({ start: 3 });
  });

  it("is deterministic and stateless: repeated evaluation over the same log is identical", () => {
    const base = makeTmpBase();
    const scope = "scope-d";
    const objective = "obj-deterministic";
    seedAttempts(base, scope, objective, 2, "cure");

    const first = deriveAttemptAccounting(store, scope, objective, base);
    const second = deriveAttemptAccounting(store, scope, objective, base);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.accounting).toEqual(first.accounting);
  });

  it("fails closed with a named rejection when the store or scope is unusable", () => {
    const noStore = deriveAttemptAccounting({} as never, "scope-x", "obj-x");
    expect(noStore.ok).toBe(false);
    if (noStore.ok) return;
    expect(noStore.rejections[0].code).toBe("store_unavailable");

    const badScope = deriveAttemptAccounting(store, "", "obj-x");
    expect(badScope.ok).toBe(false);
    if (badScope.ok) return;
    expect(badScope.rejections[0].field).toBe("scope");

    const badObjective = deriveAttemptAccounting(store, "scope-x", "  ");
    expect(badObjective.ok).toBe(false);
    if (badObjective.ok) return;
    expect(badObjective.rejections[0].field).toBe("stable_objective_id");
  });
});

// ---------------------------------------------------------------------------
// evaluateAttemptCeiling — under-ceiling permits
// ---------------------------------------------------------------------------

describe("evaluateAttemptCeiling (under-ceiling permits)", () => {
  it("permits attempts 1, 2, and 3 with the derived attempt_index", () => {
    const base = makeTmpBase();
    const scope = "scope-permit";
    const objective = "obj-permit";

    const one = permittedOf(evaluateAttemptCeiling(store, scope, objective, "start", base));
    expect(one.attempt_index).toBe(1);
    expect(one.ceiling).toBe(ATTEMPT_CEILING);

    appendIncrement(base, scope, objective, "start");
    const two = permittedOf(evaluateAttemptCeiling(store, scope, objective, "start", base));
    expect(two.attempt_index).toBe(2);

    appendIncrement(base, scope, objective, "start");
    const three = permittedOf(evaluateAttemptCeiling(store, scope, objective, "start", base));
    expect(three.attempt_index).toBe(3);
    expect(three.accounting.count).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// evaluateAttemptCeiling — the laundering matrix (AC1 / Control 4)
// ---------------------------------------------------------------------------

describe("evaluateAttemptCeiling (laundering matrix — every vector refused by name)", () => {
  const LAUNDERING_VECTORS = ["reset", "restaff", "rename", "cure", "rerun", "start"] as const;

  for (const vector of LAUNDERING_VECTORS) {
    it(`refuses attempt four via the "${vector}" vector with a named ATTEMPT_REFUSED`, () => {
      const base = makeTmpBase();
      const scope = "scope-launder";
      const objective = `obj-launder-${vector}`;
      // Three attempts already spent; the fourth arrives via the laundering vector.
      seedAttempts(base, scope, objective, ATTEMPT_CEILING, vector);

      const result = evaluateAttemptCeiling(store, scope, objective, vector, base);
      const refusal = refusalOf(result);

      expect(refusal.name).toBe(ATTEMPT_REFUSAL_NAME);
      expect(refusal.code).toBe("attempt_ceiling");
      expect(refusal.stable_objective_id).toBe(objective);
      expect(refusal.attempt_index).toBe(4);
      expect(refusal.ceiling).toBe(ATTEMPT_CEILING);
      expect(refusal.trigger).toBe(vector);
      expect(refusal.event_class).toBe("ATTEMPT");
      expect(refusal.field).toBe("attempt_index");
      expect(refusal.detail).not.toBe("");
    });
  }

  it("binds the ceiling to stable_objective_id, never to the attempt_index label", () => {
    const base = makeTmpBase();
    const scope = "scope-relabel";
    const objective = "obj-relabel";
    seedAttempts(base, scope, objective, ATTEMPT_CEILING, "start");

    // Laundering by relabeling: append a reset event self-asserting attempt_index 1.
    // The evaluator derives the count from the log (4th attempt), ignoring the label.
    eventSeq += 1;
    const relabeled = {
      schema_version: "govdisp.event.v1",
      event_id: `evt-att-${eventSeq}`,
      ts: "2026-08-23T00:00:00Z",
      stable_objective_id: objective,
      event_class: "ATTEMPT" as const,
      event_type: "ATTEMPT_STARTED" as const,
      attempt_index: 1,
      trigger: "reset" as const
    };
    expect(appendRegistryEvent(scope, relabeled, base).ok).toBe(true);

    const refusal = refusalOf(evaluateAttemptCeiling(store, scope, objective, "reset", base));
    expect(refusal.attempt_index).toBe(5);
    expect(refusal.code).toBe("attempt_ceiling");
  });

  it("refuses by name at every depth beyond the ceiling", () => {
    const base = makeTmpBase();
    const scope = "scope-deep";
    const objective = "obj-deep";
    seedAttempts(base, scope, objective, 5, "reset");

    const refusal = refusalOf(evaluateAttemptCeiling(store, scope, objective, "reset", base));
    expect(refusal.name).toBe(ATTEMPT_REFUSAL_NAME);
    expect(refusal.attempt_index).toBe(6);
    expect(refusal.ceiling).toBe(ATTEMPT_CEILING);
  });
});

// ---------------------------------------------------------------------------
// Per-objective isolation
// ---------------------------------------------------------------------------

describe("attempt-ceiling per-objective isolation", () => {
  it("leaves objective B unaffected when objective A exhausts its ceiling", () => {
    const base = makeTmpBase();
    const scope = "scope-isolation";
    seedAttempts(base, scope, "obj-a", ATTEMPT_CEILING, "reset");

    const aRefusal = refusalOf(evaluateAttemptCeiling(store, scope, "obj-a", "reset", base));
    expect(aRefusal.attempt_index).toBe(4);

    // Objective B has its own counter; its first attempt is still permitted.
    const bFirst = permittedOf(evaluateAttemptCeiling(store, scope, "obj-b", "start", base));
    expect(bFirst.attempt_index).toBe(1);

    // And deriving B's accounting shows no leakage from A.
    const bAccounting = deriveAttemptAccounting(store, scope, "obj-b", base);
    expect(bAccounting.ok).toBe(true);
    if (!bAccounting.ok) return;
    expect(bAccounting.accounting.count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Refusal shape conventions
// ---------------------------------------------------------------------------

describe("attempt-ceiling refusal shape", () => {
  it("carries the full named-rejection shape plus attempt-ceiling context", () => {
    const base = makeTmpBase();
    const scope = "scope-shape";
    const objective = "obj-shape";
    seedAttempts(base, scope, objective, ATTEMPT_CEILING, "rename");

    const refusal = refusalOf(evaluateAttemptCeiling(store, scope, objective, "rename", base));

    // Registry named-rejection shape conventions.
    expect(refusal).toMatchObject({
      field: "attempt_index",
      event_class: "ATTEMPT",
      code: "attempt_ceiling"
    });
    expect(typeof refusal.detail).toBe("string");
    // Attempt-ceiling context.
    expect(refusal).toMatchObject({
      name: ATTEMPT_REFUSAL_NAME,
      stable_objective_id: objective,
      attempt_index: 4,
      ceiling: ATTEMPT_CEILING,
      trigger: "rename"
    });
    expect(Object.keys(refusal).sort()).toEqual([
      "attempt_index",
      "ceiling",
      "code",
      "detail",
      "event_class",
      "field",
      "name",
      "stable_objective_id",
      "trigger"
    ]);
  });

  it("normalizes an unrecognized trigger spelling to \"unknown\" while still refusing", () => {
    const base = makeTmpBase();
    const scope = "scope-unknown-trigger";
    const objective = "obj-unknown-trigger";
    seedAttempts(base, scope, objective, ATTEMPT_CEILING, "start");

    const refusal = refusalOf(evaluateAttemptCeiling(store, scope, objective, "requeue", base));
    expect(refusal.trigger).toBe("unknown");
    expect(refusal.code).toBe("attempt_ceiling");
  });
});

// ---------------------------------------------------------------------------
// Service surface exposure
// ---------------------------------------------------------------------------

describe("attempt evaluator service surface", () => {
  it("exposes the derivation and evaluator on the protocol service", async () => {
    const { createProtocolService } = await import("../../src/protocol/service.js");
    const service = createProtocolService();
    expect(typeof service.deriveAttemptAccounting).toBe("function");
    expect(typeof service.evaluateAttemptCeiling).toBe("function");
  });

  it("derives accounting deterministically as a pure function of the log (stateless)", () => {
    const base = makeTmpBase();
    const scope = "scope-stateless";
    const objective = "obj-stateless";
    seedAttempts(base, scope, objective, 2, "cure");

    const evaluate = (): AttemptAccounting | null => {
      const result = evaluateAttemptCeiling(store, scope, objective, "cure", base);
      return result.ok ? result.accounting : null;
    };
    const first = evaluate();
    const second = evaluate();
    // Identical log in, identical accounting out — no counter storage anywhere.
    expect(second).toEqual(first);
    expect(first?.count).toBe(2);
  });
});
