import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { validateBootReceipt } from "../../src/protocol/service.js";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const roleCardRoot = join(repoRoot, "protocol/role-cards");

const e035OwnedCards = [
  "crush-stability.md",
  "mission-droid.md",
  "shadow.md",
  "dev-worker.md",
  "qa-worker.md",
];

function readRepoFile(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), "utf8");
}

function receiptVisibilityFinding(text: string): string | null {
  const firstReceiptLine = text
    .split("\n")
    .findIndex((line) => line.trim() === "SCP_MIN_BOOT_RECEIPT");
  if (firstReceiptLine === -1) return "missing SCP_MIN_BOOT_RECEIPT copy-paste block";
  if (firstReceiptLine + 1 > 80) return `receipt begins on line ${firstReceiptLine + 1}`;
  return null;
}

function homePathFinding(text: string): string | null {
  return /\/Users\/[A-Za-z0-9._-]+\//.test(text) ? "contains a macOS home path" : null;
}

function extractReceiptFields(text: string): { receiptLine: number; fields: Set<string> } | null {
  const lines = text.split("\n");
  const markerIdx = lines.findIndex((line) => line.trim() === "SCP_MIN_BOOT_RECEIPT");
  if (markerIdx === -1) return null;
  const fields = new Set<string>();
  const fence = /^[ \t]*(`{3,}|~{3,})/;
  for (let i = markerIdx; i < lines.length; i++) {
    const line = lines[i];
    if (i > markerIdx && fence.test(line)) break;
    const match = line.match(/^\s*([a-z_]+)\s*:/);
    if (match) fields.add(match[1]);
  }
  return { receiptLine: markerIdx + 1, fields };
}

// The staffing-audit fields validateBootReceipt requires on any receipt whose team is not "A"
// (protocol/receipts/boot-receipt.yaml staffing_audit; src/protocol/service.ts).
const NON_EXEC_STAFFING_FIELDS = ["staffed_by", "parent_surface_ref", "column_index", "team_letter"] as const;

function receiptFieldFinding(text: string): string | null {
  const parsed = extractReceiptFields(text);
  if (!parsed) return "missing SCP_MIN_BOOT_RECEIPT copy-paste block";
  for (const field of ["role_slot", "agent_id", "roster_ack"] as const) {
    if (!parsed.fields.has(field)) return `receipt block missing ${field}`;
  }
  return staffingFieldFinding(text);
}

// A non-exec card template (team: <team>) must carry the staffing-audit fields, or a receipt
// copied from it verbatim is rejected (quality-fix-1 F-44).
function staffingFieldFinding(text: string): string | null {
  const parsed = extractReceiptFields(text);
  if (!parsed) return "missing SCP_MIN_BOOT_RECEIPT copy-paste block";
  if (!/^\s*team:\s*<team>\s*$/m.test(receiptBlockText(text) ?? "")) return null;
  for (const field of NON_EXEC_STAFFING_FIELDS) {
    if (!parsed.fields.has(field)) return `receipt block missing ${field}`;
  }
  return null;
}

/** The SCP_MIN_BOOT_RECEIPT block's lines after the marker, up to the closing fence. */
function receiptBlockText(text: string): string | null {
  const lines = text.split("\n");
  const markerIdx = lines.findIndex((line) => line.trim() === "SCP_MIN_BOOT_RECEIPT");
  if (markerIdx === -1) return null;
  const fence = /^[ \t]*(`{3,}|~{3,})/;
  const end = lines.findIndex((line, index) => index > markerIdx && fence.test(line));
  return lines.slice(markerIdx + 1, end === -1 ? undefined : end).join("\n");
}

