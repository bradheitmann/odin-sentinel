import { cpSync, mkdtempSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createFileProtocolRepository } from "../../src/protocol/repository.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const tempRoots: string[] = [];

function makeProtocolRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "odin-protocol-"));
  cpSync(join(repoRoot, "protocol"), join(root, "protocol"), { recursive: true });
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("file protocol repository", () => {
  it("returns cached protocol data until a protocol file changes", () => {
    const root = makeProtocolRoot();
    const repository = createFileProtocolRepository(root);

    const first = repository.load();
    const second = repository.load();

    expect(second).toBe(first);
    expect(Object.isFrozen(second.roles)).toBe(true);

    const rolesPath = join(root, "protocol", "roles.yaml");
    writeFileSync(
      rolesPath,
      [
        "version: 0.2.0",
        "roles:",
        "  EXEC_PM:",
        "    title: EXEC PM UPDATED",
        "    layer: executive"
      ].join("\n")
    );
    const future = new Date(Date.now() + 5000);
    utimesSync(rolesPath, future, future);

    const third = repository.load();

    expect(third).not.toBe(first);
    expect(third.roles).toMatchObject({
      roles: {
        EXEC_PM: {
          title: "EXEC PM UPDATED"
        }
      }
    });
  });

  it("rejects roots missing required protocol files", () => {
    const root = mkdtempSync(join(tmpdir(), "odin-empty-"));
    tempRoots.push(root);

    expect(() => createFileProtocolRepository(root)).toThrow("missing required protocol files");
  });

  it("canonicalizes symlinked protocol roots", () => {
    const root = makeProtocolRoot();
    const link = `${root}-link`;
    symlinkSync(root, link, "dir");
    tempRoots.push(link);

    const repository = createFileProtocolRepository(link);

    expect(repository.path("roles.yaml")).toBe(join(realpathSync(root), "protocol", "roles.yaml"));
  });

  it("loads the canonical CMUX surface layout under default_topology.surface_layout", () => {
    const root = makeProtocolRoot();
    const repository = createFileProtocolRepository(root);

    expect(repository.load().topology).toMatchObject({
      default_topology: {
        surface_layout: {
          canonical_profile: "human_cmux_quad",
          human_cmux_quad: {
            no_cmux_governed_status: "NOT_GOVERNED_NO_CMUX",
            reject_tab_only_unless_degraded_mode_approved: true
          }
        }
      }
    });
  });
});
