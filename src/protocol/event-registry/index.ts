/**
 * EPIC-052 event registry public surface: the Wave-0 typed event union plus
 * the Wave-1 append-only JSONL storage and deterministic query functions.
 * No MCP wiring lives here (that is a separate slice); consumers import this
 * module directly and may inject it into the protocol service functions.
 */
export * from "./types.js";
export * from "./storage.js";
