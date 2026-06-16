import { beforeEach, describe, expect, it } from "vitest";
import { HevyClient } from "../../src/lib/client.js";
import { registerHevyTools } from "../../src/lib/tools.js";
import {
	analyticsProgressionHistory,
	analyticsTemplatePages,
	analyticsTemplates,
	analyticsWorkoutPages,
} from "../fixtures/analytics.js";
import { mockFetchSuccess } from "../setup.js";

type ToolHandler = (args: any) => Promise<any>;

class CapturingServer {
	tools = new Map<string, { schema: any; handler: ToolHandler }>();

	tool(name: string, schema: any, handler: ToolHandler) {
		this.tools.set(name, { schema, handler });
	}
}

describe("analytics MCP tools", () => {
	let server: CapturingServer;

	beforeEach(() => {
		server = new CapturingServer();
		registerHevyTools(
			server as any,
			new HevyClient({ apiKey: "test-api-key" }),
		);
	});

	it("registers the analytics tools through the shared tool registration path", () => {
		expect(server.tools.has("get_training_summary")).toBe(true);
		expect(server.tools.has("get_muscle_group_volume")).toBe(true);
		expect(server.tools.has("get_exercise_progression")).toBe(true);
		expect(server.tools.has("get_personal_records")).toBe(true);
	});

	it("returns a compact training summary digest", async () => {
		mockFetchSuccess(analyticsWorkoutPages[0]);
		mockFetchSuccess(analyticsWorkoutPages[1]);

		const result = await callTool(server, "get_training_summary", {
			start_date: "2025-12-01",
			end_date: "2026-01-31",
			group_by: "month",
		});
		const digest = parseDigest(result);

		expect(result.content).toHaveLength(3);
		expect(result.content[2].text).not.toContain("Full data");
		expect(digest.tool).toBe("get_training_summary");
		expect(digest.dateRange.since).toBe("2025-12-01T00:00:00.000Z");
		expect(digest.dateRange.until).toBe("2026-01-31T23:59:59.999Z");
		expect(digest.consistency.totalSessions).toBe(4);
		expect(digest.tonnage.totalTonnageLb).toBe(10229.4);
		expect(digest.fetch.truncated).toBe(false);
	});

	it("returns muscle-group set volume with template fetch metadata", async () => {
		mockFetchSuccess(analyticsWorkoutPages[0]);
		mockFetchSuccess(analyticsTemplatePages[0]);
		mockFetchSuccess(analyticsWorkoutPages[1]);

		const result = await callTool(server, "get_muscle_group_volume", {
			group_by: "week",
		});
		const digest = parseDigest(result);

		expect(digest.tool).toBe("get_muscle_group_volume");
		expect(digest.volume.totalSetsByMuscle.chest).toBe(2);
		expect(digest.volume.totalSetsByMuscle.unknown).toBe(1);
		expect(digest.volume.unknownTemplateIds).toEqual(["missing-template"]);
		expect(digest.templateCount).toBe(4);
		expect(digest.templateFetch.truncated).toBe(false);
	});

	it("returns exercise progression from flat exercise history", async () => {
		mockFetchSuccess(analyticsProgressionHistory);

		const result = await callTool(server, "get_exercise_progression", {
			exercise_template_id: "bench-template",
			group_by: "week",
		});
		const digest = parseDigest(result);

		expect(digest.tool).toBe("get_exercise_progression");
		expect(digest.entryCount).toBe(3);
		expect(digest.progression.bestE1RMLb).toBe(293.9);
		expect(digest.progression.bestSetVolumeLb).toBe(2204.6);
	});

	it("returns personal records grouped by primary muscle", async () => {
		mockFetchSuccess(analyticsWorkoutPages[0]);
		mockFetchSuccess(analyticsTemplatePages[0]);
		mockFetchSuccess(analyticsWorkoutPages[1]);

		const result = await callTool(server, "get_personal_records", {});
		const digest = parseDigest(result);

		expect(digest.tool).toBe("get_personal_records");
		expect(
			digest.personalRecords.exercises["bench-template"].bestE1RMLb.e1RMLb,
		).toBe(293.9);
		expect(digest.personalRecords.exercisesByPrimaryMuscle.chest).toEqual([
			"bench-template",
		]);
		expect(digest.personalRecords.unknownTemplateIds).toEqual([
			"missing-template",
		]);
	});

	it("invalidates the memoized muscle map after creating a custom template", async () => {
		mockFetchSuccess(analyticsWorkoutPages[0]);
		mockFetchSuccess(analyticsTemplatePages[0]);
		mockFetchSuccess(analyticsWorkoutPages[1]);

		await callTool(server, "get_muscle_group_volume", {});

		mockFetchSuccess({ id: "new-template", title: "New Lift" }, 201);
		await callTool(server, "create_exercise_template", {
			title: "New Lift",
			exercise_type: "weight_reps",
			equipment_category: "barbell",
			muscle_group: "chest",
		});

		mockFetchSuccess(analyticsWorkoutPages[0]);
		mockFetchSuccess({
			page: 1,
			page_count: 1,
			exercise_templates: [
				...analyticsTemplates,
				{
					id: "new-template",
					title: "New Lift",
					type: "weight_reps",
					primary_muscle_group: "chest",
					secondary_muscle_groups: [],
					is_custom: true,
				},
			],
		});
		mockFetchSuccess(analyticsWorkoutPages[1]);

		const result = await callTool(server, "get_muscle_group_volume", {});
		const digest = parseDigest(result);

		expect(digest.templateCount).toBe(5);
	});
});

async function callTool(server: CapturingServer, name: string, args: any) {
	const tool = server.tools.get(name);
	if (!tool) throw new Error(`Tool not registered: ${name}`);
	return tool.handler(args);
}

function parseDigest(result: any): any {
	return JSON.parse(result.content[2].text);
}
