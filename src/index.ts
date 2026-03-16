#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createStudyMaterialsServer } from "./server.js";

async function main(): Promise<void> {
  const server = await createStudyMaterialsServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  await server.startBackgroundServices();
  console.error("fernfh-s2 MCP server listening on stdio");
}

main().catch((error) => {
  console.error("fernfh-s2 MCP server failed:", error);
  process.exit(1);
});
