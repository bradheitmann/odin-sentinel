import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SubstrateType } from "../../protocol/schemas.js";
import { execFileNoThrow } from "../../utils/execFileNoThrow.js";
import type { Snapshot, Snapshotter } from "../snapshotter.js";

/** How one substrate reads a pane's screen text. */
export interface CaptureCommand {
  command: string;
  args: (pane_id: string) => string[];
  substrate: SubstrateType;
}

/**
 * Screen-capture backend shared by every command-line substrate (cmux, tmux). A failed
 * capture throws, so the poll loop reports it instead of hashing, archiving, and classifying
 * an empty screen as if it were a real snapshot.
 */
export class CommandCaptureBackend implements Snapshotter {
  private readonly archiveDir: string;
  private readonly spec: CaptureCommand;

  constructor(archiveDir: string, spec: CaptureCommand) {
    this.archiveDir = archiveDir;
    this.spec = spec;
  }

  async capture(pane_id: string): Promise<Snapshot> {
    const result = await execFileNoThrow(this.spec.command, this.spec.args(pane_id));
    if (result.status !== 0) {
      const detail = result.stderr.trim().split("\n")[0] ?? "";
      throw new Error(
        `${this.spec.command} capture of ${pane_id} failed (exit ${result.status})${detail ? `: ${detail}` : ""}`
      );
    }

    const text = result.stdout;
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
      substrate: this.spec.substrate,
      text,
      hash,
      ts,
    };
  }
}
