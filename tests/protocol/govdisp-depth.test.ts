import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendRegistryEvent,
  queryRegistryEvents
} from "../../src/protocol/event-registry/index.js";
import {
  AUDIT_REFUSAL_NAME,
  BREAK_GLASS_WRONG_CLASS_CODE,
  deriveMetaGovernanceDepth,
  evaluateMetaGovernanceDepth,
  META_GOVERNANCE_DEPTH_CAP,
  META_GOVERNANCE_DEPTH_CODE,
  type EvaluateMetaGovernanceDepthResult,
  type GovdispRegistryStoreLike
} from "../../src/protocol/service.js";

// ---------------------------------------------------------------------------
// STORY-GOVDISP-003 — meta-governance depth cap + break-glass acceptance.
//
// GD-DEC-001 caps meta-governance at ONE audited layer. An audit of ordinary
// work is depth 1 (permitted). An audit whose target is itself an audit
// (audit-of-audit) is depth 2 — REFUSED with a named meta_governance_depth
// refusal UNLESS a valid BREAK_GLASS event for the same stable_objective_id
// exists in the registry. The evaluator is a pure, stateless derivation over
// the append-only registry: depth is recomputed from the registry's own AUDIT
// events at evaluation time and is NEVER stored or cached.
//
// G7: an [SCP-EXCEPTION]-shaped payload offered as break-glass authority is
// NOT a BREAK_GLASS event and is rejected by name (break_glass_wrong_class).
//
// These tests use the REAL registry storage module (temp-dir base) injected
// into the service layer, mirroring tests/protocol/govdisp-attempt.test.ts.
// ---------------------------------------------------------------------------

const store: GovdispRegistryStoreLike = { appendRegistryEvent, queryRegistryEvents };

const tmpRoots: string[] = [];

function makeTmpBase(): string {
  const dir = mkdtempSync(join(tmpdir(), "odin-govdisp-depth-"));
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
    event_id: `evt-depth-${eventSeq}`,
    ts: "2026-08-23T00:00:00Z",
    stable_objective_id: objectiveId
  };
}

function auditOrdinaryEvent(objectiveId: string) {
  return {
    ...eventBase(objectiveId),
    event_class: "AUDIT" as const,
    event_type: "AUDIT_OPENED" as const,
    target: { kind: "ordinary_work" as const }
  };
}

function auditOfAuditEvent(objectiveId: string, targetEventId: string) {
  return {
    ...eventBase(objectiveId),
    event_class: "AUDIT" as const,
    event_type: "AUDIT_OPENED" as const,
    target: { kind: "audit" as const, target_event_id: targetEventId }
  };
}

function breakGlassEvent(objectiveId: string) {
  return {
    ...eventBase(objectiveId),
    event_class: "BREAK_GLASS" as const,
    event_type: "BREAK_GLASS_RECORDED" as const,
    authorizing_human: "operator",
    contradiction_ref: "GDR-20260823-001"
  };
}

/** Append a depth-1 audit of ordinary work; returns its recorded event_id. */
function seedOrdinaryAudit(base: string, scope: string, objectiveId: string): string {
  const result = appendRegistryEvent(scope, auditOrdinaryEvent(objectiveId), base);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("unreachable");
  return result.event.event_id;
}

/** Append a valid BREAK_GLASS_RECORDED event; returns its recorded event_id. */
function seedBreakGlass(base: string, scope: string, objectiveId: string): string {
  const result = appendRegistryEvent(scope, breakGlassEvent(objectiveId), base);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("unreachable");
  return result.event.event_id;
}

function refusalOf(result: EvaluateMetaGovernanceDepthResult) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("unreachable");
  expect(result.permitted).toBe(false);
  if (result.permitted) throw new Error("unreachable");
  return result.refusal;
}

function permittedOf(result: EvaluateMetaGovernanceDepthResult) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("unreachable");
  expect(result.permitted).toBe(true);
  if (!result.permitted) throw new Error("unreachable");
  return result;
}

