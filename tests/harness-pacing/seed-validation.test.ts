import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { loadSeed, recommend } from "../../src/harness-pacing/recommend.js";
import { isValidHarnessProfile } from "../../src/harness-pacing/storage.js";

// quality-fix-1 F-26: every shipped seed passes the module's own validator, and loadSeed refuses
// (returns null for) a seed that does not.
const seedDir = fileURLToPath(new URL("../../src/harness-pacing/seeds/", import.meta.url));
const seedFiles = readdirSync(seedDir).filter((file) => file.endsWith(".json"));

describe("shipped harness-pacing seeds", () => {
  it("the seed directory is not empty", () => {
    expect(seedFiles.length).toBeGreaterThan(0);
  });

  it.each(seedFiles)("%s passes isValidHarnessProfile", (file) => {
    const harnessId = file.replace(/\.json$/, "");
    const parsed: unknown = JSON.parse(readFileSync(join(seedDir, file), "utf8"));
    expect(isValidHarnessProfile(parsed, harnessId)).toBe(true);
    expect(loadSeed(harnessId, seedDir)).not.toBeNull();
  });
});

describe("loadSeed validates what it loads", () => {
  it("returns null for a {} seed", () => {
    const fsExists = vi.fn().mockReturnValue(true);
    const fsRead = vi.fn().mockReturnValue("{}");
    expect(loadSeed("pi", "/tmp/seeds", fsRead as never, fsExists)).toBeNull();
  });

  it("returns null for a seed whose samples_total disagrees with its events", () => {
    const seed = JSON.parse(readFileSync(join(seedDir, "pi.json"), "utf8")) as Record<string, unknown>;
    const fsExists = vi.fn().mockReturnValue(true);
    const fsRead = vi.fn().mockReturnValue(JSON.stringify({ ...seed, samples_total: 3 }));
    expect(loadSeed("pi", "/tmp/seeds", fsRead as never, fsExists)).toBeNull();
  });

  it("recommend('pi') returns the seed's single-line recommendation", () => {
    const rec = recommend("pi");
    expect(rec.harness_id).toBe("pi");
    expect(rec.submit_profile).toBe("single_line_flatten");
  });
});
