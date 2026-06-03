import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  getActivationGates,
  getDelegationPacket,
  getStartupPacket,
  validateCmuxDeliveryProof,
  validateDelegationPacket,
  validateInstructionReadProof
} from "../../src/protocol/index.js";

const verifierPath = fileURLToPath(new URL("../../scripts/protocol/verify-instruction-read.mjs", import.meta.url));
const installerPath = fileURLToPath(new URL("../../scripts/protocol/install-activation-hooks.mjs", import.meta.url));

// @ts-ignore - activation scripts are ESM .mjs modules without declaration files.
const verifier = await import("../../scripts/protocol/verify-instruction-read.mjs");
// @ts-ignore - activation scripts are ESM .mjs modules without declaration files.
const installer = await import("../../scripts/protocol/install-activation-hooks.mjs");

function runNode(scriptPath: string, args: string[]) {
  return spawnSync("node", [scriptPath, ...args], { encoding: "utf8" });
}

function validDeliveryProof(overrides: Record<string, unknown> = {}) {
  return {
    target_surface_locator: "workspace:1 pane:b surface:qa-1",
    submitted: true,
    verification_method: "cmux read-screen",
    observed_processing_state: "DELIVERED_ACKED",
    timestamp: "2026-01-01T00:00:00Z",
    sender_role: "A/EXEC-PM",
    ...overrides
  };
}

describe("validateCmuxDeliveryProof", () => {
  it("accepts a submitted, acknowledged delivery proof", () => {
    expect(validateCmuxDeliveryProof(validDeliveryProof()).valid).toBe(true);
  });

  it("rejects a missing/empty delivery proof", () => {
    const result = validateCmuxDeliveryProof({});
    expect(result.valid).toBe(false);
    expect(result.missing).toContain("target_surface_locator");
    expect(result.missing).toContain("submitted");
  });

  it("rejects a proof that was not submitted (Enter not sent)", () => {
    const result = validateCmuxDeliveryProof(validDeliveryProof({ submitted: false }));
    expect(result.valid).toBe(false);
    expect(result.invalid).toContain("submitted");
    expect(result.warnings.join("\n")).toContain("INPUT_BAR_ONLY");
  });

  it("rejects visible-but-unprocessed (INPUT_BAR_ONLY) text", () => {
    const result = validateCmuxDeliveryProof(validDeliveryProof({ observed_processing_state: "INPUT_BAR_ONLY" }));
    expect(result.valid).toBe(false);
    expect(result.invalid).toContain("observed_processing_state");
  });

  it("rejects an unknown processing state", () => {
    const result = validateCmuxDeliveryProof(validDeliveryProof({ observed_processing_state: "MADE_UP_STATE" }));
    expect(result.valid).toBe(false);
    expect(result.invalid).toContain("observed_processing_state");
  });

  it("accepts delivered-no-ack with a follow-up warning", () => {
    const result = validateCmuxDeliveryProof(validDeliveryProof({ observed_processing_state: "DELIVERED_NO_ACK" }));
    expect(result.valid).toBe(true);
    expect(result.warnings.join("\n")).toContain("no acknowledgement");
  });
});

describe("validateInstructionReadProof", () => {
  it("accepts a well-formed proof", () => {
    const result = validateInstructionReadProof({
      role: "B/DEV-1",
      generated_at: "2026-01-01T00:00:00Z",
      files: [{ path: "protocol/SCP.md", bytes: 4175, lines: 87, sha256: "abc123" }]
    });
    expect(result.valid).toBe(true);
  });

  it("rejects an empty files list", () => {
    const result = validateInstructionReadProof({ role: "B/DEV-1", generated_at: "t", files: [] });
    expect(result.valid).toBe(false);
    expect(result.invalid).toContain("files");
  });

  it("rejects a proof missing files entirely", () => {
    const result = validateInstructionReadProof({ role: "B/DEV-1", generated_at: "t" });
    expect(result.valid).toBe(false);
    expect(result.missing).toContain("files");
  });

  it("rejects a file entry missing a sha256 digest", () => {
    const result = validateInstructionReadProof({
      role: "B/DEV-1",
      generated_at: "t",
      files: [{ path: "protocol/SCP.md", bytes: 4175 }]
    });
    expect(result.valid).toBe(false);
    expect(result.invalid).toContain("files.0.sha256");
  });

  it("rejects a file entry missing both byte and line counts", () => {
    const result = validateInstructionReadProof({
      role: "B/DEV-1",
      generated_at: "t",
      files: [{ path: "protocol/SCP.md", sha256: "abc" }]
    });
    expect(result.valid).toBe(false);
    expect(result.invalid).toContain("files.0.bytes");
  });
});

describe("getActivationGates", () => {
  it("exposes both gates with verifier/installer scripts and validation tools", () => {
    const gates = getActivationGates() as Record<string, any>;
    expect(gates.cmuxDeliveryProof.requiredFields).toContain("submitted");
    expect(gates.cmuxDeliveryProof.validateWith).toBe("odin.validate_cmux_delivery_proof");
    expect(gates.instructionReadProof.verifierScript).toBe("scripts/protocol/verify-instruction-read.mjs");
    expect(gates.instructionReadProof.installerScript).toBe("scripts/protocol/install-activation-hooks.mjs");
    expect(gates.instructionReadProof.validateWith).toBe("odin.validate_instruction_read_proof");
    expect(JSON.stringify(gates)).toContain("input bar");
  });
});

