import { describe, expect, it } from "vitest";
import { getHarnessProbeMatrix } from "../../src/protocol/service.js";

function rowFor(result: Record<string, unknown>, harness: string) {
  const rows = result.rows as Array<Record<string, unknown>>;
  return rows.find((row) => row.harness === harness) ?? {};
}

describe("harness probe matrix", () => {
  it("classifies OpenHands missing inference credentials", () => {
    const result = getHarnessProbeMatrix({
      intendedHarnesses: ["OpenHands"],
      installedHarnesses: ["OpenHands"],
      userProvisioningAnswer: "no",
      observations: [{ harness: "OpenHands", text: "missing API inference credentials for provider" }]
    });

    expect(rowFor(result, "OpenHands").classifications).toContain("BLOCKED_BY_API_KEY");
  });

  it("classifies KiloCode login blockers", () => {
    const result = getHarnessProbeMatrix({
      intendedHarnesses: ["KiloCode"],
      installedHarnesses: ["KiloCode"],
      observations: [{ harness: "KiloCode", text: "run kilo auth login or /connect" }]
    });

    expect(rowFor(result, "KiloCode").classifications).toContain("BLOCKED_BY_LOGIN");
  });

  it("classifies Goose reasoning-only visible-output stalls", () => {
    const result = getHarnessProbeMatrix({
      intendedHarnesses: ["Goose"],
      installedHarnesses: ["Goose"],
      observations: [{ harness: "Goose", reasoningContentOnly: true, visibleContent: false, elapsedSeconds: 61 }]
    });

    expect(rowFor(result, "Goose").modelStatus).toBe("STREAMING_PROTOCOL_MISMATCH");
    expect(rowFor(result, "Goose").classifications).toContain("MODEL_REASONING_ONLY");
  });

  it("classifies Crush permission prompts", () => {
    const result = getHarnessProbeMatrix({
      intendedHarnesses: ["Crush"],
      installedHarnesses: ["Crush"],
      observations: [{ harness: "Crush", text: "waiting for permission approval" }]
    });

    expect(rowFor(result, "Crush").classifications).toContain("BLOCKED_BY_PERMISSION");
  });

  it("classifies Pi role compatibility failures", () => {
    const result = getHarnessProbeMatrix({
      intendedHarnesses: ["Pi"],
      installedHarnesses: ["Pi"],
      observations: [{ harness: "Pi", text: "cannot accept role framing; no MCP skill runtime proof" }]
    });

    expect(rowFor(result, "Pi").classifications).toContain("ROLE_COMPATIBILITY_FAILED");
  });

  it("reports secret-provider status without leaking values", () => {
    const result = getHarnessProbeMatrix({
      intendedHarnesses: ["Codex"],
      providerStatuses: { DOPPLER_TOKEN: true, OP_SESSION: true },
      observations: [{ harness: "Codex", text: "DOPPLER_TOKEN=sk-live-secretvalue Bearer abcdefghijklmnop" }]
    }) as Record<string, unknown>;
    const serialized = JSON.stringify(result);

    expect(serialized).toContain("[REDACTED]");
    expect(serialized).not.toContain("sk-live-secretvalue");
    expect(serialized).not.toContain("abcdefghijklmnop");
    expect(result.zeroSecretOutput).toBe(true);
  });

  it("classifies Droid installed/read-only success but missing governed MCP proof", () => {
    const row = rowFor(getHarnessProbeMatrix({
      intendedHarnesses: ["Droid"],
      installedHarnesses: ["Droid"],
      userProvisioningAnswer: "yes",
      observations: [{ harness: "Droid", mcpManagementAvailable: false, taskAutonomy: "read_only", visibleContent: true }]
    }), "Droid");

    expect(row.classifications).toContain("MCP_UNPROVEN");
    expect(row.classifications).not.toContain("AUTO_HIGH_REQUIRED");
    expect((row.readiness as Record<string, unknown>).governed_role_ready).toBe(false);
  });

  it("requires --auto high for Droid mission/high-autonomy recommendations", () => {
    const needsHigh = rowFor(getHarnessProbeMatrix({
      intendedHarnesses: ["Droid"],
      installedHarnesses: ["Droid"],
      observations: [{ harness: "Droid", taskAutonomy: "mission", autoLevel: "medium" }]
    }), "Droid");
    expect(needsHigh.classifications).toContain("AUTO_HIGH_REQUIRED");

    const highOk = rowFor(getHarnessProbeMatrix({
      intendedHarnesses: ["Droid"],
      installedHarnesses: ["Droid"],
      observations: [{ harness: "Droid", taskAutonomy: "high_autonomy", autoLevel: "high" }]
    }), "Droid");
    expect(highOk.classifications).not.toContain("AUTO_HIGH_REQUIRED");
  });

  it("classifies Crush auth-header failures as auth blockers", () => {
    const row = rowFor(getHarnessProbeMatrix({
      intendedHarnesses: ["Crush"],
      installedHarnesses: ["Crush"],
      observations: [{ harness: "Crush", text: "unauthorized: Authentication parameter not received in Header" }]
    }), "Crush");

    expect(row.classifications).toContain("BLOCKED_BY_AUTH");
    expect(row.classifications).toContain("AUTH_PROVIDER_BLOCKED");
  });

  it("classifies Crush absence of an MCP-management surface as MCP_UNAVAILABLE", () => {
    const row = rowFor(getHarnessProbeMatrix({
      intendedHarnesses: ["Crush"],
      installedHarnesses: ["Crush"],
      observations: [{ harness: "Crush", mcpManagementAvailable: false }]
    }), "Crush");

    expect(row.classifications).toContain("MCP_UNAVAILABLE");
  });

  it("classifies harnesses without MCP/skill/protocol as NON_GOVERNED_ONE_SHOT_ONLY", () => {
    const row = rowFor(getHarnessProbeMatrix({
      intendedHarnesses: ["Aider"],
      installedHarnesses: ["Aider"],
      observations: [{ harness: "Aider" }]
    }), "Aider");

    expect(row.classifications).toContain("NON_GOVERNED_ONE_SHOT_ONLY");
    expect((row.readiness as Record<string, unknown>).governed_role_ready).toBe(false);
  });

  it("exposes multi-dimensional readiness and marks a fully provisioned harness governed-ready", () => {
    const row = rowFor(getHarnessProbeMatrix({
      intendedHarnesses: ["Codex"],
      installedHarnesses: ["Codex"],
      userProvisioningAnswer: "yes",
      observations: [{ harness: "Codex", mcpConfigured: true, scpSkillInstalled: true, authStatus: "AUTH_READY", visibleContent: true }]
    }), "Codex");
    const readiness = row.readiness as Record<string, unknown>;

    expect(Object.keys(readiness)).toEqual(
      expect.arrayContaining(["installed_binary", "authenticated", "mcp_configured", "mcp_tool_hydration", "governed_role_ready"])
    );
    expect(readiness.installed_binary).toBe(true);
    expect(readiness.authenticated).toBe(true);
    expect(readiness.mcp_tool_hydration).toBe("AT_BOOT");
    expect(readiness.governed_role_ready).toBe(true);
  });
});
