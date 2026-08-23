import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appendRegistryEvent,
  queryRegistryEvents
} from "../../src/protocol/event-registry/index.js";
import {
  countActiveFindings,
  deriveFindingState,
  evaluateFindingClosure,
  FINDING_NOT_ACTIVE_CODE,
  FINDING_REFUSAL_NAME,
  type CountActiveFindingsResult,
  type DeriveFindingStateResult,
  type EvaluateFindingClosureResult,
  type GovdispRegistryStoreLike
} from "../../src/protocol/service.js";
import type { WakeState } from "../../src/protocol/schemas.js";
import { writeWakeFiles } from "../../src/odin-watch/writers.js";

// ---------------------------------------------------------------------------
// STORY-GOVDISP-004 — finding ownership lifecycle + odin-watch wiring.
//
// GD-DEC-005: a finding is not ACTIVE until it has an accountable owner and a
// delivery event; "logged" must not masquerade as "driven". The ownership
// evaluator derives lifecycle state statelessly from the registry's FINDING
// events; a FINDING_CLOSED raised for a finding missing FINDING_OWNED,
// FINDING_DELIVERED, or both is refused by name (finding_not_active) with the
// missing prerequisites cited (registry negative control #9). The
// intervention-duty guard counts only owner-bound findings with delivery
// events. The odin-watch writer emits FINDING_OPENED through the injected
// service append seam only under the ODIN_GOVDISP_REGISTRY_MCP compatibility
// flag; flag off is byte-identical and cheap-open (DIS-001) guarantees the
// emission produces zero new files outside the registry base.
//
// These tests use the REAL registry storage module (temp-dir base) injected
// into the service layer, mirroring tests/protocol/govdisp-budget.test.ts.
// ---------------------------------------------------------------------------

const store: GovdispRegistryStoreLike = { appendRegistryEvent, queryRegistryEvents };

const tmpRoots: string[] = [];

function makeTmpBase(): string {
  const dir = mkdtempSync(join(tmpdir(), "odin-govdisp-own-"));
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
    event_id: `evt-own-${eventSeq}`,
    ts: "2026-08-23T00:00:00Z",
    stable_objective_id: objectiveId
  };
}

function findingOpened(objectiveId: string, findingId: string) {
  return {
    ...eventBase(objectiveId),
    event_class: "FINDING" as const,
    event_type: "FINDING_OPENED" as const,
    finding_id: findingId
  };
}

function findingOwned(objectiveId: string, findingId: string, ownerRole: string) {
  return {
    ...eventBase(objectiveId),
    event_class: "FINDING" as const,
    event_type: "FINDING_OWNED" as const,
    finding_id: findingId,
    owner_role: ownerRole
  };
}

function findingDelivered(objectiveId: string, findingId: string) {
  return {
    ...eventBase(objectiveId),
    event_class: "FINDING" as const,
    event_type: "FINDING_DELIVERED" as const,
    finding_id: findingId
  };
}

function findingClosed(objectiveId: string, findingId: string) {
  return {
    ...eventBase(objectiveId),
    event_class: "FINDING" as const,
    event_type: "FINDING_CLOSED" as const,
    finding_id: findingId
  };
}

function seedFinding(base: string, scope: string, event: unknown): void {
  const result = appendRegistryEvent(scope, event, base);
  expect(result.ok).toBe(true);
}

function findingStateOf(result: DeriveFindingStateResult) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("unreachable");
  return result.state;
}

function closureRefusalOf(result: EvaluateFindingClosureResult) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("unreachable");
  expect(result.permitted).toBe(false);
  if (result.permitted) throw new Error("unreachable");
  return result.refusal;
}

function closurePermittedOf(result: EvaluateFindingClosureResult) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("unreachable");
  expect(result.permitted).toBe(true);
  if (!result.permitted) throw new Error("unreachable");
  return result;
}

function activeCountOf(result: CountActiveFindingsResult) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("unreachable");
  return result;
}

