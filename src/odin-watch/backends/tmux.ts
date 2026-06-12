import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileNoThrow } from "../../utils/execFileNoThrow.js";
import type { Snapshot, Snapshotter } from "../snapshotter.js";

export class TmuxBackend implements Snapshotter {
  private readonly archiveDir: string;

  constructor(archiveDir: string) {
    this.archiveDir = archiveDir;
  }

  async capture(pane_id: string): Promise<Snapshot> {
    const result = await execFileNoThrow("tmux", [
      "capture-pane",
      "-p",
      "-t",
      pane_id,
    ]);

    const text = result.status === 0 ? result.stdout : "";
    const ts = Date.now();
    const hash = createHash("sha256").update(text).digest("hex");

    // Archive raw screen text
    try {
      mkdirSync(this.archiveDir, { recursive: true });
      const filename = `${pane_id.replace(/[^a-zA-Z0-9_-]/g, "_")}_${ts}.txt`;
      writeFileSync(join(this.archiveDir, filename), text, {
        encoding: "utf8",
      });
    } catch {
      // Archive failure is non-fatal; snapshot still returned
    }

    return {
      pane_id,
      substrate: "tmux",
      text,
      hash,
      ts,
    };
  }
}
