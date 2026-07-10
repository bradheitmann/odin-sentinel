import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getMissionFrontrunPack } from "../../src/protocol/service.js";
import type { ProtocolData, ProtocolRepository } from "../../src/protocol/repository.js";

// Minimal stub repository for mission-frontrun tests.
function stubRepository(overrides: Partial<ProtocolData["missionFrontrun"]> = {}): ProtocolRepository {
  const missionFrontrun = {
    orchestratorContract: "orchestrator {{TASK_ID}} {{REPO_PATH}} {{WRITE_SCOPE}} {{MISSION_NAME}}",
    workerContract: "worker {{TASK_ID}} {{REPO_PATH}} {{WRITE_SCOPE}} {{MISSION_NAME}}",
    scrutinyValidatorContract: "validator {{TASK_ID}} {{REPO_PATH}} {{WRITE_SCOPE}} {{MISSION_NAME}}",
    scrutinyFeatureReviewerContract: "reviewer {{TASK_ID}} {{REPO_PATH}} {{WRITE_SCOPE}} {{MISSION_NAME}}",
    droidsScrutinyFeatureReviewer: "droids {{TASK_ID}} {{REPO_PATH}} {{WRITE_SCOPE}} {{MISSION_NAME}}",
    ...overrides
  };

  const data: ProtocolData = {
    protocol: "# Test",
    roles: { roles: {} },
    topology: { default_topology: {} },
    modelProfiles: { profiles: {} },
    closeout: { modes: {} },
    delegation: { delegation_contract: { required_fields: [], authority_fields: [], visibility_fields: [], receipt_types: [] } },
    bootReceipt: { required_fields: [] },
    stepUpLadder: { step_up_ladder: {} },
    qaIndependence: { qa_independence: {} },
    harnessControlMatrix: { harness_control_matrix: {} },
    authorityChain: { authority_chain: {} },
    blockedPodRollover: { blocked_pod_rollover: {} },
    sliceHealthSentinels: { slice_health_sentinels: {} },
    podBringUp: { pod_bringup: {} },
    commitGate: { commit_gate: {} },
    recipeCapture: { recipe_capture: {} },
    teamManifest: { required_fields: [], role_slot_schema: { required_fields: [], layout_locator_fields: [], readiness_statuses: [] }, scp_context_sources: [] },
    harnessProbeMatrix: { harnesses: [] },
    bootstrapSkill: "# Bootstrap",
    skillReferences: {
      bootReceiptExamples: "# examples",
      canonicalIntroductionPrompt: "# prompt",
      harnessSkillTargets: "# targets",
      teamBootstrapRunbook: "# runbook"
    },
    roleCards: {
      execPm: "# EXEC PM",
      teamPm: "# TEAM PM",
      devWorker: "# DEV WORKER",
      qaWorker: "# QA WORKER",
      execAsst: "# EXEC ASST"
    },
    missionFrontrun
  };

  return {
    load: () => data,
    path: (...segments: string[]) => segments.join("/")
  };
}

const baseInput = {
  mission_name: "Test Mission",
  repo_path: "/tmp/test-repo",
  write_scope: ["src/foo.ts", "src/bar.ts"],
  task_id: "SLICE-TEST-001"
};

