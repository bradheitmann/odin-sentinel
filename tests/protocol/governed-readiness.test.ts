import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  classifyGovernedReadiness,
  evaluateReadinessGate,
  getHarnessProbeMatrix,
  harnessCategory,
  validateGovernedContextProof
} from "../../src/protocol/service.js";

const gcVerifierPath = fileURLToPath(new URL("../../scripts/protocol/verify-governed-context.mjs", import.meta.url));
// @ts-ignore - governed-context verifier is an ESM .mjs module without declaration files.
const gc = await import("../../scripts/protocol/verify-governed-context.mjs");

const MARKER = "SCP_PUBLIC_VERSION: 0.4.9";

function validProof(
  overrides: Record<string, unknown> = {},
  controlOverrides: Record<string, unknown> = {},
  uptakeOverrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    schema: "odin.governed_context_proof.v1",
    role: "B/DEV-1",
    harness: "Claude Code",
    source_type: "native_skill",
    control_source: { marker: MARKER, ...controlOverrides },
    uptake_receipt: { method: "quoted_marker", evidence_marker: MARKER, observed: true, observed_at: "2026-06-04T05:00:00Z", ...uptakeOverrides },
    generated_at: "2026-06-04T05:00:00Z",
    ...overrides
  };
}

function runNode(scriptPath: string, args: string[]) {
  return spawnSync("node", [scriptPath, ...args], { encoding: "utf8" });
}

describe("validateGovernedContextProof (shape, no disk)", () => {
  it("accepts a well-formed native-skill proof and reports its assurance", () => {
    const result = validateGovernedContextProof(validProof());
    expect(result.valid).toBe(true);
    expect(result.proofAssurance).toBe("native_skill");
  });

  it("rejects a self-asserted uptake with no stable source marker (no bare booleans)", () => {
    const result = validateGovernedContextProof(validProof({}, {}, { evidence_marker: "" }));
    expect(result.valid).toBe(false);
    expect(result.reasons.join("\n")).toContain("evidence_marker");
  });

  it("rejects a missing control_source.marker", () => {
    const result = validateGovernedContextProof(validProof({}, { marker: "" }));
    expect(result.valid).toBe(false);
  });

  it("rejects a path present without a sha256 checksum", () => {
    const result = validateGovernedContextProof(validProof({}, { path: "SKILL.md" }));
    expect(result.valid).toBe(false);
    expect(result.reasons.join("\n")).toContain("sha256");
  });

  it("rejects a secret-looking value anywhere in the proof", () => {
    const result = validateGovernedContextProof(validProof({ note: "AUTH_TOKEN=sk-live-abcdefgh12345678" }));
    expect(result.valid).toBe(false);
    expect(result.reasons.join("\n")).toContain("secret");
  });
});

describe("harnessCategory registry (Quality #1)", () => {
  it("classifies native-skill, static-control-file, mcp-only, and unsupported harnesses", () => {
    expect(harnessCategory("Codex")).toBe("native_skill");
    expect(harnessCategory("Claude Code")).toBe("native_skill");
    expect(harnessCategory("Cursor")).toBe("static_control_file");
    expect(harnessCategory("Droid")).toBe("mcp_only");
    expect(harnessCategory("Pi")).toBe("unsupported");
    expect(harnessCategory("SomeUnknownHarness")).toBe("mcp_only");
  });
});

