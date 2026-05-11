#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "../mcp/server.js";

async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown startup failure";
  console.error(`odin-sentinel failed to start: ${message}`);
  process.exitCode = 1;
}