describe("getMissionFrontrunPack", () => {
  it("returns all four contracts and the droids file", () => {
    const pack = getMissionFrontrunPack(baseInput, stubRepository());
    expect(pack.contracts.orchestrator).toBeDefined();
    expect(pack.contracts.worker).toBeDefined();
    expect(pack.contracts.scrutiny_validator).toBeDefined();
    expect(pack.contracts.scrutiny_feature_reviewer).toBeDefined();
    expect(pack.contracts.droids_scrutiny_feature_reviewer).toBeDefined();
  });

  it("substitutes all placeholders in every contract", () => {
    const pack = getMissionFrontrunPack(baseInput, stubRepository());
    for (const key of Object.keys(pack.contracts) as Array<keyof typeof pack.contracts>) {
      const text = pack.contracts[key];
      expect(text).not.toContain("{{TASK_ID}}");
      expect(text).not.toContain("{{REPO_PATH}}");
      expect(text).not.toContain("{{WRITE_SCOPE}}");
      expect(text).not.toContain("{{MISSION_NAME}}");
      expect(text).toContain(baseInput.task_id);
      expect(text).toContain(baseInput.repo_path);
      expect(text).toContain("Test Mission");
    }
  });

  it("substitutes write_scope as comma-separated list", () => {
    const pack = getMissionFrontrunPack(baseInput, stubRepository());
    expect(pack.contracts.orchestrator).toContain("src/foo.ts, src/bar.ts");
  });

  it("substitutes write_scope as [] when empty", () => {
    const pack = getMissionFrontrunPack({ ...baseInput, write_scope: [] }, stubRepository());
    expect(pack.contracts.orchestrator).toContain("[]");
  });

  it("boot_contract_receipt_template has all six required fields", () => {
    const pack = getMissionFrontrunPack(baseInput, stubRepository());
    const receipt = pack.boot_contract_receipt_template;
    expect(receipt).toHaveProperty("role");
    expect(receipt).toHaveProperty("session_id");
    expect(receipt).toHaveProperty("contract_path");
    expect(receipt).toHaveProperty("byte_count");
    expect(receipt).toHaveProperty("sha256");
    expect(receipt).toHaveProperty("timestamp");
  });

  it("launch_command_template contains --append-system-prompt-file", () => {
    const pack = getMissionFrontrunPack(baseInput, stubRepository());
    expect(pack.launch_command_template).toContain("--append-system-prompt-file");
  });

  it("launch_command_template contains droid exec --mission", () => {
    const pack = getMissionFrontrunPack(baseInput, stubRepository());
    expect(pack.launch_command_template).toContain("droid exec --mission");
  });

  it("notes distinguish proven from unproven seam", () => {
    const pack = getMissionFrontrunPack(baseInput, stubRepository());
    expect(pack.notes.proven_seam).toContain("PROVEN");
    expect(pack.notes.proven_seam).toContain("--append-system-prompt-file");
    expect(pack.notes.unproven_seam).toContain("UNPROVEN");
    expect(pack.notes.unproven_seam).toContain("builtin:scrutiny-validator");
  });

  it("notes reference the tool name", () => {
    const pack = getMissionFrontrunPack(baseInput, stubRepository());
    expect(pack.notes.tool).toBe("odin.get_mission_frontrun_pack");
  });

  it("passes through mission_name, repo_path, task_id, write_scope in the pack", () => {
    const pack = getMissionFrontrunPack(baseInput, stubRepository());
    expect(pack.mission_name).toBe(baseInput.mission_name);
    expect(pack.repo_path).toBe(baseInput.repo_path);
    expect(pack.task_id).toBe(baseInput.task_id);
    expect(pack.write_scope).toEqual(baseInput.write_scope);
  });

  it("every contract body in the real pack names boot_contract_receipt", () => {
    // Uses the real file repository: each of the five contract bodies must itself
    // require emitting a boot_contract_receipt (holdout STORY-010-01 step 8).
    const pack = getMissionFrontrunPack(baseInput);
    for (const key of Object.keys(pack.contracts) as Array<keyof typeof pack.contracts>) {
      expect(pack.contracts[key]).toContain("boot_contract_receipt");
    }
  });
});

describe("mission-frontrun on-disk contract templates", () => {
  const templateDir = join(import.meta.dirname, "..", "..", "protocol", "mission-frontrun");
  const templateFiles = [
    "orchestrator-contract.md",
    "worker-contract.md",
    "scrutiny-validator-contract.md",
    "scrutiny-feature-reviewer-contract.md",
    "droids-scrutiny-feature-reviewer.md"
  ];
  const receiptFields = ["role", "session_id", "contract_path", "byte_count", "sha256", "timestamp"];

  for (const file of templateFiles) {
    it(`${file} contains a mandatory boot_contract_receipt clause with all six fields`, () => {
      const text = readFileSync(join(templateDir, file), "utf8");
      expect(text).toContain("boot_contract_receipt");
      expect(text).toContain("Boot Contract Receipt (mandatory)");
      expect(text).toContain("immediately on activation, before any");
      for (const field of receiptFields) {
        expect(text).toContain(field);
      }
    });

    it(`${file} stays within the 4096-byte template budget`, () => {
      expect(statSync(join(templateDir, file)).size).toBeLessThanOrEqual(4096);
    });
  }
});
