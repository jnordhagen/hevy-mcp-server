#!/usr/bin/env node
/**
 * Local stdio MCP server for the Hevy fitness API.
 *
 * A single-user, no-OAuth alternative to the remote Cloudflare Workers server.
 * Reads the Hevy API key from the HEVY_API_KEY environment variable and exposes
 * the same 21 tools over stdio, so it can be wired directly into Claude Desktop,
 * Claude Code, the MCP Inspector, or any other stdio MCP client.
 *
 * Run with:  HEVY_API_KEY=your-key npx tsx src/local.ts
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { HevyClient } from "./lib/client.js";
import { registerHevyTools } from "./lib/tools.js";

// NOTE: stdout is reserved for the MCP protocol stream, so all human-facing
// logging must go to stderr.
async function main() {
	const apiKey = process.env.HEVY_API_KEY;
	if (!apiKey) {
		console.error(
			"Error: HEVY_API_KEY environment variable is required.\n" +
				"Get your key at https://hevy.com/settings?developer and set it, e.g.:\n" +
				"  HEVY_API_KEY=your-key npx tsx src/local.ts",
		);
		process.exit(1);
	}

	const server = new McpServer({
		name: "Hevy API (local)",
		version: "3.1.0",
		description:
			"Local single-user stdio MCP server for the Hevy fitness tracking API",
	});

	const client = new HevyClient({ apiKey });
	registerHevyTools(server, client);

	const transport = new StdioServerTransport();
	await server.connect(transport);

	console.error("Hevy MCP server (local stdio) running.");
}

main().catch((error) => {
	console.error("Fatal error starting Hevy MCP server:", error);
	process.exit(1);
});