function makeWakeState(wake: 0 | 1, reasons: string[]): WakeState {
  return {
    schema_version: "1.0",
    ts: "2026-08-23T00:00:00.000Z",
    surface: "surface-1",
    pane_id: "surface-1",
    substrate: "cmux",
    state: wake === 0 ? "WORKING" : "UNKNOWN_NEEDS_READ",
    wake,
    reason_codes: reasons,
    dirty_paths: [],
    dirty_out_of_scope: [],
    screen_hash: "deadbeef",
    screen_changed: false,
    prompt_budget_class: wake === 0 ? "silent" : "compact",
    next_mandatory_audit_due: "2026-08-23T00:10:00.000Z"
  };
}

function wakeFileContents(dir: string, label: string): Record<string, string> {
  return {
    flag: readFileSync(join(dir, `${label}.flag`), "utf8"),
    reason: readFileSync(join(dir, `${label}.reason`), "utf8"),
    state: readFileSync(join(dir, `${label}.state.json`), "utf8")
  };
}

/** Every file under root, relative and sorted — the cheap-open census. */
function walkRelative(root: string, dir: string = root): string[] {
  return readdirSync(dir)
    .flatMap((entry) => {
      const path = join(dir, entry);
      return statSync(path).isDirectory() ? walkRelative(root, path) : [relative(root, path)];
    })
    .sort();
}

// ---------------------------------------------------------------------------
// deriveFindingState — stateless lifecycle derivation
// ---------------------------------------------------------------------------

describe("deriveFindingState (stateless lifecycle derivation)", () => {
  it("derives an inactive empty state for a finding with no events", () => {
    const base = makeTmpBase();
    const state = findingStateOf(deriveFindingState(store, "scope-empty", "finding-none", base));
    expect(state.finding_id).toBe("finding-none");
    expect(state.event_count).toBe(0);
    expect(state.opened).toBe(false);
    expect(state.owned).toBe(false);
    expect(state.delivered).toBe(false);
    expect(state.closed).toBe(false);
    expect(state.active).toBe(false);
    expect(state.owner_roles).toEqual([]);
    expect(state.missing_prerequisites).toEqual(["FINDING_OWNED", "FINDING_DELIVERED"]);
  });

  it("derives the full lifecycle: opened, then active once owned AND delivered, then closed", () => {
    const base = makeTmpBase();
    const scope = "scope-lifecycle";
    const objectiveId = "obj-lifecycle";
    const findingId = "finding-1";
    seedFinding(base, scope, findingOpened(objectiveId, findingId));

    const opened = findingStateOf(deriveFindingState(store, scope, findingId, base));
    expect(opened.opened).toBe(true);
    expect(opened.active).toBe(false);
    expect(opened.missing_prerequisites).toEqual(["FINDING_OWNED", "FINDING_DELIVERED"]);

    // Owned alone is not active (GD-DEC-005 requires BOTH bindings).
    seedFinding(base, scope, findingOwned(objectiveId, findingId, "B/DEV-1"));
    const owned = findingStateOf(deriveFindingState(store, scope, findingId, base));
    expect(owned.owned).toBe(true);
    expect(owned.delivered).toBe(false);
    expect(owned.active).toBe(false);
    expect(owned.owner_roles).toEqual(["B/DEV-1"]);
    expect(owned.missing_prerequisites).toEqual(["FINDING_DELIVERED"]);

    seedFinding(base, scope, findingDelivered(objectiveId, findingId));
    const active = findingStateOf(deriveFindingState(store, scope, findingId, base));
    expect(active.active).toBe(true);
    expect(active.missing_prerequisites).toEqual([]);
    expect(active.event_count).toBe(3);

    seedFinding(base, scope, findingClosed(objectiveId, findingId));
    const closed = findingStateOf(deriveFindingState(store, scope, findingId, base));
    expect(closed.closed).toBe(true);
    expect(closed.active).toBe(false);
    expect(closed.event_count).toBe(4);
    expect(closed.opened_event_ids).toHaveLength(1);
    expect(closed.owned_event_ids).toHaveLength(1);
    expect(closed.delivered_event_ids).toHaveLength(1);
    expect(closed.closed_event_ids).toHaveLength(1);
  });

  it("is deterministic and stateless: repeated derivation over the same log is identical", () => {
    const base = makeTmpBase();
    const scope = "scope-derive-det";
    seedFinding(base, scope, findingOpened("obj-det", "finding-det"));
    seedFinding(base, scope, findingOwned("obj-det", "finding-det", "B/QA-1"));

    const first = deriveFindingState(store, scope, "finding-det", base);
    const second = deriveFindingState(store, scope, "finding-det", base);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.state).toEqual(first.state);
  });

  it("fails closed with a named rejection when the store, scope, or finding_id is unusable", () => {
    const noStore = deriveFindingState({} as never, "scope-x", "finding-x");
    expect(noStore.ok).toBe(false);
    if (noStore.ok) return;
    expect(noStore.rejections[0].code).toBe("store_unavailable");

    const badScope = deriveFindingState(store, "", "finding-x");
    expect(badScope.ok).toBe(false);
    if (badScope.ok) return;
    expect(badScope.rejections[0].field).toBe("scope");

    const badFinding = deriveFindingState(store, "scope-x", "  ");
    expect(badFinding.ok).toBe(false);
    if (badFinding.ok) return;
    expect(badFinding.rejections[0].field).toBe("finding_id");
  });
});