// ---------------------------------------------------------------------------
// deriveMetaGovernanceDepth — stateless pure derivation
// ---------------------------------------------------------------------------

describe("deriveMetaGovernanceDepth (stateless derivation)", () => {
  it("derives depth 1 for an audit of ordinary work", () => {
    const base = makeTmpBase();
    const result = deriveMetaGovernanceDepth(store, "scope-a", "obj-plain", { kind: "ordinary_work" }, base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.derivation.stable_objective_id).toBe("obj-plain");
    expect(result.derivation.depth).toBe(1);
    expect(result.derivation.cap).toBe(META_GOVERNANCE_DEPTH_CAP);
    expect(result.derivation.audit_chain).toEqual([]);
    expect(result.derivation.break_glass_present).toBe(false);
    expect(result.derivation.break_glass_event_ids).toEqual([]);
  });

  it("derives depth 2 for an audit whose target is a recorded audit", () => {
    const base = makeTmpBase();
    const scope = "scope-b";
    const objective = "obj-aud-of-aud";
    const firstAuditId = seedOrdinaryAudit(base, scope, objective);

    const result = deriveMetaGovernanceDepth(
      store, scope, objective,
      { kind: "audit", target_event_id: firstAuditId },
      base
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.derivation.depth).toBe(2);
    expect(result.derivation.audit_chain).toEqual([firstAuditId]);
  });

  it("walks the audit-target chain to derive deeper layers exactly", () => {
    const base = makeTmpBase();
    const scope = "scope-chain";
    const objective = "obj-chain";
    const firstAuditId = seedOrdinaryAudit(base, scope, objective);
    const second = appendRegistryEvent(scope, auditOfAuditEvent(objective, firstAuditId), base);
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    const result = deriveMetaGovernanceDepth(
      store, scope, objective,
      { kind: "audit", target_event_id: second.event.event_id },
      base
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.derivation.depth).toBe(3);
    expect(result.derivation.audit_chain).toEqual([second.event.event_id, firstAuditId]);
  });

  it("counts an unresolvable audit target as one meta-governance layer (fail-closed depth)", () => {
    const base = makeTmpBase();
    const result = deriveMetaGovernanceDepth(
      store, "scope-unresolved", "obj-unresolved",
      { kind: "audit", target_event_id: "evt-not-in-registry" },
      base
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.derivation.depth).toBe(2);
    expect(result.derivation.audit_chain).toEqual(["evt-not-in-registry"]);
  });

  it("is deterministic and stateless: repeated derivation over the same log is identical", () => {
    const base = makeTmpBase();
    const scope = "scope-det";
    const objective = "obj-det";
    const firstAuditId = seedOrdinaryAudit(base, scope, objective);

    const target = { kind: "audit", target_event_id: firstAuditId };
    const first = deriveMetaGovernanceDepth(store, scope, objective, target, base);
    const second = deriveMetaGovernanceDepth(store, scope, objective, target, base);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.derivation).toEqual(first.derivation);
  });

  it("fails closed with a named rejection when the store, scope, objective, or target is unusable", () => {
    const noStore = deriveMetaGovernanceDepth({} as never, "scope-x", "obj-x", { kind: "ordinary_work" });
    expect(noStore.ok).toBe(false);
    if (noStore.ok) return;
    expect(noStore.rejections[0].code).toBe("store_unavailable");

    const badScope = deriveMetaGovernanceDepth(store, "", "obj-x", { kind: "ordinary_work" });
    expect(badScope.ok).toBe(false);
    if (badScope.ok) return;
    expect(badScope.rejections[0].field).toBe("scope");

    const badObjective = deriveMetaGovernanceDepth(store, "scope-x", "  ", { kind: "ordinary_work" });
    expect(badObjective.ok).toBe(false);
    if (badObjective.ok) return;
    expect(badObjective.rejections[0].field).toBe("stable_objective_id");

    const badTarget = deriveMetaGovernanceDepth(store, "scope-x", "obj-x", { kind: "audit" });
    expect(badTarget.ok).toBe(false);
    if (badTarget.ok) return;
    expect(badTarget.rejections[0].field).toBe("target");
    expect(badTarget.rejections[0].code).toBe("invalid_target");
    expect(badTarget.rejections[0].event_class).toBe("AUDIT");
  });
});

