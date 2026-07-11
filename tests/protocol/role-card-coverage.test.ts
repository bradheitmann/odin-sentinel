import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

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

function receiptFieldFinding(text: string): string | null {
  const parsed = extractReceiptFields(text);
  if (!parsed) return "missing SCP_MIN_BOOT_RECEIPT copy-paste block";
  for (const field of ["role_slot", "agent_id", "roster_ack"] as const) {
    if (!parsed.fields.has(field)) return `receipt block missing ${field}`;
  }
  return null;
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
    expect(homePathFinding("cwd: /Users/example/repo/\n")).toBe("contains a macOS home path");
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
