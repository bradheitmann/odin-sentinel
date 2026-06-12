import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { WakeState } from "../protocol/schemas.js";

/**
 * Write the three output files for a single poll result:
 *   {flagDir}/{label}.flag       — exactly one byte: "0" or "1", no newline
 *   {flagDir}/{label}.reason     — text reason codes, one per line
 *   {flagDir}/{label}.state.json — WakeState JSON object
 */
export function writeWakeFiles(
  flagDir: string,
  label: string,
  state: WakeState
): void {
  mkdirSync(flagDir, { recursive: true });

  // Flag file: exactly one byte ASCII character "0" or "1", no newline
  const flagPath = join(flagDir, `${label}.flag`);
  writeFileSync(flagPath, String(state.wake) as "0" | "1", {
    encoding: "utf8",
  });

  // Reason file: one reason code per line
  const reasonPath = join(flagDir, `${label}.reason`);
  writeFileSync(reasonPath, state.reason_codes.join("\n"), {
    encoding: "utf8",
  });

  // State JSON file
  const statePath = join(flagDir, `${label}.state.json`);
  writeFileSync(statePath, JSON.stringify(state, null, 2), {
    encoding: "utf8",
  });
}