describe("classifyGovernedReadiness — per category, valid proof (Quality #1, #6)", () => {
  it("native-skill harness with a valid native proof + hooks is GOVERNED_READY", () => {
    const r = classifyGovernedReadiness({ harness: "Claude Code", installed: true, authenticated: true, hooksAvailable: true, governedContextProof: validProof({ harness: "Claude Code" }) });
    expect(r.state).toBe("GOVERNED_READY");
    expect(r.requiredAssurance).toBe("native_skill");
  });

  it("static-control-file harness with a valid static proof + hooks is GOVERNED_READY", () => {
    const r = classifyGovernedReadiness({
      harness: "Cursor",
      installed: true,
      authenticated: true,
      hooksAvailable: true,
      governedContextProof: validProof({ harness: "Cursor", source_type: "static_control_file" })
    });
    expect(r.state).toBe("GOVERNED_READY");
    expect(r.requiredAssurance).toBe("static_control_file");
  });

  it("mcp-only harness with a valid mcp_bootstrap proof + hooks is GOVERNED_READY", () => {
    const r = classifyGovernedReadiness({
      harness: "Droid",
      installed: true,
      authenticated: true,
      hooksAvailable: true,
      governedContextProof: validProof({ harness: "Droid", source_type: "mcp_bootstrap" })
    });
    expect(r.state).toBe("GOVERNED_READY");
  });

  it("unsupported harness is UNSUPPORTED even with a proof", () => {
    const r = classifyGovernedReadiness({ harness: "Pi", installed: true, authenticated: true, hooksAvailable: true, governedContextProof: validProof({ harness: "Pi" }) });
    expect(r.state).toBe("UNSUPPORTED");
  });
});

describe("classifyGovernedReadiness — fail-closed", () => {
  it("MCP configured / skill on disk with NO uptake proof blocks (Quality #2, #3; PM a)", () => {
    const r = classifyGovernedReadiness({ harness: "Claude Code", installed: true, authenticated: true, hooksAvailable: true });
    expect(r.state).toBe("FIXABLE_BLOCKED");
    expect(r.uptakeVerified).toBe(false);
    expect(r.blockers.join("\n")).toContain("no verified governed-context uptake proof");
  });

  it("uptake proof present but hooks/validators unknown blocks (PM b)", () => {
    const r = classifyGovernedReadiness({ harness: "Claude Code", installed: true, authenticated: true, governedContextProof: validProof({ harness: "Claude Code" }) });
    expect(r.state).toBe("FIXABLE_BLOCKED");
    expect(r.blockers.join("\n")).toContain("required hooks/validators not confirmed");
    expect(r.nextSafeAction.toLowerCase()).toContain("hook");
  });

  it("uptake proof present but hooks explicitly false blocks (PM b)", () => {
    const r = classifyGovernedReadiness({ harness: "Claude Code", installed: true, authenticated: true, hooksAvailable: false, governedContextProof: validProof({ harness: "Claude Code" }) });
    expect(r.state).toBe("FIXABLE_BLOCKED");
  });

  it("native-skill harness with only an mcp_bootstrap proof is downgraded/blocked (Quality #4)", () => {
    const r = classifyGovernedReadiness({
      harness: "Codex",
      installed: true,
      authenticated: true,
      hooksAvailable: true,
      governedContextProof: validProof({ harness: "Codex", source_type: "mcp_bootstrap" })
    });
    expect(r.state).toBe("FIXABLE_BLOCKED");
    expect(r.blockers.join("\n")).toContain("assurance mcp_bootstrap is below the native_skill");
  });

  it("liveness blockers (input-bar-only, permission, no-ack, idle) cannot be GOVERNED_READY (Quality #8)", () => {
    const base = { harness: "Claude Code", installed: true, authenticated: true, hooksAvailable: true, governedContextProof: validProof({ harness: "Claude Code" }) };
    expect(classifyGovernedReadiness({ ...base, deliveryState: "INPUT_BAR_ONLY" }).state).not.toBe("GOVERNED_READY");
    expect(classifyGovernedReadiness({ ...base, permissionBlocked: true }).state).not.toBe("GOVERNED_READY");
    expect(classifyGovernedReadiness({ ...base, livenessState: "NO_ACK" }).state).not.toBe("GOVERNED_READY");
    expect(classifyGovernedReadiness({ ...base, idleStalled: true }).state).not.toBe("GOVERNED_READY");
  });
});