// ---------------------------------------------------------------------------
// evaluateFindingClosure — registry negative control #9
// ---------------------------------------------------------------------------

describe("evaluateFindingClosure (finding_not_active refusals)", () => {
  it("refuses by name for an unowned, undelivered finding, citing BOTH missing prerequisites", () => {
    const base = makeTmpBase();
    const scope = "scope-close-refused";
    seedFinding(base, scope, findingOpened("obj-close", "finding-unowned"));

    const refusal = closureRefusalOf(evaluateFindingClosure(store, scope, "finding-unowned", base));
    expect(refusal.name).toBe(FINDING_REFUSAL_NAME);
    expect(refusal.code).toBe(FINDING_NOT_ACTIVE_CODE);
    expect(refusal.code).toBe("finding_not_active");
    expect(refusal.event_class).toBe("FINDING");
    expect(refusal.field).toBe("finding_id");
    expect(refusal.finding_id).toBe("finding-unowned");
    expect(refusal.missing_prerequisites).toEqual(["FINDING_OWNED", "FINDING_DELIVERED"]);
    expect(refusal.detail).toContain("FINDING_OWNED");
    expect(refusal.detail).toContain("FINDING_DELIVERED");
  });

  it("refuses by name for an owned-but-undelivered finding, citing FINDING_DELIVERED", () => {
    const base = makeTmpBase();
    const scope = "scope-close-owned";
    seedFinding(base, scope, findingOpened("obj-close", "finding-owned"));
    seedFinding(base, scope, findingOwned("obj-close", "finding-owned", "B/DEV-1"));

    const refusal = closureRefusalOf(evaluateFindingClosure(store, scope, "finding-owned", base));
    expect(refusal.code).toBe("finding_not_active");
    expect(refusal.missing_prerequisites).toEqual(["FINDING_DELIVERED"]);
    expect(refusal.detail).toContain("FINDING_DELIVERED");
    expect(refusal.detail).not.toContain("missing prerequisite event(s): FINDING_OWNED");
  });

  it("refuses by name for a delivered-but-unowned finding, citing FINDING_OWNED", () => {
    const base = makeTmpBase();
    const scope = "scope-close-delivered";
    seedFinding(base, scope, findingOpened("obj-close", "finding-delivered"));
    seedFinding(base, scope, findingDelivered("obj-close", "finding-delivered"));

    const refusal = closureRefusalOf(evaluateFindingClosure(store, scope, "finding-delivered", base));
    expect(refusal.code).toBe("finding_not_active");
    expect(refusal.missing_prerequisites).toEqual(["FINDING_OWNED"]);
  });

  it("refuses by name for a finding with no events at all (never logged is never active)", () => {
    const base = makeTmpBase();
    const refusal = closureRefusalOf(evaluateFindingClosure(store, "scope-close-none", "finding-ghost", base));
    expect(refusal.code).toBe("finding_not_active");
    expect(refusal.missing_prerequisites).toEqual(["FINDING_OWNED", "FINDING_DELIVERED"]);
  });

  it("permits closing an owned+delivered finding", () => {
    const base = makeTmpBase();
    const scope = "scope-close-permitted";
    seedFinding(base, scope, findingOpened("obj-close", "finding-ok"));
    seedFinding(base, scope, findingOwned("obj-close", "finding-ok", "B/DEV-1"));
    seedFinding(base, scope, findingDelivered("obj-close", "finding-ok"));

    const permitted = closurePermittedOf(evaluateFindingClosure(store, scope, "finding-ok", base));
    expect(permitted.finding_id).toBe("finding-ok");
    expect(permitted.state.active).toBe(true);
    expect(permitted.state.missing_prerequisites).toEqual([]);
  });

  it("is stateless: repeated evaluation over the same log yields the identical verdict", () => {
    const base = makeTmpBase();
    const scope = "scope-eval-det";
    seedFinding(base, scope, findingOpened("obj-det", "finding-det"));

    const first = evaluateFindingClosure(store, scope, "finding-det", base);
    const second = evaluateFindingClosure(store, scope, "finding-det", base);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.permitted).toBe(false);
    expect(second.permitted).toBe(false);
    if (first.permitted || second.permitted) return;
    expect(second.refusal).toEqual(first.refusal);
    expect(second.state).toEqual(first.state);
  });

  it("fails closed with a named rejection when the store is unusable", () => {
    const noStore = evaluateFindingClosure({} as never, "scope-x", "finding-x");
    expect(noStore.ok).toBe(false);
    if (noStore.ok) return;
    expect(noStore.rejections[0].code).toBe("store_unavailable");
  });
});

