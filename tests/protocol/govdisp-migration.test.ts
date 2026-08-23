import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendRegistryEvent,
  queryRegistryEvents
} from "../../src/protocol/event-registry/index.js";
import {
  getBootReceiptExamples,
  getDelegationPacket,
  GOVDISP_REGISTRY_AUTHORITY_FLAG_ENV_VAR,
  isGovdispRegistryAuthorityEnabled,
  REGISTRY_AUTHORITY_UNRESOLVED_CODE,
  REGISTRY_RECEIPT_AUTHORITY_EVENT_CLASSES,
  validateBootReceipt,
  validateCmuxDeliveryProof,
  validateDelegationPacket,
  validateInstructionReadProof,
  validateTeamManifest,
  type GovdispRegistryStoreLike,
  type RegistryAuthorityOptions,
  type RegistryModeValidationResult
} from "../../src/protocol/service.js";

// ---------------------------------------------------------------------------
// STORY-GOVDISP-005 — registry-mode branches for the prose-receipt validators
// (SLICE-GOVDISP-MIG-DEV-001; GD-FP-013: never two independently-editable
// authorities for one fact).
//
// Behind the ODIN_GOVDISP_REGISTRY_MCP compatibility flag (ON by default as
// of 0.6.0 — Amendment 46; a non-truthy value is the explicit opt-out),
// each of the five prose-receipt validators accepts registry_authority:
// (SLICE-GOVDISP-DEFAULT-DEV-001: postures inverted — mode-off cases pin an
// explicit opt-out value; default-posture cases assert registry mode active.)
// { scope, event_id } as a typed registry event reference. A resolved
// reference is the single authority (prose becomes transport/history); an
// unresolvable reference is rejected by name (registry_authority_unresolved)
// with no silent prose fallback; a prose-only payload validates exactly as
// before with authority: "prose_transport" as an advisory. The explicit
// opt-out is byte-compatible with the baseline.
//
// These tests use the REAL registry storage module (temp-dir base) injected
// into the service layer, mirroring tests/protocol/govdisp-ownership.test.ts.
// ---------------------------------------------------------------------------

const store: GovdispRegistryStoreLike = { appendRegistryEvent, queryRegistryEvents };

const FLAG_ON = { [GOVDISP_REGISTRY_AUTHORITY_FLAG_ENV_VAR]: "1" } as const;

const tmpRoots: string[] = [];

function makeTmpBase(): string {
  const dir = mkdtempSync(join(tmpdir(), "odin-govdisp-mig-"));
  tmpRoots.push(dir);
  return dir;
}

