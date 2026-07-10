import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { requireRecord } from "./validators.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const REQUIRED_PROTOCOL_FILES = [
  "protocol/SCP.md",
  "protocol/roles.yaml",
  "protocol/topology.yaml",
  "protocol/model-profiles.yaml",
  "protocol/closeout.yaml",
  "protocol/delegation.yaml",
  "protocol/receipts/boot-receipt.yaml",
  "protocol/receipts/team-manifest.yaml",
  "protocol/receipts/harness-probe-matrix.yaml",
  "protocol/resources/step-up-ladder.yaml",
  "protocol/resources/recipe-capture.yaml",
  "protocol/resources/qa-independence.yaml",
  "protocol/resources/commit-gate.yaml",
  "protocol/resources/harness-control-matrix.yaml",
  "protocol/resources/authority-chain.yaml",
  "protocol/resources/blocked-pod-rollover.yaml",
  "protocol/resources/slice-health-sentinels.yaml",
  "protocol/resources/pod-bringup.yaml",
  "protocol/bootstrap-skill.md",
  "protocol/skill-references/boot-receipt-examples.md",
  "protocol/skill-references/canonical-introduction-prompt.md",
  "protocol/skill-references/harness-skill-targets.md",
  "protocol/skill-references/team-bootstrap-runbook.md",
  "protocol/role-cards/exec-pm.md",
  "protocol/role-cards/team-pm.md",
  "protocol/role-cards/dev-worker.md",
  "protocol/role-cards/qa-worker.md",
  "protocol/role-cards/exec-asst.md",
  "protocol/mission-frontrun/orchestrator-contract.md",
  "protocol/mission-frontrun/worker-contract.md",
  "protocol/mission-frontrun/scrutiny-validator-contract.md",
  "protocol/mission-frontrun/scrutiny-feature-reviewer-contract.md",
  "protocol/mission-frontrun/droids-scrutiny-feature-reviewer.md"
];

export type ProtocolData = {
  protocol: string;
  roles: Record<string, unknown>;
  topology: Record<string, unknown>;
  modelProfiles: Record<string, unknown>;
  closeout: Record<string, unknown>;
  delegation: Record<string, unknown>;
  bootReceipt: Record<string, unknown>;
  teamManifest: Record<string, unknown>;
  harnessProbeMatrix: Record<string, unknown>;
  stepUpLadder: Record<string, unknown>;
  recipeCapture: Record<string, unknown>;
  qaIndependence: Record<string, unknown>;
  commitGate: Record<string, unknown>;
  harnessControlMatrix: Record<string, unknown>;
  authorityChain: Record<string, unknown>;
  blockedPodRollover: Record<string, unknown>;
  sliceHealthSentinels: Record<string, unknown>;
  podBringUp: Record<string, unknown>;
  bootstrapSkill: string;
  skillReferences: {
    bootReceiptExamples: string;
    canonicalIntroductionPrompt: string;
    harnessSkillTargets: string;
    teamBootstrapRunbook: string;
  };
  roleCards: {
    execPm: string;
    teamPm: string;
    devWorker: string;
    qaWorker: string;
    execAsst: string;
  };
  missionFrontrun: {
    orchestratorContract: string;
    workerContract: string;
    scrutinyValidatorContract: string;
    scrutinyFeatureReviewerContract: string;
    droidsScrutinyFeatureReviewer: string;
  };
};

export type ProtocolRepository = {
  load(): ProtocolData;
  path(...segments: string[]): string;
};

type CachedProtocolData = {
  fingerprint: string;
  data: ProtocolData;
};

function missingProtocolFiles(root: string): string[] {
  return REQUIRED_PROTOCOL_FILES.filter((file) => !existsSync(join(root, file)));
}

function protocolRootCandidate(root: string): string | undefined {
  try {
    const canonicalRoot = realpathSync(root);
    return missingProtocolFiles(canonicalRoot).length === 0 ? canonicalRoot : undefined;
  } catch {
    return undefined;
  }
}

function requireProtocolRoot(root: string, label: string): string {
  let canonicalRoot: string;
  try {
    canonicalRoot = realpathSync(root);
  } catch {
    throw new Error(`${label} is not readable: ${root}`);
  }

  const missing = missingProtocolFiles(canonicalRoot);
  if (missing.length > 0) {
    throw new Error(`${label} is missing required protocol files: ${missing.join(", ")}`);
  }

  return canonicalRoot;
}

function findRootDir(): string {
  if (process.env.ODIN_SENTINEL_ROOT) {
    return requireProtocolRoot(process.env.ODIN_SENTINEL_ROOT, "ODIN_SENTINEL_ROOT");
  }

  const candidates = [
    join(__dirname, ".."),
    join(__dirname, "..", ".."),
    join(__dirname, "..", "..", ".."),
    process.cwd()
  ];
  const root = candidates.map(protocolRootCandidate).find((candidate): candidate is string => Boolean(candidate));
  if (!root) {
    throw new Error("Could not locate ODIN Sentinel protocol directory");
  }
  return root;
}