// ---------------------------------------------------------------------------
// countActiveFindings — the intervention-duty guard
// ---------------------------------------------------------------------------

describe("countActiveFindings (intervention-duty guard)", () => {
  it("counts only owner-bound findings with delivery events; unowned findings are excluded", () => {
    const base = makeTmpBase();
    const scope = "scope-duty";
    const objectiveId = "obj-duty";

    // finding-active: the full GD-DEC-005 binding (owned + delivered).
    seedFinding(base, scope, findingOpened(objectiveId, "finding-active"));
    seedFinding(base, scope, findingOwned(objectiveId, "finding-active", "B/DEV-1"));
    seedFinding(base, scope, findingDelivered(objectiveId, "finding-active"));

    // finding-logged: opened only — logged, never driven; must not count.
    seedFinding(base, scope, findingOpened(objectiveId, "finding-logged"));

    // finding-owned: owner-bound but never delivered; must not count.
    seedFinding(base, scope, findingOpened(objectiveId, "finding-owned"));
    seedFinding(base, scope, findingOwned(objectiveId, "finding-owned", "B/QA-1"));

    // finding-closed: was active, now closed; no longer an intervention duty.
    seedFinding(base, scope, findingOpened(objectiveId, "finding-closed"));
    seedFinding(base, scope, findingOwned(objectiveId, "finding-closed", "B/DEV-1"));
    seedFinding(base, scope, findingDelivered(objectiveId, "finding-closed"));
    seedFinding(base, scope, findingClosed(objectiveId, "finding-closed"));

    const result = activeCountOf(countActiveFindings(store, scope, base));
    expect(result.count).toBe(1);
    expect(result.active_finding_ids).toEqual(["finding-active"]);
    expect(result.inactive_finding_ids).toEqual(["finding-logged", "finding-owned", "finding-closed"]);
  });

  it("derives a zero count for a scope with no findings", () => {
    const base = makeTmpBase();
    const result = activeCountOf(countActiveFindings(store, "scope-duty-empty", base));
    expect(result.count).toBe(0);
    expect(result.active_finding_ids).toEqual([]);
    expect(result.inactive_finding_ids).toEqual([]);
  });

  it("is stateless: repeated counting over the same log yields the identical result", () => {
    const base = makeTmpBase();
    const scope = "scope-duty-det";
    seedFinding(base, scope, findingOpened("obj-det", "finding-a"));
    seedFinding(base, scope, findingOwned("obj-det", "finding-a", "B/DEV-1"));
    seedFinding(base, scope, findingDelivered("obj-det", "finding-a"));

    const first = countActiveFindings(store, scope, base);
    const second = countActiveFindings(store, scope, base);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second).toEqual(first);
  });

  it("fails closed with a named rejection when the store or scope is unusable", () => {
    const noStore = countActiveFindings({} as never, "scope-x");
    expect(noStore.ok).toBe(false);
    if (noStore.ok) return;
    expect(noStore.rejections[0].code).toBe("store_unavailable");

    const badScope = countActiveFindings(store, "");
    expect(badScope.ok).toBe(false);
    if (badScope.ok) return;
    expect(badScope.rejections[0].field).toBe("scope");
  });
});