afterEach(() => {
  while (tmpRoots.length > 0) {
    const dir = tmpRoots.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function seedEvent(base: string, scope: string, event: unknown): void {
  const result = appendRegistryEvent(scope, event, base);
  expect(result.ok).toBe(true);
}

/** A TERMINAL-class event — the registry's outcome record and the only class
 *  accepted as receipt authority (it persists content hashes, binding the
 *  artifact body by hash). */
function terminalAuthorityEvent(eventId: string) {
  return {
    schema_version: "govdisp.event.v1",
    event_id: eventId,
    ts: "2026-08-23T00:00:00Z",
    stable_objective_id: "obj-mig-001",
    event_class: "TERMINAL" as const,
    event_type: "TERMINAL_COMPLETED" as const,
    content_hashes: [{ path: "receipts/artifact.json", sha256: "a".repeat(64) }]
  };
}

/** A FINDING-class event — governance machinery, never receipt authority. */
function findingEvent(eventId: string) {
  return {
    schema_version: "govdisp.event.v1",
    event_id: eventId,
    ts: "2026-08-23T00:00:00Z",
    stable_objective_id: "obj-mig-001",
    event_class: "FINDING" as const,
    event_type: "FINDING_OPENED" as const,
    finding_id: "finding-mig-1"
  };
}

// --- Valid prose payloads (each validates clean under the baseline) ---------

function validCmuxProof(): Record<string, unknown> {
  return {
    target_surface_locator: "workspace:1 pane:b surface:dev-1",
    submitted: true,
    verification_method: "cmux read-screen",
    observed_processing_state: "DELIVERED_ACKED",
    timestamp: "2026-08-23T00:00:00Z",
    sender_role: "A/EXEC-PM"
  };
}

function validInstructionReadProof(): Record<string, unknown> {
  return {
    role: "B/DEV-1",
    generated_at: "2026-08-23T00:00:00Z",
    files: [{ path: "protocol/SCP.md", bytes: 4175, sha256: "b".repeat(64) }]
  };
}

function validDelegationPacket(): Record<string, unknown> {
  return getDelegationPacket({
    sourceRole: "A/EXEC-PM",
    targetRoleSlot: "B/DEV-1",
    task: "implement the assigned slice",
    mayImplement: true
  });
}

function validBootReceipt(): Record<string, unknown> {
  return { ...getBootReceiptExamples().pm };
}

function validTeamManifest(): Record<string, unknown> {
  return {
    session_id: "session-1",
    topology: {},
    executive_office: ["A/EXEC-PM", "A/EXEC-ODIN"],
    development_pods: ["B"],
    odin_mesh: {},
    model_profile: {},
    handoff_sources: [".odin/handoffs/"],
    startup_objectives: ["bootstrap"]
  };
}

type ValidatorHarness = {
  name: string;
  validate: (payload: Record<string, unknown>, options: RegistryAuthorityOptions) => RegistryModeValidationResult;
  validProse: () => Record<string, unknown>;
  /** Prose that the baseline rejects (missing required fields). */
  brokenProse: () => Record<string, unknown>;
};

const VALIDATORS: ValidatorHarness[] = [
  {
    name: "validateBootReceipt",
    validate: (payload, options) => validateBootReceipt(payload, undefined, options),
    validProse: validBootReceipt,
    brokenProse: () => ({})
  },
  {
    name: "validateCmuxDeliveryProof",
    validate: (payload, options) => validateCmuxDeliveryProof(payload, options),
    validProse: validCmuxProof,
    brokenProse: () => ({})
  },
  {
    name: "validateInstructionReadProof",
    validate: (payload, options) => validateInstructionReadProof(payload, options),
    validProse: validInstructionReadProof,
    brokenProse: () => ({})
  },
  {
    name: "validateDelegationPacket",
    validate: (payload, options) => validateDelegationPacket(payload, undefined, options),
    validProse: validDelegationPacket,
    brokenProse: () => ({})
  },
  {
    name: "validateTeamManifest",
    validate: (payload, options) => validateTeamManifest(payload, undefined, options),
    validProse: validTeamManifest,
    brokenProse: () => ({})
  }
];

function unresolvedOf(result: RegistryModeValidationResult) {
  expect(result.valid).toBe(false);
  expect(result.invalid).toEqual(["registry_authority"]);
  expect(result.registry_authority?.status).toBe("unresolved");
  if (result.registry_authority?.status !== "unresolved") throw new Error("unreachable");
  expect(result.registry_authority.code).toBe(REGISTRY_AUTHORITY_UNRESOLVED_CODE);
  expect(result.registry_authority.code).toBe("registry_authority_unresolved");
  expect(result.warnings.join("\n")).toContain("registry_authority_unresolved");
  return result.registry_authority;
}

// ---------------------------------------------------------------------------
// Flag reading (the odin-watch writers / MCP-server truthy convention)
// ---------------------------------------------------------------------------

describe("isGovdispRegistryAuthorityEnabled (flag convention)", () => {
  it("is enabled only by an explicit truthy value (1/true/yes/on, case- and whitespace-insensitive)", () => {
    for (const value of ["1", "true", "yes", "on", " TRUE ", "On"]) {
      expect(isGovdispRegistryAuthorityEnabled({ [GOVDISP_REGISTRY_AUTHORITY_FLAG_ENV_VAR]: value })).toBe(true);
    }
  });

  it("is ON by default for an unset or empty value (Amendment 46: unset = active)", () => {
    expect(isGovdispRegistryAuthorityEnabled({})).toBe(true);
    for (const value of ["", "   "]) {
      expect(isGovdispRegistryAuthorityEnabled({ [GOVDISP_REGISTRY_AUTHORITY_FLAG_ENV_VAR]: value })).toBe(true);
    }
  });

  it("stays OFF only under an explicit non-truthy opt-out value — a mistaken 0/false fully disables, never half-activates", () => {
    for (const value of ["0", "false", "off", "no", "enabled"]) {
      expect(isGovdispRegistryAuthorityEnabled({ [GOVDISP_REGISTRY_AUTHORITY_FLAG_ENV_VAR]: value })).toBe(false);
    }
  });

  it("declares TERMINAL as the only receipt-authority event class", () => {
    expect(REGISTRY_RECEIPT_AUTHORITY_EVENT_CLASSES).toEqual(["TERMINAL"]);
  });
});

// ---------------------------------------------------------------------------
// Per-validator matrix: mode OFF byte-compat, mode ON authority adjudication
// ---------------------------------------------------------------------------

for (const harness of VALIDATORS) {
  describe(`${harness.name} registry-mode branch`, () => {
    it("EXPLICIT OPT-OUT is byte-compatible with the baseline, with or without an injected store", () => {
      const base = makeTmpBase();
      const optOutEnv = { [GOVDISP_REGISTRY_AUTHORITY_FLAG_ENV_VAR]: "0" } as const;
      const baselineValid = harness.validate(harness.validProse(), { env: optOutEnv });
      const baselineBroken = harness.validate(harness.brokenProse(), { env: optOutEnv });
      const offValid = harness.validate(harness.validProse(), { store, base, env: optOutEnv });
      const offBroken = harness.validate(harness.brokenProse(), { store, base, env: optOutEnv });
      expect(offValid).toEqual(baselineValid);
      expect(offBroken).toEqual(baselineBroken);
      expect("authority" in offValid).toBe(false);
      expect("registry_authority" in offValid).toBe(false);
      expect(baselineValid.valid).toBe(true);
      expect(baselineBroken.valid).toBe(false);
    });

    it("EXPLICIT OPT-OUT leaves a registry_authority field inert (never read, never surfaced)", () => {
      const base = makeTmpBase();
      const optOutEnv = { [GOVDISP_REGISTRY_AUTHORITY_FLAG_ENV_VAR]: "0" } as const;
      const withReference = {
        ...harness.validProse(),
        registry_authority: { scope: "receipts", event_id: "evt-inert" }
      };
      const result = harness.validate(withReference, { store, base, env: optOutEnv });
      expect(result).toEqual(harness.validate(harness.validProse(), { env: optOutEnv }));
      expect("authority" in result).toBe(false);
      expect(result.valid).toBe(true);
    });

    it("DEFAULT POSTURE (flag unset) is registry-active: prose-only payloads carry the prose_transport advisory", () => {
      const base = makeTmpBase();
      const on = harness.validate(harness.validProse(), { store, base, env: {} });
      expect(on.valid).toBe(true);
      expect(on.authority).toBe("prose_transport");

      // The advisory is NOT a rejection: broken prose stays broken by default too.
      const broken = harness.validate(harness.brokenProse(), { store, base, env: {} });
      expect(broken.valid).toBe(false);
      expect(broken.authority).toBe("prose_transport");
      expect(broken.missing.length + broken.invalid.length).toBeGreaterThan(0);
    });

    it("DEFAULT POSTURE (flag unset) adjudicates registry_authority references (resolve + named rejection)", () => {
      const base = makeTmpBase();
      seedEvent(base, "receipts", terminalAuthorityEvent("evt-auth-default"));
      const resolved = harness.validate(
        { ...harness.brokenProse(), registry_authority: { scope: "receipts", event_id: "evt-auth-default" } },
        { store, base, env: {} }
      );
      expect(resolved.valid).toBe(true);
      expect(resolved.authority).toBe("registry");
      expect(resolved.registry_authority).toEqual({
        status: "resolved",
        scope: "receipts",
        event_id: "evt-auth-default",
        event_class: "TERMINAL"
      });

      const dangling = harness.validate(
        { ...harness.validProse(), registry_authority: { scope: "receipts", event_id: "evt-never-seeded" } },
        { store, base, env: {} }
      );
      expect(unresolvedOf(dangling).event_id).toBe("evt-never-seeded");
    });

    it("MODE ON validates prose-only payloads as before, carrying the prose_transport advisory", () => {
      const base = makeTmpBase();
      const on = harness.validate(harness.validProse(), { store, base, env: FLAG_ON });
      expect(on.valid).toBe(true);
      expect(on.authority).toBe("prose_transport");

      // The advisory is NOT a rejection: broken prose stays broken under mode ON.
      const broken = harness.validate(harness.brokenProse(), { store, base, env: FLAG_ON });
      expect(broken.valid).toBe(false);
      expect(broken.authority).toBe("prose_transport");
      expect(broken.missing.length + broken.invalid.length).toBeGreaterThan(0);
    });

    it("MODE ON accepts a resolved registry reference as the single authority, even over broken prose", () => {
      const base = makeTmpBase();
      seedEvent(base, "receipts", terminalAuthorityEvent("evt-auth-1"));
      const result = harness.validate(
        { ...harness.brokenProse(), registry_authority: { scope: "receipts", event_id: "evt-auth-1" } },
        { store, base, env: FLAG_ON }
      );
      expect(result.valid).toBe(true);
      expect(result.authority).toBe("registry");
      expect(result.missing).toEqual([]);
      expect(result.invalid).toEqual([]);
      expect(result.registry_authority).toEqual({
        status: "resolved",
        scope: "receipts",
        event_id: "evt-auth-1",
        event_class: "TERMINAL"
      });
    });

    it("MODE ON rejects an unresolvable reference by name, even over fully valid prose (no silent fallback)", () => {
      const base = makeTmpBase();
      seedEvent(base, "receipts", terminalAuthorityEvent("evt-auth-1"));
      const result = harness.validate(
        { ...harness.validProse(), registry_authority: { scope: "receipts", event_id: "evt-missing" } },
        { store, base, env: FLAG_ON }
      );
      const rejection = unresolvedOf(result);
      expect(rejection.scope).toBe("receipts");
      expect(rejection.event_id).toBe("evt-missing");
      expect(rejection.detail).toContain("evt-missing");
    });

    it("MODE ON rejects a reference to an existing event of the WRONG class (artifact-class mismatch)", () => {
      const base = makeTmpBase();
      seedEvent(base, "receipts", findingEvent("evt-finding-1"));
      const result = harness.validate(
        { ...harness.validProse(), registry_authority: { scope: "receipts", event_id: "evt-finding-1" } },
        { store, base, env: FLAG_ON }
      );
      const rejection = unresolvedOf(result);
      expect(rejection.detail).toContain("FINDING");
      expect(rejection.detail).toContain("does not match the artifact class");
    });

    it("MODE ON rejects a malformed reference by name (shape, scope, event_id)", () => {
      const base = makeTmpBase();
      const notAnObject = harness.validate(
        { ...harness.validProse(), registry_authority: "evt-auth-1" },
        { store, base, env: FLAG_ON }
      );
      expect(unresolvedOf(notAnObject).detail).toContain("must be an object");

      const emptyScope = harness.validate(
        { ...harness.validProse(), registry_authority: { scope: "  ", event_id: "evt-auth-1" } },
        { store, base, env: FLAG_ON }
      );
      expect(unresolvedOf(emptyScope).detail).toContain("scope");

      const missingEventId = harness.validate(
        { ...harness.validProse(), registry_authority: { scope: "receipts" } },
        { store, base, env: FLAG_ON }
      );
      expect(unresolvedOf(missingEventId).detail).toContain("event_id");
    });

    it("MODE ON without an injected store fails closed with the store_unavailable detail", () => {
      const result = harness.validate(
        { ...harness.validProse(), registry_authority: { scope: "receipts", event_id: "evt-auth-1" } },
        { env: FLAG_ON }
      );
      expect(unresolvedOf(result).detail).toContain("store_unavailable");
    });
  });
}

// ---------------------------------------------------------------------------
// GD-FP-013 — the no-dual-authority guarantee
// ---------------------------------------------------------------------------

describe("GD-FP-013 no dual authority (a single fact is never validated from two places independently)", () => {
  it("boot receipt: when a reference is present, the registry alone decides — prose validity is never consulted", () => {
    const base = makeTmpBase();
    const scope = "receipts-fp013";
    seedEvent(base, scope, terminalAuthorityEvent("evt-fact"));

    const prose = validBootReceipt();

    // (a) Reference RESOLVES: the registry event is the single authority. The
    // same fact in prose is deliberately corrupted (a role emptied, a boolean
    // re-typed); the verdict still comes from the registry alone and the
    // prose corruption never enters missing/invalid.
    const corrupted = {
      ...prose,
      role: "",
      may_implement: "yes",
      registry_authority: { scope, event_id: "evt-fact" }
    };
    const registryWins = validateBootReceipt(corrupted, undefined, { store, base, env: FLAG_ON });
    expect(registryWins.valid).toBe(true);
    expect(registryWins.authority).toBe("registry");
    expect(registryWins.missing).toEqual([]);
    expect(registryWins.invalid).toEqual([]);

    // (b) Reference DANGLES over the SAME fact with FULLY VALID prose: the
    // payload is rejected by name — the valid prose is never silently promoted
    // to a second authority.
    const dangling = {
      ...prose,
      registry_authority: { scope, event_id: "evt-never-recorded" }
    };
    const refused = validateBootReceipt(dangling, undefined, { store, base, env: FLAG_ON });
    expect(refused.valid).toBe(false);
    expect(refused.invalid).toEqual(["registry_authority"]);
    expect(refused.registry_authority?.status).toBe("unresolved");
    if (refused.registry_authority?.status === "unresolved") {
      expect(refused.registry_authority.code).toBe("registry_authority_unresolved");
    }

    // Together: for the payload's single fact, exactly one authority spoke in
    // each case — (a) ignored the prose entirely, (b) refused rather than let
    // the prose speak. There is no validation state in which the registry and
    // the prose independently validated the same fact.
  });

  it("delegation packet: an embedded delivery_proof adjudicates through the same single-authority branch", () => {
    const base = makeTmpBase();
    const scope = "receipts-nested";
    seedEvent(base, scope, terminalAuthorityEvent("evt-delivery"));

    // Resolved reference on the embedded proof: the packet validates with the
    // proof's registry authority winning over its (broken) prose.
    const resolvedPacket = validDelegationPacket();
    resolvedPacket.delivery_proof = {
      registry_authority: { scope, event_id: "evt-delivery" }
    };
    const resolved = validateDelegationPacket(resolvedPacket, undefined, { store, base, env: FLAG_ON });
    expect(resolved.valid).toBe(true);
    expect(resolved.authority).toBe("prose_transport");
    expect(resolved.invalid).toEqual([]);

    // Dangling reference on the embedded proof: the named rejection propagates
    // into the packet as delivery_proof.registry_authority — no prose fallback.
    const danglingPacket = validDelegationPacket();
    danglingPacket.delivery_proof = {
      ...validCmuxProof(),
      registry_authority: { scope, event_id: "evt-not-recorded" }
    };
    const refused = validateDelegationPacket(danglingPacket, undefined, { store, base, env: FLAG_ON });
    expect(refused.valid).toBe(false);
    expect(refused.invalid).toContain("delivery_proof.registry_authority");
    expect(refused.warnings.join("\n")).toContain("registry_authority_unresolved");
  });
});

// ---------------------------------------------------------------------------
// Service surface (wrappers keep the exported names; default posture is
// registry-active — Amendment 46)
// ---------------------------------------------------------------------------

describe("registry-mode service surface", () => {
  it("exposes the five validators through the protocol service; default posture is registry-active", async () => {
    const { createProtocolService } = await import("../../src/protocol/service.js");
    const service = createProtocolService();
    expect(typeof service.validateBootReceipt).toBe("function");
    expect(typeof service.validateCmuxDeliveryProof).toBe("function");
    expect(typeof service.validateInstructionReadProof).toBe("function");
    expect(typeof service.validateDelegationPacket).toBe("function");
    expect(typeof service.validateTeamManifest).toBe("function");

    // Amendment 46: with the flag unset (pinned here so a developer shell
    // cannot flip it) the default posture is registry mode ON — a prose-only
    // payload validates as before and carries the prose_transport advisory.
    const savedFlag = process.env[GOVDISP_REGISTRY_AUTHORITY_FLAG_ENV_VAR];
    delete process.env[GOVDISP_REGISTRY_AUTHORITY_FLAG_ENV_VAR];
    try {
      const result = service.validateCmuxDeliveryProof(validCmuxProof());
      expect(result.valid).toBe(true);
      expect(result.authority).toBe("prose_transport");
    } finally {
      if (savedFlag !== undefined) process.env[GOVDISP_REGISTRY_AUTHORITY_FLAG_ENV_VAR] = savedFlag;
    }
  });
});
