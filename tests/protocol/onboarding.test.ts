import { describe, expect, it } from "vitest";
import { getOnboardingPlan } from "../../src/protocol/service.js";

type Plan = Record<string, any>;

function provisionedCodex(extra: Record<string, unknown> = {}): Plan {
  return getOnboardingPlan({
    intendedHarnesses: ["Codex"],
    installedHarnesses: ["Codex"],
    userProvisioningAnswer: "yes",
    observations: [{ harness: "Codex", mcpConfigured: true, scpSkillInstalled: true, authStatus: "AUTH_READY", visibleContent: true }],
    ...extra
  });
}

function rowFor(plan: Plan, harness: string): Record<string, any> {
  const rows = plan.readinessRows as Array<Record<string, any>>;
  return rows.find((row) => row.harness === harness) ?? {};
}

describe("onboarding plan", () => {
  it("recommends guided manual setup as the safe default when computer use is unavailable", () => {
    const plan = provisionedCodex({ computerUseAvailable: false });

    expect(plan.recommendedMode).toBe("guided");
    expect(plan.setupModes.guided.steps.length).toBeGreaterThan(0);
    expect(plan.guidedSetupSteps.length).toBeGreaterThan(0);
    expect(plan.setupModes.assisted.eligible).toBe(false);
    expect(plan.zeroSecretOutput).toBe(true);
    expect(typeof plan.ledgerPath).toBe("string");
    expect(typeof plan.nextUserAction).toBe("string");
  });

  it("recommends assisted computer-use setup only when computerUseAvailable is true and preferred", () => {
    const plan = provisionedCodex({ computerUseAvailable: true, preferredSetupMode: "assisted" });

    expect(plan.recommendedMode).toBe("assisted");
    expect(plan.setupModes.assisted.eligible).toBe(true);
    expect(plan.setupModes.assisted.available).toBe(true);
    expect(plan.setupModes.assisted.candidateHarnesses).toEqual(
      expect.arrayContaining(["Codex Desktop", "Claude Desktop", "Claude Code"])
    );
    // MCP only returns plans; it never drives the GUI itself.
    expect(String(plan.setupModes.assisted.caveat).toLowerCase()).toContain("plans only");
  });

  it("falls back to guided setup and explains the safe path when assisted is requested but computer use is unavailable", () => {
    const plan = provisionedCodex({ computerUseAvailable: false, preferredSetupMode: "assisted" });

    expect(plan.recommendedMode).toBe("guided");
    expect(plan.setupModes.assisted.eligible).toBe(false);
    expect(plan.setupModes.assisted.requestedButUnavailable).toBe(true);
    expect(String(plan.modeRationale).toLowerCase()).toContain("safe available path");
  });

  it("surfaces auth/login blockers in the blocker summary using the existing taxonomy", () => {
    const plan = getOnboardingPlan({
      intendedHarnesses: ["KiloCode"],
      installedHarnesses: ["KiloCode"],
      computerUseAvailable: false,
      observations: [{ harness: "KiloCode", text: "run kilo auth login or /connect" }]
    });

    const row = rowFor(plan, "KiloCode");
    expect(row.classifications).toContain("BLOCKED_BY_LOGIN");
    expect(row.governedRoleReady).toBe(false);
    const summary = plan.blockerSummary as Array<Record<string, any>>;
    const kilo = summary.find((entry) => entry.harness === "KiloCode");
    expect(kilo?.blockers).toContain("BLOCKED_BY_LOGIN");
    expect(plan.unresolvedBlockerCount).toBeGreaterThan(0);
    // Advisory-only USER_INPUT_REQUIRED must not be counted as a harness blocker.
    expect(kilo?.blockers).not.toContain("USER_INPUT_REQUIRED");
  });

  it("classifies Crush auth-header failures as auth blockers, not readiness", () => {
    const plan = getOnboardingPlan({
      intendedHarnesses: ["Crush"],
      installedHarnesses: ["Crush"],
      observations: [{ harness: "Crush", text: "unauthorized: Authentication parameter not received in Header" }]
    });

    const row = rowFor(plan, "Crush");
    expect(row.classifications).toContain("BLOCKED_BY_AUTH");
    expect(row.classifications).toContain("AUTH_PROVIDER_BLOCKED");
    expect(row.governedRoleReady).toBe(false);
  });

  it("treats an installed Droid without governed MCP proof as not governed-ready", () => {
    const plan = getOnboardingPlan({
      intendedHarnesses: ["Droid"],
      installedHarnesses: ["Droid"],
      userProvisioningAnswer: "yes",
      observations: [{ harness: "Droid", mcpManagementAvailable: false, taskAutonomy: "read_only", visibleContent: true }]
    });

    const row = rowFor(plan, "Droid");
    expect(row.installed).toBe(true);
    expect(row.classifications).toContain("MCP_UNPROVEN");
    expect(row.governedRoleReady).toBe(false);
    expect(plan.governedReadyHarnesses).not.toContain("Droid");
  });

  it("classifies Codex/Claude Code consistently with getHarnessProbeMatrix and marks a fully provisioned harness governed-ready", () => {
    const plan = getOnboardingPlan({
      intendedHarnesses: ["Codex", "Claude Code"],
      installedHarnesses: ["Codex", "Claude Code"],
      userProvisioningAnswer: "yes",
      observations: [
        { harness: "Codex", mcpConfigured: true, scpSkillInstalled: true, authStatus: "AUTH_READY", visibleContent: true },
        { harness: "Claude Code", mcpConfigured: true, scpSkillInstalled: true, authStatus: "AUTH_READY", visibleContent: true }
      ]
    });

    expect(rowFor(plan, "Codex").governedRoleReady).toBe(true);
    expect(rowFor(plan, "Claude Code").governedRoleReady).toBe(true);
    expect(rowFor(plan, "Codex").readiness.mcp_tool_hydration).toBe("AT_BOOT");
    expect(plan.governedReadyHarnesses).toEqual(expect.arrayContaining(["Codex", "Claude Code"]));
    expect(plan.unresolvedBlockerCount).toBe(0);
  });

  it("reports secret/provider readiness by status only and never leaks secret values", () => {
    const plan = getOnboardingPlan({
      intendedHarnesses: ["Codex"],
      installedHarnesses: ["Codex"],
      observations: [{ harness: "Codex", text: "DOPPLER_TOKEN=sk-live-secretvalue Bearer abcdefghijklmnop" }]
    });
    const serialized = JSON.stringify(plan);

    expect(plan.zeroSecretOutput).toBe(true);
    expect(serialized).toContain("[REDACTED]");
    expect(serialized).not.toContain("sk-live-secretvalue");
    expect(serialized).not.toContain("abcdefghijklmnop");
    expect(String(plan.noSecretsNotice).toLowerCase()).toContain("do not paste");
  });

  it("surfaces a default install-ledger path and honors an override without writing the ledger", () => {
    const defaulted = getOnboardingPlan({ intendedHarnesses: ["Codex"], installedHarnesses: ["Codex"] });
    expect(defaulted.ledgerPath).toBe(".odin/install-ledger.json");
    expect(String(defaulted.ledgerNote).toLowerCase()).toContain("does not");

    const overridden = getOnboardingPlan({ intendedHarnesses: ["Codex"], installedHarnesses: ["Codex"], ledgerPath: ".odin/custom-ledger.json" });
    expect(overridden.ledgerPath).toBe(".odin/custom-ledger.json");
  });
});
