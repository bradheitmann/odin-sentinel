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
});