// ---------------------------------------------------------------------------
// evaluateMetaGovernanceDepth — depth-1 permits
// ---------------------------------------------------------------------------

describe("evaluateMetaGovernanceDepth (depth-1 permits)", () => {
  it("permits an audit of ordinary work under the cap", () => {
    const base = makeTmpBase();
    const permitted = permittedOf(
      evaluateMetaGovernanceDepth(store, "scope-p1", "obj-p1", { kind: "ordinary_work" }, base)
    );
    expect(permitted.depth).toBe(1);
    expect(permitted.cap).toBe(META_GOVERNANCE_DEPTH_CAP);
    expect(permitted.authorized_by).toBe("depth_cap");
    expect(permitted.break_glass_event_id).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// evaluateMetaGovernanceDepth — depth-2 refusal and break-glass acceptance
// ---------------------------------------------------------------------------

describe("evaluateMetaGovernanceDepth (depth cap + break-glass)", () => {
  it("refuses an audit-of-audit by name when no break-glass is recorded", () => {
    const base = makeTmpBase();
    const scope = "scope-refuse";
    const objective = "obj-refuse";
    const firstAuditId = seedOrdinaryAudit(base, scope, objective);

    const refusal = refusalOf(
      evaluateMetaGovernanceDepth(
        store, scope, objective,
        { kind: "audit", target_event_id: firstAuditId },
        base
      )
    );
    expect(refusal.name).toBe(AUDIT_REFUSAL_NAME);
    expect(refusal.code).toBe(META_GOVERNANCE_DEPTH_CODE);
    expect(refusal.code).toBe("meta_governance_depth");
    expect(refusal.stable_objective_id).toBe(objective);
    expect(refusal.depth).toBe(2);
    expect(refusal.cap).toBe(1);
    expect(refusal.event_class).toBe("AUDIT");
    expect(refusal.field).toBe("target");
    expect(refusal.detail).not.toBe("");
    expect(refusal.detail).toContain("BREAK_GLASS_RECORDED");
    expect(Object.keys(refusal).sort()).toEqual([
      "cap",
      "code",
      "depth",
      "detail",
      "event_class",
      "field",
      "name",
      "stable_objective_id"
    ]);
  });

  it("permits the audit-of-audit when a valid BREAK_GLASS event is recorded for the objective", () => {
    const base = makeTmpBase();
    const scope = "scope-bg";
    const objective = "obj-bg";
    const firstAuditId = seedOrdinaryAudit(base, scope, objective);
    const breakGlassId = seedBreakGlass(base, scope, objective);

    const permitted = permittedOf(
      evaluateMetaGovernanceDepth(
        store, scope, objective,
        { kind: "audit", target_event_id: firstAuditId },
        base
      )
    );
    expect(permitted.depth).toBe(2);
    expect(permitted.authorized_by).toBe("break_glass");
    expect(permitted.break_glass_event_id).toBe(breakGlassId);
    expect(permitted.derivation.break_glass_present).toBe(true);
    expect(permitted.derivation.break_glass_event_ids).toContain(breakGlassId);
  });

  it("permits the audit-of-audit when the recorded break-glass event is also offered explicitly", () => {
    const base = makeTmpBase();
    const scope = "scope-bg-offer";
    const objective = "obj-bg-offer";
    const firstAuditId = seedOrdinaryAudit(base, scope, objective);
    const breakGlassId = seedBreakGlass(base, scope, objective);

    const permitted = permittedOf(
      evaluateMetaGovernanceDepth(
        store, scope, objective,
        { kind: "audit", target_event_id: firstAuditId },
        base,
        { breakGlassAuthority: { ...breakGlassEvent(objective), event_id: breakGlassId } }
      )
    );
    expect(permitted.authorized_by).toBe("break_glass");
    expect(permitted.break_glass_event_id).toBe(breakGlassId);
  });

  it("refuses a break-glass-shaped offer that is not present in the registry (presence plus binding)", () => {
    const base = makeTmpBase();
    const scope = "scope-bg-absent";
    const objective = "obj-bg-absent";
    const firstAuditId = seedOrdinaryAudit(base, scope, objective);

    const refusal = refusalOf(
      evaluateMetaGovernanceDepth(
        store, scope, objective,
        { kind: "audit", target_event_id: firstAuditId },
        base,
        { breakGlassAuthority: breakGlassEvent(objective) }
      )
    );
    expect(refusal.code).toBe("meta_governance_depth");
    expect(refusal.field).toBe("break_glass");
    expect(refusal.detail).toContain("presence plus binding");
  });

  it("rejects a break-glass event missing authorizing_human at append (existing union validation)", () => {
    const base = makeTmpBase();
    const scope = "scope-bg-invalid";
    const objective = "obj-bg-invalid";
    const invalid = {
      ...eventBase(objective),
      event_class: "BREAK_GLASS" as const,
      event_type: "BREAK_GLASS_RECORDED" as const,
      contradiction_ref: "GDR-20260823-002"
    };
    const result = appendRegistryEvent(scope, invalid, base);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(
      result.rejections.some(
        (rejection) => rejection.field === "authorizing_human" && rejection.event_class === "BREAK_GLASS"
      )
    ).toBe(true);

    // The rejected event never entered the log, so a depth-2 audit stays refused.
    const firstAuditId = seedOrdinaryAudit(base, scope, objective);
    const refusal = refusalOf(
      evaluateMetaGovernanceDepth(
        store, scope, objective,
        { kind: "audit", target_event_id: firstAuditId },
        base
      )
    );
    expect(refusal.code).toBe("meta_governance_depth");
  });
});

// ---------------------------------------------------------------------------
// G7 — exception-shaped offers are not break-glass authority
// ---------------------------------------------------------------------------

describe("evaluateMetaGovernanceDepth (G7 break_glass_wrong_class)", () => {
  it("rejects an [SCP-EXCEPTION]-shaped payload offered as break-glass authority, by name", () => {
    const base = makeTmpBase();
    const scope = "scope-g7";
    const objective = "obj-g7";
    const firstAuditId = seedOrdinaryAudit(base, scope, objective);

    const exceptionShape = {
      receipt_type: "[SCP-EXCEPTION]",
      exception_id: "EX-20260823-001",
      authorizing_human: "operator",
      contradiction_ref: "GDR-20260823-003",
      scope: "re-audit authorization",
      expiry_condition: "single re-audit"
    };
    const refusal = refusalOf(
      evaluateMetaGovernanceDepth(
        store, scope, objective,
        { kind: "audit", target_event_id: firstAuditId },
        base,
        { breakGlassAuthority: exceptionShape }
      )
    );
    expect(refusal.name).toBe(AUDIT_REFUSAL_NAME);
    expect(refusal.code).toBe(BREAK_GLASS_WRONG_CLASS_CODE);
    expect(refusal.code).toBe("break_glass_wrong_class");
    expect(refusal.field).toBe("break_glass");
    expect(refusal.event_class).toBe("AUDIT");
    expect(refusal.stable_objective_id).toBe(objective);
    expect(refusal.depth).toBe(2);
    expect(refusal.cap).toBe(1);
  });

  it("rejects a valid registry event of the WRONG class offered as break-glass authority", () => {
    const base = makeTmpBase();
    const scope = "scope-g7-class";
    const objective = "obj-g7-class";
    const firstAuditId = seedOrdinaryAudit(base, scope, objective);

    // A schema-valid FINDING event is a real registry event, but it is not a
    // BREAK_GLASS event — offering it as authority is break_glass_wrong_class.
    const finding = {
      ...eventBase(objective),
      event_class: "FINDING" as const,
      event_type: "FINDING_OPENED" as const,
      finding_id: "finding-1"
    };
    const refusal = refusalOf(
      evaluateMetaGovernanceDepth(
        store, scope, objective,
        { kind: "audit", target_event_id: firstAuditId },
        base,
        { breakGlassAuthority: finding }
      )
    );
    expect(refusal.code).toBe("break_glass_wrong_class");
  });
});

// ---------------------------------------------------------------------------
// Per-objective isolation
// ---------------------------------------------------------------------------

describe("meta-governance depth per-objective isolation", () => {
  it("does not let objective A's break-glass authorize objective B's audit-of-audit", () => {
    const base = makeTmpBase();
    const scope = "scope-iso";
    const aFirstAuditId = seedOrdinaryAudit(base, scope, "obj-a");
    seedBreakGlass(base, scope, "obj-a");
    const bFirstAuditId = seedOrdinaryAudit(base, scope, "obj-b");

    // Objective A: break-glass recorded, re-audit permitted.
    const aPermitted = permittedOf(
      evaluateMetaGovernanceDepth(
        store, scope, "obj-a",
        { kind: "audit", target_event_id: aFirstAuditId },
        base
      )
    );
    expect(aPermitted.authorized_by).toBe("break_glass");

    // Objective B: no break-glass bound to B — still refused by name.
    const bRefusal = refusalOf(
      evaluateMetaGovernanceDepth(
        store, scope, "obj-b",
        { kind: "audit", target_event_id: bFirstAuditId },
        base
      )
    );
    expect(bRefusal.code).toBe("meta_governance_depth");
    expect(bRefusal.stable_objective_id).toBe("obj-b");
  });

  it("leaves objective B's depth-1 audits unaffected by objective A's audit-of-audit history", () => {
    const base = makeTmpBase();
    const scope = "scope-iso2";
    const aFirstAuditId = seedOrdinaryAudit(base, scope, "obj-a");
    // A accumulates an audit-of-audit record (the store records; the evaluator refuses).
    expect(appendRegistryEvent(scope, auditOfAuditEvent("obj-a", aFirstAuditId), base).ok).toBe(true);

    const bPermitted = permittedOf(
      evaluateMetaGovernanceDepth(store, scope, "obj-b", { kind: "ordinary_work" }, base)
    );
    expect(bPermitted.depth).toBe(1);
    expect(bPermitted.authorized_by).toBe("depth_cap");

    const bDerivation = deriveMetaGovernanceDepth(store, scope, "obj-b", { kind: "ordinary_work" }, base);
    expect(bDerivation.ok).toBe(true);
    if (!bDerivation.ok) return;
    expect(bDerivation.derivation.audit_chain).toEqual([]);
    expect(bDerivation.derivation.break_glass_present).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Refusal shape + statelessness + service surface
// ---------------------------------------------------------------------------

describe("meta-governance depth evaluator conventions", () => {
  it("is stateless: repeated evaluation over the same log yields the identical verdict", () => {
    const base = makeTmpBase();
    const scope = "scope-stateless";
    const objective = "obj-stateless";
    const firstAuditId = seedOrdinaryAudit(base, scope, objective);

    const target = { kind: "audit", target_event_id: firstAuditId };
    const first = evaluateMetaGovernanceDepth(store, scope, objective, target, base);
    const second = evaluateMetaGovernanceDepth(store, scope, objective, target, base);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    // Identical log in, identical verdict out — no state is stored anywhere.
    expect(second.permitted).toBe(false);
    expect(first.permitted).toBe(false);
    if (first.permitted || second.permitted) return;
    expect(second.refusal).toEqual(first.refusal);
    expect(second.derivation).toEqual(first.derivation);
  });

  it("exposes the derivation and evaluator on the protocol service", async () => {
    const { createProtocolService } = await import("../../src/protocol/service.js");
    const service = createProtocolService();
    expect(typeof service.deriveMetaGovernanceDepth).toBe("function");
    expect(typeof service.evaluateMetaGovernanceDepth).toBe("function");
  });
});