// ---------------------------------------------------------------------------
// Per-finding isolation
// ---------------------------------------------------------------------------

describe("finding ownership per-finding isolation", () => {
  it("leaves other findings unaffected when one finding becomes active", () => {
    const base = makeTmpBase();
    const scope = "scope-isolation";

    // finding-a reaches the full active binding.
    seedFinding(base, scope, findingOpened("obj-a", "finding-a"));
    seedFinding(base, scope, findingOwned("obj-a", "finding-a", "B/DEV-1"));
    seedFinding(base, scope, findingDelivered("obj-a", "finding-a"));

    // finding-b (same objective) and finding-c (a different objective) stay logged-only.
    seedFinding(base, scope, findingOpened("obj-a", "finding-b"));
    seedFinding(base, scope, findingOpened("obj-c", "finding-c"));

    const aPermitted = closurePermittedOf(evaluateFindingClosure(store, scope, "finding-a", base));
    expect(aPermitted.state.active).toBe(true);

    // Finding B's closure is refused by name; A's activity never leaks across.
    const bRefusal = closureRefusalOf(evaluateFindingClosure(store, scope, "finding-b", base));
    expect(bRefusal.code).toBe("finding_not_active");
    expect(bRefusal.finding_id).toBe("finding-b");
    expect(bRefusal.missing_prerequisites).toEqual(["FINDING_OWNED", "FINDING_DELIVERED"]);

    const cRefusal = closureRefusalOf(evaluateFindingClosure(store, scope, "finding-c", base));
    expect(cRefusal.code).toBe("finding_not_active");

    const duty = activeCountOf(countActiveFindings(store, scope, base));
    expect(duty.count).toBe(1);
    expect(duty.active_finding_ids).toEqual(["finding-a"]);
    expect(duty.inactive_finding_ids).toEqual(["finding-b", "finding-c"]);
  });
});

// ---------------------------------------------------------------------------
// odin-watch writers — flag-gated FINDING_OPENED emission
// ---------------------------------------------------------------------------