function readYaml(path: string): Record<string, unknown> {
  return requireRecord(YAML.parse(readFileSync(path, "utf8")), path);
}

function protocolFingerprint(rootDir: string): string {
  return REQUIRED_PROTOCOL_FILES.map((file) => {
    const stats = statSync(join(rootDir, file));
    return `${file}:${stats.mtimeMs}:${stats.size}`;
  }).join("|");
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }

  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }

  return Object.freeze(value);
}

export function createFileProtocolRepository(rootDir = findRootDir()): ProtocolRepository {
  const canonicalRootDir = requireProtocolRoot(rootDir, "Protocol root");
  let cache: CachedProtocolData | undefined;
  const protocolPath = (...segments: string[]) => join(canonicalRootDir, "protocol", ...segments);

  return {
    path: protocolPath,
    load: () => {
      const fingerprint = protocolFingerprint(canonicalRootDir);
      if (cache?.fingerprint === fingerprint) {
        return cache.data;
      }

      const data = deepFreeze({
        protocol: readFileSync(protocolPath("SCP.md"), "utf8"),
        roles: readYaml(protocolPath("roles.yaml")),
        topology: readYaml(protocolPath("topology.yaml")),
        modelProfiles: readYaml(protocolPath("model-profiles.yaml")),
        closeout: readYaml(protocolPath("closeout.yaml")),
        delegation: readYaml(protocolPath("delegation.yaml")),
        bootReceipt: readYaml(protocolPath("receipts", "boot-receipt.yaml")),
        teamManifest: readYaml(protocolPath("receipts", "team-manifest.yaml")),
        harnessProbeMatrix: readYaml(protocolPath("receipts", "harness-probe-matrix.yaml")),
        stepUpLadder: readYaml(protocolPath("resources", "step-up-ladder.yaml")),
        recipeCapture: readYaml(protocolPath("resources", "recipe-capture.yaml")),
        qaIndependence: readYaml(protocolPath("resources", "qa-independence.yaml")),
        commitGate: readYaml(protocolPath("resources", "commit-gate.yaml")),
        harnessControlMatrix: readYaml(protocolPath("resources", "harness-control-matrix.yaml")),
        authorityChain: readYaml(protocolPath("resources", "authority-chain.yaml")),
        blockedPodRollover: readYaml(protocolPath("resources", "blocked-pod-rollover.yaml")),
        sliceHealthSentinels: readYaml(protocolPath("resources", "slice-health-sentinels.yaml")),
        podBringUp: readYaml(protocolPath("resources", "pod-bringup.yaml")),
        bootstrapSkill: readFileSync(protocolPath("bootstrap-skill.md"), "utf8"),
        skillReferences: {
          bootReceiptExamples: readFileSync(protocolPath("skill-references", "boot-receipt-examples.md"), "utf8"),
          canonicalIntroductionPrompt: readFileSync(protocolPath("skill-references", "canonical-introduction-prompt.md"), "utf8"),
          harnessSkillTargets: readFileSync(protocolPath("skill-references", "harness-skill-targets.md"), "utf8"),
          teamBootstrapRunbook: readFileSync(protocolPath("skill-references", "team-bootstrap-runbook.md"), "utf8")
        },
        roleCards: {
          execPm: readFileSync(protocolPath("role-cards", "exec-pm.md"), "utf8"),
          teamPm: readFileSync(protocolPath("role-cards", "team-pm.md"), "utf8"),
          devWorker: readFileSync(protocolPath("role-cards", "dev-worker.md"), "utf8"),
          qaWorker: readFileSync(protocolPath("role-cards", "qa-worker.md"), "utf8"),
          execAsst: readFileSync(protocolPath("role-cards", "exec-asst.md"), "utf8")
        },
        missionFrontrun: {
          orchestratorContract: readFileSync(protocolPath("mission-frontrun", "orchestrator-contract.md"), "utf8"),
          workerContract: readFileSync(protocolPath("mission-frontrun", "worker-contract.md"), "utf8"),
          scrutinyValidatorContract: readFileSync(protocolPath("mission-frontrun", "scrutiny-validator-contract.md"), "utf8"),
          scrutinyFeatureReviewerContract: readFileSync(protocolPath("mission-frontrun", "scrutiny-feature-reviewer-contract.md"), "utf8"),
          droidsScrutinyFeatureReviewer: readFileSync(protocolPath("mission-frontrun", "droids-scrutiny-feature-reviewer.md"), "utf8")
        }
      });

      cache = { fingerprint, data };
      return data;
    }
  };
}
