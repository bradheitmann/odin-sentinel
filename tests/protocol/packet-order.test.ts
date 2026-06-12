import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SKILL_PATHS = [
  "protocol/bootstrap-skill.md",
  "plugins/odin-scp/skills/odin-scp/SKILL.md",
];

const ORDERED_SECTIONS = [
  "Stable identity block",
  "Stable role card",
  "Stable repo invariants",
  "Stable LCE",
  "Volatile dispatch tail",
];

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

describe("packet-order canonical section", () => {
  it("both SKILL.md copies contain the canonical packet-order section", () => {
    for (const path of SKILL_PATHS) {
      const content = readFileSync(path, "utf8");
      expect(content, `${path} must contain packet-order heading`).toContain(
        "Canonical Cache-Aligned Packet Ordering"
      );
    }
  });

  it("both SKILL.md copies contain canonical sections in documented order", () => {
    for (const path of SKILL_PATHS) {
      const content = readFileSync(path, "utf8");
      let lastIndex = -1;
      for (const section of ORDERED_SECTIONS) {
        const idx = content.indexOf(section);
        expect(idx, `${path}: section "${section}" must be present`).toBeGreaterThan(-1);
        expect(
          idx,
          `${path}: section "${section}" must appear after the previous section`
        ).toBeGreaterThan(lastIndex);
        lastIndex = idx;
      }
    }
  });

  it("both SKILL.md copies are byte-identical", () => {
    const hashes = SKILL_PATHS.map((p) => sha256(readFileSync(p, "utf8")));
    expect(hashes[0], "sha256 parity: both copies must be identical").toBe(hashes[1]);
  });
});