describe("classifyGovernedReadiness — PM/ODIN highest-assurance (Quality #5)", () => {
  it("a native-skill harness running PM with only an mcp_bootstrap proof fails closed", () => {
    const r = classifyGovernedReadiness({
      harness: "Claude Code",
      requestedRole: "A/EXEC-PM",
      installed: true,
      authenticated: true,
      hooksAvailable: true,
      governedContextProof: validProof({ harness: "Claude Code", source_type: "mcp_bootstrap" })
    });
    expect(r.requiredAssurance).toBe("native_skill");
    expect(r.state).not.toBe("GOVERNED_READY");
  });

  it("an mcp-only harness cannot reach PM/ODIN assurance (mcp-only never silently qualifies)", () => {
    const r = classifyGovernedReadiness({
      harness: "Droid",
      requestedRole: "B/ODIN",
      installed: true,
      authenticated: true,
      hooksAvailable: true,
      governedContextProof: validProof({ harness: "Droid", source_type: "mcp_bootstrap" })
    });
    expect(r.requiredAssurance).toBe("static_control_file");
    expect(r.state).not.toBe("GOVERNED_READY");
  });
});

describe("getHarnessProbeMatrix exposes governedReadiness", () => {
  it("marks an unsupported harness UNSUPPORTED", () => {
    const result = getHarnessProbeMatrix({ intendedHarnesses: ["Pi"], installedHarnesses: ["Pi"], userProvisioningAnswer: "yes", observations: [{ harness: "Pi" }] });
    const row = (result.rows as Array<Record<string, unknown>>).find((r) => r.harness === "Pi") ?? {};
    expect(row.governedReadiness).toBe("UNSUPPORTED");
  });
});

describe("evaluateReadinessGate hard-blocks governed activation (PM correction)", () => {
  function governedSlot(extra: Record<string, unknown> = {}) {
    return {
      roleSlot: "B/DEV-1",
      harness: "Claude Code",
      mcpAvailable: true,
      mcpVersion: "0.4.9",
      scpSkillAvailable: true,
      protocolTextSource: "native_skill" as const,
      authStatus: "AUTH_READY" as const,
      firstRunPermissionStatus: "CLEAR" as const,
      modelStatus: "MODEL_READY" as const,
      roleCompatibility: "ACCEPTS_ROLE" as const,
      occupantState: "BOOTSTRAPPED_IDLE",
      ...extra
    };
  }

  it("blocks activation for a governed slot with verified instruction readiness but NO uptake proof", () => {
    const result = evaluateReadinessGate({ execPmAuthorized: true, cmuxAvailable: true, slots: [governedSlot({ hooksAvailable: true })] }) as Record<string, any>;
    const row = result.readinessMatrix[0];
    expect(row.governedReadiness).toBe("FIXABLE_BLOCKED");
    expect(row.activationAllowed).toBe(false);
    expect(row.governedActivationBlocked).toBe(true);
    expect(result.activationStatus).toBe("TEAM_ACTIVATION_BLOCKED");
  });

  it("blocks activation when an uptake proof is present but hooks/validators are unknown (PM b)", () => {
    const result = evaluateReadinessGate({
      execPmAuthorized: true,
      cmuxAvailable: true,
      slots: [governedSlot({ governedContextProof: validProof({ harness: "Claude Code" }) })]
    }) as Record<string, any>;
    const row = result.readinessMatrix[0];
    expect(row.governedReadiness).toBe("FIXABLE_BLOCKED");
    expect(row.activationAllowed).toBe(false);
  });

  it("allows activation only when governedReadiness is GOVERNED_READY", () => {
    const result = evaluateReadinessGate({
      execPmAuthorized: true,
      cmuxAvailable: true,
      slots: [governedSlot({ hooksAvailable: true, governedContextProof: validProof({ harness: "Claude Code" }) })]
    }) as Record<string, any>;
    const row = result.readinessMatrix[0];
    expect(row.governedReadiness).toBe("GOVERNED_READY");
    expect(row.activationAllowed).toBe(true);
    expect(result.activationStatus).toBe("TEAM_ACTIVATION_ALLOWED");
  });
});

