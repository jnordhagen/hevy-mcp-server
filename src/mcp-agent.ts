import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { HevyClient } from "./lib/client.js";
import { registerHevyTools } from "./lib/tools.js";
import type { Props } from "./utils.js";
import { getUserApiKey } from "./lib/key-storage.js";

// Environment interface for OAuth multi-user support
interface Env extends Cloudflare.Env {
	// Legacy: HEVY_API_KEY is deprecated in favor of per-user keys in KV
	HEVY_API_KEY?: string;
}

// Define our MCP agent with Hevy API tools and OAuth support
export class MyMCP extends McpAgent<Env, Record<string, never>, Props> {
	server = new McpServer({
		name: "Hevy API",
		version: "3.1.0",
		description: "Multi-user remote MCP server for Hevy fitness tracking API with OAuth authentication",
	});

	private client!: HevyClient;

	async init() {
		// Check if user is authenticated
		if (!this.props || !this.props.login) {
			const setupHint = this.props?.baseUrl
				? ` Visit ${this.props.baseUrl}/setup to get started.`
				: " Visit your server URL to authenticate.";
			throw new Error(
				"Authentication required. Please authenticate via OAuth to use the Hevy MCP server." +
					setupHint
			);
		}

		// Load user's Hevy API key from encrypted KV storage
		const hevyApiKey = await getUserApiKey(
			this.env.OAUTH_KV,
			this.env.COOKIE_ENCRYPTION_KEY,
			this.props.login
		);

		if (!hevyApiKey) {
			const setupUrl = this.props.baseUrl
				? `${this.props.baseUrl}/setup`
				: '/setup (visit your server URL)';
			throw new Error(
				`Hevy API key not configured for user ${this.props.login}. ` +
					`Please visit ${setupUrl} to configure your API key.`
			);
		}

		// Initialize Hevy API client with user-specific API key
		this.client = new HevyClient({
			apiKey: hevyApiKey,
		});

		// Register all Hevy MCP tools (shared with the local stdio server)
		registerHevyTools(this.server, this.client);
	}
}