describe("E035 role-card coverage", () => {
  it("ships all five E035-owned role cards", () => {
    for (const card of e035OwnedCards) {
      expect(existsSync(join(roleCardRoot, card)), card).toBe(true);
    }
  });

  it("places a copy-paste SCP_MIN_BOOT_RECEIPT block by line 80 in every owned card", () => {
    for (const card of e035OwnedCards) {
      expect(receiptVisibilityFinding(readRepoFile(`protocol/role-cards/${card}`)), card).toBeNull();
    }
  });

  it("keeps SCP_MIN_BOOT_RECEIPT immediately visible in bootstrap-skill.md", () => {
    const bootstrap = readRepoFile("protocol/bootstrap-skill.md");
    expect(bootstrap).toContain("### Immediate SCP_MIN_BOOT_RECEIPT Copy-Paste Block");
    expect(bootstrap).toContain("current_state: BOOTSTRAPPED_IDLE");
  });

  it("retains parked and reassigned context in both worker cards", () => {
    const dev = readRepoFile("protocol/role-cards/dev-worker.md");
    const qa = readRepoFile("protocol/role-cards/qa-worker.md");
    expect(dev).toMatch(/parked or reassigned[\s\S]*retain the last safe state/i);
    expect(qa).toMatch(/parked or reassigned[\s\S]*retain the reviewed candidate digest/i);
  });

  it("contains no macOS home path in any role card", () => {
    for (const card of readdirSync(roleCardRoot).filter((name) => name.endsWith(".md"))) {
      expect(homePathFinding(readRepoFile(`protocol/role-cards/${card}`)), card).toBeNull();
    }
  });

  it("fails closed for missing, late, and machine-specific receipt fixtures", () => {
    expect(receiptVisibilityFinding("# Card\nNo receipt here\n")).toBe(
      "missing SCP_MIN_BOOT_RECEIPT copy-paste block",
    );
    expect(receiptVisibilityFinding(`${"line\n".repeat(80)}SCP_MIN_BOOT_RECEIPT\n`)).toBe(
      "receipt begins on line 81",
    );
    // synthetic sample built at runtime so tracked bytes carry no detector-shaped literal; value is not real
    const homePath = ["", "Users", "example", "repo"].join("/") + "/";
    expect(homePathFinding(`cwd: ${homePath}\n`)).toBe("contains a macOS home path");
  });

  it("requires role_slot, agent_id, and roster_ack inside every owned card receipt block", () => {
    for (const card of e035OwnedCards) {
      expect(receiptFieldFinding(readRepoFile(`protocol/role-cards/${card}`)), card).toBeNull();
    }
  });

  it("fails closed when role_slot, agent_id, or roster_ack is absent from the receipt block", () => {
    const blockWith = (fields: string[]) =>
      "```\nSCP_MIN_BOOT_RECEIPT\n" +
      fields.map((field) => `${field}: <placeholder>`).join("\n") +
      "\nrole: R\nteam: T\ncurrent_state: BOOTSTRAPPED_IDLE\n```\n";
    expect(receiptFieldFinding(blockWith(["role_slot", "agent_id", "roster_ack"]))).toBeNull();
    expect(receiptFieldFinding(blockWith(["agent_id", "roster_ack"]))).toBe(
      "receipt block missing role_slot",
    );
    expect(receiptFieldFinding(blockWith(["role_slot", "roster_ack"]))).toBe(
      "receipt block missing agent_id",
    );
    expect(receiptFieldFinding(blockWith(["role_slot", "agent_id"]))).toBe(
      "receipt block missing roster_ack",
    );
  });

  it("does not satisfy the block check when required tokens appear only outside the receipt block", () => {
    const proseOutsideBlock =
      "This prose mentions role_slot, agent_id, and roster_ack before the block.\n\n" +
      "```\nSCP_MIN_BOOT_RECEIPT\nrole: R\nteam: T\ncurrent_state: BOOTSTRAPPED_IDLE\n```\n";
    expect(receiptFieldFinding(proseOutsideBlock)).toBe("receipt block missing role_slot");
  });
});

// quality-fix-1 F-44: a receipt written verbatim from a non-exec card's template must not be
// rejected for missing fields.
const nonExecCards = ["team-pm.md", ...e035OwnedCards];

describe("non-exec role-card receipt templates carry the staffing-audit fields", () => {
  it.each(nonExecCards)("%s template passes the extended receipt field check", (card) => {
    expect(receiptFieldFindingForCard(card)).toBeNull();
  });

  it.each(nonExecCards)("%s template run through validateBootReceipt has no missing fields", (card) => {
    const block = receiptBlockText(readRepoFile(`protocol/role-cards/${card}`));
    expect(block, card).not.toBeNull();
    const receipt = parseYaml(block ?? "") as Record<string, unknown>;
    expect(receipt.team, card).toBe("<team>");
    expect(validateBootReceipt(receipt).missing, card).toEqual([]);
  });

  it("the extended check fails closed when a staffing field is absent from a <team> template", () => {
    const block = (fields: string[]) =>
      "```\nSCP_MIN_BOOT_RECEIPT\nrole_slot: <team>/DEV-1\nagent_id: x\nroster_ack: true\nteam: <team>\n" +
      fields.map((field) => `${field}: <value>`).join("\n") +
      "\n```\n";
    expect(receiptFieldFinding(block([...NON_EXEC_STAFFING_FIELDS]))).toBeNull();
    expect(receiptFieldFinding(block(["staffed_by", "parent_surface_ref", "column_index"]))).toBe(
      "receipt block missing team_letter",
    );
  });
});

function receiptFieldFindingForCard(card: string): string | null {
  const text = readRepoFile(`protocol/role-cards/${card}`);
  const team = /^\s*team:\s*(\S+)\s*$/m.exec(receiptBlockText(text) ?? "")?.[1];
  if (team !== "<team>") return `expected a team: <team> template, found ${String(team)}`;
  return staffingFieldFinding(text);
}