describe("verify-governed-context.mjs core (verifyGovernedContextProof / recordGovernedContextProof)", () => {
  it("records and verifies a valid native-skill proof against disk", () => {
    const dir = mkdtempSync(join(tmpdir(), "odin-gc-core-"));
    try {
      writeFileSync(join(dir, "SKILL.md"), `name: scp\n${MARKER}\n`);
      const proof = gc.recordGovernedContextProof({ sourcePath: "SKILL.md", marker: MARKER, base: dir, role: "B/DEV-1", now: "2026-06-04T05:00:00Z" });
      expect(gc.verifyGovernedContextProof(proof, { base: dir, now: "2026-06-04T05:10:00Z" }).ok).toBe(true);

      const tampered = { ...proof, control_source: { ...proof.control_source, sha256: "0".repeat(64) } };
      expect(gc.verifyGovernedContextProof(tampered, { base: dir, now: "2026-06-04T05:10:00Z" }).ok).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("records and verifies a valid static-control-file proof (Quality #14)", () => {
    const dir = mkdtempSync(join(tmpdir(), "odin-gc-static-"));
    try {
      writeFileSync(join(dir, "AGENTS.md"), `rules\n${MARKER}\n`);
      const proof = gc.recordGovernedContextProof({ sourcePath: "AGENTS.md", marker: MARKER, sourceType: "static_control_file", harness: "Cursor", base: dir, role: "B/DEV-1", now: "2026-06-04T05:00:00Z" });
      expect(gc.verifyGovernedContextProof(proof, { base: dir, now: "2026-06-04T05:10:00Z" }).ok).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects missing uptake, missing marker, and stale proofs (Quality #7, #13)", () => {
    expect(gc.verifyGovernedContextProof({ schema: "odin.governed_context_proof.v1" }, {}).ok).toBe(false);
    const proof = validProof();
    expect(gc.verifyGovernedContextProof(proof, { now: "2026-06-04T05:10:00Z" }).ok).toBe(true);
    // Far in the future ⇒ stale.
    expect(gc.verifyGovernedContextProof(proof, { now: "2026-07-04T05:10:00Z" }).ok).toBe(false);
  });
});

describe("verify-governed-context.mjs CLI (Quality #12)", () => {
  it("--help exits 0 with zero-secret usage", () => {
    const result = runNode(gcVerifierPath, ["--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("verify-governed-context");
  });

  it("record -> verify passes; checksum mismatch fails; missing arg errors", () => {
    const dir = mkdtempSync(join(tmpdir(), "odin-gc-cli-"));
    try {
      writeFileSync(join(dir, "SKILL.md"), `name: scp\n${MARKER}\n`);
      const recorded = runNode(gcVerifierPath, ["--record", "--source", "SKILL.md", "--marker", MARKER, "--base", dir, "--role", "B/DEV-1"]);
      expect(recorded.status).toBe(0);
      const proofPath = join(dir, "proof.json");
      writeFileSync(proofPath, recorded.stdout);
      // Large max-age so wall-clock skew between record and verify can never make the round-trip stale.
      expect(runNode(gcVerifierPath, [proofPath, "--base", dir, "--max-age-seconds", "31536000"]).status).toBe(0);

      const tampered = JSON.parse(recorded.stdout);
      tampered.control_source.sha256 = "0".repeat(64);
      const badPath = join(dir, "bad.json");
      writeFileSync(badPath, JSON.stringify(tampered));
      expect(runNode(gcVerifierPath, [badPath, "--base", dir, "--max-age-seconds", "31536000"]).status).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    expect(runNode(gcVerifierPath, []).status).toBe(2);
  });

  it("rejects a secret-looking marker at record time (zero-secret)", () => {
    const dir = mkdtempSync(join(tmpdir(), "odin-gc-secret-"));
    try {
      writeFileSync(join(dir, "SKILL.md"), "name: scp\nsk-live-abcdefgh12345678\n");
      const result = runNode(gcVerifierPath, ["--record", "--source", "SKILL.md", "--marker", "sk-live-abcdefgh12345678", "--base", dir]);
      expect(result.status).toBe(2);
      expect(result.stdout).not.toContain("sk-live-abcdefgh12345678");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
