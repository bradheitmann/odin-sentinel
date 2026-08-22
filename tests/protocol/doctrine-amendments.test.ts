import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

// The three doctrine copies that must carry the seven identifier-tagged
// amendments (SLICE-AMEND-PROTO-DEV-001, spec-amended AC2: identical amendment
// text in mirrored regions, hash-compared by this test).
const DOCTRINE_COPIES = [
  "protocol/SCP.md",
  "plugins/odin-scp/skills/odin-scp/SKILL.md",
  "protocol/bootstrap-skill.md",
] as const;

const AMENDMENT_REGIONS = [
  "RET-006",
  "RET-010-REL-005",
  "RET-011",
  "DIS-001",
  "DIS-003",
  "DIS-004",
  "DIS-008",
] as const;

// RET-010 and REL-005 are one work item tagged with both source identifiers.
const AMENDMENT_IDENTIFIERS = [
  "RET-006",
  "RET-010",
  "REL-005",
  "RET-011",
  "DIS-001",
  "DIS-003",
  "DIS-004",
  "DIS-008",
] as const;

function readRepoFile(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), "utf8");
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function extractRegion(text: string, regionId: string, filePath: string): string {
  const begin = `<!-- BEGIN SCP-AMENDMENT ${regionId} -->`;
  const end = `<!-- END SCP-AMENDMENT ${regionId} -->`;
  const start = text.indexOf(begin);
  const stop = text.indexOf(end);
  if (start === -1 || stop === -1 || stop < start) {
    throw new Error(`${filePath}: missing or malformed mirrored region ${regionId}`);
  }
  if (text.indexOf(begin, start + begin.length) !== -1) {
    throw new Error(`${filePath}: duplicate mirrored region ${regionId}`);
  }
  return text.slice(start, stop + end.length);
}

describe("doctrine amendments (SLICE-AMEND-PROTO-DEV-001)", () => {
  it("tags all seven amendments with their source identifiers in all three copies", () => {
    for (const path of DOCTRINE_COPIES) {
      const text = readRepoFile(path);
      for (const id of AMENDMENT_IDENTIFIERS) {
        expect(text.includes(id), `${path} missing amendment identifier ${id}`).toBe(true);
      }
    }
  });

  it("keeps every mirrored amendment region byte-identical across the three copies", () => {
    for (const regionId of AMENDMENT_REGIONS) {
      const hashes = DOCTRINE_COPIES.map((path) =>
        sha256(extractRegion(readRepoFile(path), regionId, path)),
      );
      expect(
        new Set(hashes).size,
        `mirrored region ${regionId} diverged across ${DOCTRINE_COPIES.join(", ")}`,
      ).toBe(1);
    }
  });

  it("keeps the two skill copies byte-identical as whole-file mirrors", () => {
    expect(sha256(readRepoFile("plugins/odin-scp/skills/odin-scp/SKILL.md"))).toBe(
      sha256(readRepoFile("protocol/bootstrap-skill.md")),
    );
  });

  it("preserves the DIS-003 dual-verdict guard (distinct concerns, both required)", () => {
    for (const path of DOCTRINE_COPIES) {
      const region = extractRegion(readRepoFile(path), "DIS-003", path);
      expect(region).toContain("SLICE_QA_PASS");
      expect(region).toContain("HOLDOUT_ACCEPTED");
      expect(region).toContain("different concerns");
      expect(region).toContain("qa-independence.yaml");
      expect(region).toContain("both remain required for closure");
    }
  });

  it("bounds audit-of-audit behind break-glass, human authority, and named contradiction", () => {
    for (const path of DOCTRINE_COPIES) {
      const region = extractRegion(readRepoFile(path), "DIS-008", path);
      expect(region).toContain("break-glass");
      expect(region).toContain("human authority");
      expect(region).toContain("named, concrete contradiction");
    }
  });
});