describe("writeWakeFiles governance emission (flag-gated)", () => {
  it("flag off is byte-identical with or without an injected store, and touches no registry", () => {
    const controlDir = join(makeTmpBase(), "flags-control");
    const storeDir = join(makeTmpBase(), "flags-store");
    const registryBase = join(makeTmpBase(), ".odin", "registry");
    const state = makeWakeState(1, ["AMBIGUOUS_STATE", "SCOPE_DRIFT"]);

    // Control: no options at all. The process env is pinned flag-off for the
    // duration so a developer shell cannot flip the control run.
    const savedFlag = process.env.ODIN_GOVDISP_REGISTRY_MCP;
    delete process.env.ODIN_GOVDISP_REGISTRY_MCP;
    try {
      writeWakeFiles(controlDir, "dev-a", state);
    } finally {
      if (savedFlag !== undefined) process.env.ODIN_GOVDISP_REGISTRY_MCP = savedFlag;
    }

    // Flag explicitly off with a store injected: the seam stays inert.
    writeWakeFiles(storeDir, "dev-a", state, { store, registryBase, env: {} });

    expect(wakeFileContents(storeDir, "dev-a")).toEqual(wakeFileContents(controlDir, "dev-a"));
    expect(readdirSync(storeDir).sort()).toEqual(["dev-a.flag", "dev-a.reason", "dev-a.state.json"]);
    // No registry traffic: the registry base was never even created.
    expect(existsSync(registryBase)).toBe(false);
  });

  it("flag on emits one FINDING_OPENED through the injected service seam (cheap-open: zero new files outside the registry base)", () => {
    const root = makeTmpBase();
    const flagDir = join(root, "flags");
    const registryBase = join(root, ".odin", "registry");
    const state = makeWakeState(1, ["AMBIGUOUS_STATE"]);

    writeWakeFiles(flagDir, "dev-a", state, {
      store,
      registryBase,
      env: { ODIN_GOVDISP_REGISTRY_MCP: "1" },
      eventId: "evt-watch-1"
    });

    // The three wake files are exactly the flag-off contract.
    const contents = wakeFileContents(flagDir, "dev-a");
    expect(contents.flag).toBe("1");
    expect(contents.reason).toBe("AMBIGUOUS_STATE");
    expect(JSON.parse(contents.state)).toEqual(state);

    // Exactly one FINDING_OPENED event landed via the service append path.
    const queried = queryRegistryEvents("odin-watch", { event_class: "FINDING" }, registryBase);
    expect(queried.ok).toBe(true);
    if (!queried.ok) return;
    expect(queried.events).toHaveLength(1);
    const event = queried.events[0];
    expect(event.event_class).toBe("FINDING");
    if (event.event_class !== "FINDING") return;
    expect(event.event_type).toBe("FINDING_OPENED");
    expect(event.event_id).toBe("evt-watch-1");
    expect(event.ts).toBe(state.ts);
    expect(event.finding_id).toBe("odin-watch-dev-a");
    expect(event.stable_objective_id).toBe("odin-watch-dev-a");

    // Cheap-open (DIS-001): the census of the whole root is the three wake
    // files plus the single append-only registry log — no Markdown, no
    // human-view document, nothing else.
    expect(walkRelative(root)).toEqual([
      ".odin/registry/odin-watch/events.jsonl",
      "flags/dev-a.flag",
      "flags/dev-a.reason",
      "flags/dev-a.state.json"
    ]);
  });

  it("flag on without a store fails closed: wake files stay byte-identical and the refusal is surfaced", () => {
    const controlDir = join(makeTmpBase(), "flags-control");
    const flagDir = join(makeTmpBase(), "flags-nostore");
    const state = makeWakeState(0, ["ALL_CLEAR"]);

    writeWakeFiles(controlDir, "dev-a", state, { env: {} });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let thrown: unknown;
    try {
      writeWakeFiles(flagDir, "dev-a", state, { env: { ODIN_GOVDISP_REGISTRY_MCP: "true" } });
    } catch (error) {
      thrown = error;
    }
    const diagnostics = errorSpy.mock.calls.map((call) => String(call[0]));
    errorSpy.mockRestore();
    expect(thrown).toBeUndefined();
    expect(diagnostics.some((line) => line.includes("store_unavailable"))).toBe(true);
    expect(wakeFileContents(flagDir, "dev-a")).toEqual(wakeFileContents(controlDir, "dev-a"));
  });

  it("a non-truthy flag value never half-activates the emission", () => {
    const root = makeTmpBase();
    const flagDir = join(root, "flags");
    const registryBase = join(root, ".odin", "registry");
    const state = makeWakeState(1, ["X"]);

    writeWakeFiles(flagDir, "dev-a", state, { store, registryBase, env: { ODIN_GOVDISP_REGISTRY_MCP: "0" } });

    expect(readdirSync(flagDir).sort()).toEqual(["dev-a.flag", "dev-a.reason", "dev-a.state.json"]);
    expect(existsSync(registryBase)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Service surface
// ---------------------------------------------------------------------------

describe("finding ownership service surface", () => {
  it("exposes the derivation, closure evaluator, and duty guard on the protocol service", async () => {
    const { createProtocolService } = await import("../../src/protocol/service.js");
    const service = createProtocolService();
    expect(typeof service.deriveFindingState).toBe("function");
    expect(typeof service.evaluateFindingClosure).toBe("function");
    expect(typeof service.countActiveFindings).toBe("function");
  });
});