describe("getStartupPacket activation-gate exposure", () => {
  it("includes activation gates, required actions, and prompt guidance", () => {
    const packet = getStartupPacket();
    expect(packet.activationGates).toBeDefined();
    expect(packet.requiredActions.some((action) => action.includes("verify-instruction-read.mjs"))).toBe(true);
    expect(packet.requiredActions.some((action) => action.includes("submit Enter"))).toBe(true);
    expect(packet.startupPrompt).toContain("verify-instruction-read.mjs");
    expect(packet.startupPrompt).toContain("input-bar text is not delivery");
  });
});

describe("validateDelegationPacket delivery proof", () => {
  it("keeps a freshly built delegation packet valid (contract only, no proof attached)", () => {
    const packet = getDelegationPacket({ sourceRole: "A/EXEC-PM", targetRoleSlot: "B/DEV-1", task: "x", mayImplement: true, writeScope: ["src/x.ts"] });
    expect(validateDelegationPacket(packet).valid).toBe(true);
    expect((packet as Record<string, unknown>).delivery_proof_contract).toBeDefined();
  });

  it("accepts a delegation packet with a valid attached delivery proof", () => {
    const packet = getDelegationPacket({ sourceRole: "A/EXEC-PM", targetRoleSlot: "B/DEV-1", task: "x", mayImplement: true, writeScope: ["src/x.ts"] });
    const result = validateDelegationPacket({ ...packet, delivery_proof: validDeliveryProof() });
    expect(result.valid).toBe(true);
  });

  it("fails a delegation packet whose attached delivery proof is invalid", () => {
    const packet = getDelegationPacket({ sourceRole: "A/EXEC-PM", targetRoleSlot: "B/DEV-1", task: "x", mayImplement: true, writeScope: ["src/x.ts"] });
    const result = validateDelegationPacket({ ...packet, delivery_proof: { submitted: false } });
    expect(result.valid).toBe(false);
    expect(result.invalid.some((field) => field.startsWith("delivery_proof."))).toBe(true);
  });

  it("warns when a CMUX dispatch omits delivery proof", () => {
    const packet = getDelegationPacket({ sourceRole: "A/EXEC-PM", targetRoleSlot: "B/DEV-1", task: "x", mayImplement: true, writeScope: ["src/x.ts"] });
    const result = validateDelegationPacket({ ...packet, cmux_dispatch: true });
    expect(result.warnings.join("\n")).toContain("delivery proof");
  });
});

describe("verify-instruction-read.mjs (verifyProof core)", () => {
  it("passes when recorded digests match disk and fails on mismatch/missing/empty", () => {
    const dir = mkdtempSync(join(tmpdir(), "odin-irp-core-"));
    try {
      writeFileSync(join(dir, "a.txt"), "hello\nworld\n");
      const proof = verifier.recordProof(["a.txt"], dir, "B/DEV-1");
      expect(verifier.verifyProof(proof, dir).ok).toBe(true);

      const tampered = { ...proof, files: [{ ...proof.files[0], sha256: "0".repeat(64) }] };
      expect(verifier.verifyProof(tampered, dir).ok).toBe(false);

      expect(verifier.verifyProof({ files: [{ path: "missing.txt", bytes: 1, sha256: "x" }] }, dir).ok).toBe(false);
      expect(verifier.verifyProof({ files: [] }, dir).ok).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("verify-instruction-read.mjs (CLI)", () => {
  it("--help exits 0 with zero-secret usage", () => {
    const result = runNode(verifierPath, ["--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("verify-instruction-read");
  });

  it("record -> verify passes; truncation and deletion fail; bad args error", () => {
    const dir = mkdtempSync(join(tmpdir(), "odin-irp-cli-"));
    try {
      const fixture = join(dir, "sample.md");
      writeFileSync(fixture, "line one\nline two\n");

      const recorded = runNode(verifierPath, ["--record", "sample.md", "--base", dir, "--role", "B/DEV-1"]);
      expect(recorded.status).toBe(0);
      const proofPath = join(dir, "proof.json");
      writeFileSync(proofPath, recorded.stdout);

      expect(runNode(verifierPath, [proofPath, "--base", dir]).status).toBe(0);

      appendFileSync(fixture, "appended line\n");
      expect(runNode(verifierPath, [proofPath, "--base", dir]).status).toBe(1);

      rmSync(fixture);
      expect(runNode(verifierPath, [proofPath, "--base", dir]).status).toBe(1);

      expect(runNode(verifierPath, []).status).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("install-activation-hooks.mjs", () => {
  it("renders a precheck hook that calls the verifier and plans the gates", () => {
    expect(installer.renderHookScript()).toContain("verify-instruction-read.mjs");
    expect(installer.planInstall("hooks").mcp).toContain("odin.get_activation_gates");
  });

  it("--help, --print-hook, and dry-run exit 0; install writes the hook; missing target errors", () => {
    expect(runNode(installerPath, ["--help"]).status).toBe(0);

    const printed = runNode(installerPath, ["--print-hook"]);
    expect(printed.status).toBe(0);
    expect(printed.stdout).toContain("odin-activation-precheck");

    expect(runNode(installerPath, []).status).toBe(0);

    const dir = mkdtempSync(join(tmpdir(), "odin-hook-"));
    try {
      const installed = runNode(installerPath, ["--install", "--target", dir]);
      expect(installed.status).toBe(0);
      expect(existsSync(join(dir, "odin-activation-precheck.sh"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }

    expect(runNode(installerPath, ["--install"]).status).toBe(2);
  });
});
