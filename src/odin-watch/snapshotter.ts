import type { SubstrateType } from "../protocol/schemas.js";

export interface Snapshot {
  pane_id: string;
  substrate: SubstrateType;
  text: string;
  hash: string; // SHA-256 hex of text content
  ts: number;   // Unix timestamp ms
}

export interface Snapshotter {
  capture(pane_id: string): Promise<Snapshot>;
}
