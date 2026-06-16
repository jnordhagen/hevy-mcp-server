import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AllExerciseTemplatesResult, HevyClient } from "./client.js";
import {
	buildTemplateMuscleMap,
	computeConsistency,
	computeMuscleVolume,
	computePersonalRecords,
	computeProgression,
	computeTonnage,
	type ConsistencySummary,
	type GroupBy,
	type MuscleVolumeSummary,
	type PersonalRecordsSummary,
	type ProgressionSummary,
	type TemplateMuscleInfo,
	type TonnageSummary,
} from "./analytics.js";
import {
	CreateWorkoutSchema,
	UpdateWorkoutSchema,
	CreateRoutineSchema,
	UpdateRoutineSchema,
	CreateExerciseTemplateSchema,
	CreateRoutineFolderSchema,
	transformWorkoutToAPI,
	transformRoutineToAPI,
	transformExerciseTemplateToAPI,
	transformRoutineFolderToAPI,
} from "./schemas.js";
import {
	ValidationError,
	validatePagination,
	validateISO8601Date,
	validateWorkoutData,
	validateRoutineData,
	validateExerciseTemplate,
	PAGINATION_LIMITS,
} from "./transforms.js";
import { handleError } from "./errors.js";

const GroupBySchema = z.enum(["week", "month"]);

/**
 * Register all Hevy MCP tools on the given server using the given client.
 *
 * This is shared between the remote Cloudflare Workers agent (src/mcp-agent.ts)
 * and the local stdio server (src/local.ts) so tool behavior stays identical
 * across both transports.
 */
export function registerHevyTools(server: McpServer, client: HevyClient): void {
	let cachedMuscleMap: {
		map: Map<string, TemplateMuscleInfo>;
		templateFetch: AllExerciseTemplatesResult["metadata"];
		templateCount: number;
	} | null = null;

	async function getCachedMuscleMap() {
		if (!cachedMuscleMap) {
			const templates = await client.getAllExerciseTemplates();
			cachedMuscleMap = {
				map: buildTemplateMuscleMap(templates.exerciseTemplates),
				templateFetch: templates.metadata,
				templateCount: templates.exerciseTemplates.length,
			};
		}
		return cachedMuscleMap;
	}

	function invalidateCachedMuscleMap(): void {
		cachedMuscleMap = null;
	}

	// ============================================
	// WORKOUTS
	// ============================================

	server.tool(
		"get_workouts",
		{
			page: z
				.number()
				.optional()
				.describe("Page number (Must be 1 or greater)")
				.default(1),
			page_size: z
				.number()
				.optional()
				.describe("Number of items per page (Max 10)")
				.default(10),
		},
		async ({ page, page_size }) => {
			try {
				// Validate pagination parameters
				validatePagination(page, page_size, PAGINATION_LIMITS.WORKOUTS);

				const workouts = await client.getWorkouts({
					page,
					pageSize: page_size,
				});

				const workoutDetails =
					workouts.workouts
						?.map((workout: any, index: number) => {
							return `Workout ${index + 1}: ${workout.title || "Untitled"}\n  ID: ${workout.id}\n  Date: ${workout.start_time}`;
						})
						.join("\n") || "No workouts found";

				return {
					content: [
						{
							type: "text",
							text: `Retrieved ${workouts.workouts?.length || 0} workouts (page ${workouts.page} of ${workouts.page_count})`,
						},
						{
							type: "text",
							text: workoutDetails,
						},
						{
							type: "text",
							text: `\n\nFull data:\n${JSON.stringify(workouts.workouts, null, 2)}`,
						},
					],
				};
			} catch (error) {
				return handleError(error);
			}
		},
	);

	server.tool(
		"get_workout",
		{
			workout_id: z.string().describe("The ID of the workout to retrieve"),
		},
		async ({ workout_id }) => {
			try {
				const workout = await client.getWorkout(workout_id);

				return {
					content: [
						{
							type: "text",
							text: `Workout: ${workout.title || "Untitled"}\nID: ${workout.id}\nExercises: ${workout.exercises?.length || 0}`,
						},
						{
							type: "text",
							text: JSON.stringify(workout, null, 2),
						},
					],
				};
			} catch (error) {
				return handleError(error);
			}
		},
	);

	server.tool("create_workout", CreateWorkoutSchema.shape, async (args) => {
		try {
			// Validate workout data including dates, exercises, and RPE values
			validateWorkoutData(args);

			const workout = await client.createWorkout(transformWorkoutToAPI(args));

			return {
				content: [
					{
						type: "text",
						text: `✓ Successfully logged workout: ${workout.title}`,
					},
					{
						type: "text",
						text: `Workout ID: ${workout.id}\nExercises: ${workout.exercises?.length || 0}\nStarted: ${args.start_time}`,
					},
					{
						type: "text",
						text: `\n\nWorkout data:\n${JSON.stringify(workout, null, 2)}`,
					},
				],
			};
		} catch (error) {
			return handleError(error);
		}
	});

	server.tool(
		"update_workout",
		{
			workout_id: z.string().describe("The ID of the workout to update"),
			...UpdateWorkoutSchema.shape,
		},
		async (args) => {
			try {
				const { workout_id, ...workoutData } = args;

				// Validate workout data including dates, exercises, and RPE values
				validateWorkoutData(workoutData);

				const workout = await client.updateWorkout(
					workout_id,
					transformWorkoutToAPI(workoutData),
				);

				return {
					content: [
						{
							type: "text",
							text: `✓ Successfully updated workout: ${workout.title}`,
						},
						{
							type: "text",
							text: `Workout ID: ${workout.id}\nExercises: ${workout.exercises?.length || 0}`,
						},
					],
				};
			} catch (error) {
				return handleError(error);
			}
		},
	);

	server.tool("get_workouts_count", {}, async () => {
		try {
			const result = await client.getWorkoutsCount();

			return {
				content: [
					{
						type: "text",
						text: `Total workouts: ${result.workout_count}`,
					},
				],
			};
		} catch (error) {
			return handleError(error);
		}
	});

	server.tool(
		"get_workout_events",
		{
			page: z
				.number()
				.optional()
				.describe("Page number (Must be 1 or greater)")
				.default(1),
			page_size: z
				.number()
				.optional()
				.describe("Number of items per page (Max 10)")
				.default(5),
			since: z
				.string()
				.optional()
				.describe(
					"Get events since this date (ISO 8601 format, e.g., 2024-01-01T00:00:00Z)",
				),
		},
		async (args) => {
			try {
				// Validate pagination parameters
				validatePagination(
					args.page,
					args.page_size,
					PAGINATION_LIMITS.WORKOUT_EVENTS,
				);

				// Validate date format if provided
				if (args.since) {
					validateISO8601Date(args.since, "since");
				}

				const params: any = { page: args.page, pageSize: args.page_size };
				if (args.since) params.since = args.since;

				const events = await client.getWorkoutEvents(params);

				const eventDetails =
					events.events
						?.map((event: any, index: number) => {
							if (event.type === "deleted") {
								return `${index + 1}. DELETED - Workout ID: ${event.id}\n   Deleted at: ${event.deleted_at}`;
							} else {
								return `${index + 1}. UPDATED - ${event.workout?.title || "Untitled"}\n   Workout ID: ${event.workout?.id}\n   Updated: ${event.workout?.updated_at}`;
							}
						})
						.join("\n") || "No events found";

				return {
					content: [
						{
							type: "text",
							text: `Retrieved ${events.events?.length || 0} workout events (page ${events.page} of ${events.page_count})`,
						},
						{
							type: "text",
							text: eventDetails,
						},
					],
				};
			} catch (error) {
				return handleError(error);
			}
		},
	);

	// ============================================
	// ROUTINES
	// ============================================

	server.tool(
		"get_routines",
		{
			page: z
				.number()
				.optional()
				.describe("Page number (Must be 1 or greater)")
				.default(1),
			page_size: z
				.number()
				.optional()
				.describe("Number of items per page (Max 10)")
				.default(5),
		},
		async ({ page, page_size }) => {
			try {
				// Validate pagination parameters
				validatePagination(page, page_size, PAGINATION_LIMITS.ROUTINES);

				const routines = await client.getRoutines({
					page,
					pageSize: page_size,
				});

				const routineDetails =
					routines.routines
						?.map((routine: any, index: number) => {
							const exerciseCount = routine.exercises?.length || 0;
							return `Routine ${index + 1}: ${routine.title}\n  Exercises: ${exerciseCount}\n  ID: ${routine.id}`;
						})
						.join("\n") || "No routines found";

				return {
					content: [
						{
							type: "text",
							text: `Retrieved ${routines.routines?.length || 0} routines (page ${routines.page} of ${routines.page_count})`,
						},
						{
							type: "text",
							text: routineDetails,
						},
						{
							type: "text",
							text: `\n\nFull data:\n${JSON.stringify(routines.routines, null, 2)}`,
						},
					],
				};
			} catch (error) {
				return handleError(error);
			}
		},
	);

	server.tool(
		"get_routine",
		{
			routine_id: z.string().describe("The ID of the routine to retrieve"),
		},
		async ({ routine_id }) => {
			try {
				const result = await client.getRoutine(routine_id);
				const routine = result.routine;

				return {
					content: [
						{
							type: "text",
							text: `Routine: ${routine.title}\nID: ${routine.id}\nExercises: ${routine.exercises?.length || 0}`,
						},
						{
							type: "text",
							text: JSON.stringify(routine, null, 2),
						},
					],
				};
			} catch (error) {
				return handleError(error);
			}
		},
	);

	server.tool("create_routine", CreateRoutineSchema.shape, async (args) => {
		try {
			// Validate routine data including exercises and sets
			validateRoutineData(args);

			const routine = await client.createRoutine(transformRoutineToAPI(args));

			return {
				content: [
					{
						type: "text",
						text: `✓ Successfully created routine: ${routine.title}`,
					},
					{
						type: "text",
						text: `Routine ID: ${routine.id}\nExercises: ${routine.exercises?.length || 0}`,
					},
					{
						type: "text",
						text: `\n\nFull routine data:\n${JSON.stringify(routine, null, 2)}`,
					},
				],
			};
		} catch (error) {
			return handleError(error);
		}
	});

	server.tool(
		"update_routine",
		{
			routine_id: z.string().describe("The ID of the routine to update"),
			...UpdateRoutineSchema.shape,
		},
		async (args) => {
			try {
				const { routine_id, ...routineData } = args;

				// Validate routine data including exercises and sets
				validateRoutineData(routineData);

				const routine = await client.updateRoutine(
					routine_id,
					transformRoutineToAPI(routineData),
				);

				return {
					content: [
						{
							type: "text",
							text: `✓ Successfully updated routine: ${routine.title}`,
						},
						{
							type: "text",
							text: `Routine ID: ${routine.id}\nExercises: ${routine.exercises?.length || 0}`,
						},
					],
				};
			} catch (error) {
				return handleError(error);
			}
		},
	);

	// ============================================
	// EXERCISE TEMPLATES
	// ============================================

	server.tool(
		"get_exercise_templates",
		{
			page: z
				.number()
				.optional()
				.describe("Page number (Must be 1 or greater)")
				.default(1),
			page_size: z
				.number()
				.optional()
				.describe("Number of items per page (Max 100)")
				.default(20),
		},
		async ({ page, page_size }) => {
			try {
				// Validate pagination parameters with higher limit for templates
				validatePagination(
					page,
					page_size,
					PAGINATION_LIMITS.EXERCISE_TEMPLATES,
				);

				const templates = await client.getExerciseTemplates({
					page,
					pageSize: page_size,
				});

				const templateDetails =
					templates.exercise_templates
						?.map((template: any, index: number) => {
							return `${index + 1}. ${template.title} (${template.type})\n   ID: ${template.id}\n   Primary: ${template.primary_muscle_group}\n   Custom: ${template.is_custom ? "Yes" : "No"}`;
						})
						.join("\n") || "No exercise templates found";

				return {
					content: [
						{
							type: "text",
							text: `Retrieved ${templates.exercise_templates?.length || 0} exercise templates (page ${templates.page} of ${templates.page_count})`,
						},
						{
							type: "text",
							text: templateDetails,
						},
					],
				};
			} catch (error) {
				return handleError(error);
			}
		},
	);

	server.tool(
		"get_exercise_template",
		{
			exercise_template_id: z
				.string()
				.describe("The ID of the exercise template"),
		},
		async ({ exercise_template_id }) => {
			try {
				const template = await client.getExerciseTemplate(exercise_template_id);

				return {
					content: [
						{
							type: "text",
							text: `Exercise: ${template.title}\nType: ${template.type}\nPrimary Muscle: ${template.primary_muscle_group}\nCustom: ${template.is_custom ? "Yes" : "No"}`,
						},
						{
							type: "text",
							text: JSON.stringify(template, null, 2),
						},
					],
				};
			} catch (error) {
				return handleError(error);
			}
		},
	);

	server.tool(
		"create_exercise_template",
		CreateExerciseTemplateSchema.shape,
		async (args) => {
			try {
				// Validate exercise template data
				validateExerciseTemplate(args);

				const result = await client.createExerciseTemplate(
					transformExerciseTemplateToAPI(args),
				);
				invalidateCachedMuscleMap();

				return {
					content: [
						{
							type: "text",
							text: `✓ Successfully created custom exercise template: ${args.title}`,
						},
						{
							type: "text",
							text: `Exercise Template ID: ${result.id}`,
						},
					],
				};
			} catch (error) {
				return handleError(error);
			}
		},
	);

	server.tool(
		"get_exercise_history",
		{
			exercise_template_id: z
				.string()
				.describe("The ID of the exercise template"),
			start_date: z
				.string()
				.optional()
				.describe(
					"Optional start date (ISO 8601 format, e.g., 2024-01-01T00:00:00Z)",
				),
			end_date: z
				.string()
				.optional()
				.describe(
					"Optional end date (ISO 8601 format, e.g., 2024-12-31T23:59:59Z)",
				),
		},
		async (args) => {
			try {
				// Validate date formats if provided
				if (args.start_date) {
					validateISO8601Date(args.start_date, "start_date");
				}
				if (args.end_date) {
					validateISO8601Date(args.end_date, "end_date");
				}

				// Validate that end_date is after start_date if both are provided
				if (args.start_date && args.end_date) {
					const start = new Date(args.start_date);
					const end = new Date(args.end_date);
					if (end <= start) {
						throw new ValidationError("end_date must be after start_date");
					}
				}

				const params: any = {};
				if (args.start_date) params.start_date = args.start_date;
				if (args.end_date) params.end_date = args.end_date;

				const history = await client.getExerciseHistory(
					args.exercise_template_id,
					params,
				);

				const historyDetails =
					history.exercise_history
						?.map((entry: any, index: number) => {
							return `${index + 1}. ${entry.workout_title} (${entry.workout_start_time})\n   Weight: ${entry.weight_kg}kg, Reps: ${entry.reps}, RPE: ${entry.rpe || "N/A"}\n   Set Type: ${entry.set_type}`;
						})
						.join("\n") || "No exercise history found";

				return {
					content: [
						{
							type: "text",
							text: `Retrieved ${history.exercise_history?.length || 0} exercise history entries`,
						},
						{
							type: "text",
							text: historyDetails,
						},
						{
							type: "text",
							text: `\n\nFull data:\n${JSON.stringify(history.exercise_history, null, 2)}`,
						},
					],
				};
			} catch (error) {
				return handleError(error);
			}
		},
	);

	// ============================================
	// TRAINING ANALYTICS
	// ============================================

	server.tool(
		"get_training_summary",
		{
			start_date: z
				.string()
				.optional()
				.describe(
					"Optional inclusive start date (ISO 8601; date-only expands to start of UTC day)",
				),
			end_date: z
				.string()
				.optional()
				.describe(
					"Optional inclusive end date (ISO 8601; date-only expands to end of UTC day)",
				),
			group_by: GroupBySchema.optional()
				.default("week")
				.describe("Bucket summaries by ISO week or UTC month"),
		},
		async (args) => {
			try {
				const groupBy = (args.group_by ?? "week") as GroupBy;
				const dateRange = normalizeAnalyticsDateRange(args);
				const workoutsResult = await client.getAllWorkouts({
					since: dateRange.since,
					until: dateRange.until,
				});
				const consistency = computeConsistency(workoutsResult.workouts, {
					groupBy,
				});
				const tonnage = computeTonnage(workoutsResult.workouts, { groupBy });
				const digest = {
					tool: "get_training_summary",
					groupBy,
					units: { weight: "lb", tonnage: "lb" },
					dateRange,
					fetch: workoutsResult.metadata,
					consistency,
					tonnage,
					setRules: {
						tonnage:
							"working sets only; warmups excluded; failure and dropset count as working sets; weight_kg*reps converted to lb",
					},
				};

				return analyticsResponse(
					`Training summary: ${consistency.totalSessions} sessions, ${tonnage.totalTonnageLb} lb total tonnage`,
					formatTrainingSummary(consistency, tonnage),
					digest,
				);
			} catch (error) {
				return handleError(error);
			}
		},
	);

	server.tool(
		"get_muscle_group_volume",
		{
			start_date: z
				.string()
				.optional()
				.describe(
					"Optional inclusive start date (ISO 8601; date-only expands to start of UTC day)",
				),
			end_date: z
				.string()
				.optional()
				.describe(
					"Optional inclusive end date (ISO 8601; date-only expands to end of UTC day)",
				),
			group_by: GroupBySchema.optional()
				.default("week")
				.describe("Bucket summaries by ISO week or UTC month"),
			include_warmups: z
				.boolean()
				.optional()
				.default(false)
				.describe("Include warmup sets in set-volume counts"),
			count_secondary: z
				.boolean()
				.optional()
				.default(false)
				.describe("Credit secondary muscles in addition to primary muscles"),
		},
		async (args) => {
			try {
				const groupBy = (args.group_by ?? "week") as GroupBy;
				const includeWarmups = args.include_warmups ?? false;
				const countSecondary = args.count_secondary ?? false;
				const dateRange = normalizeAnalyticsDateRange(args);
				const [workoutsResult, muscleMap] = await Promise.all([
					client.getAllWorkouts({
						since: dateRange.since,
						until: dateRange.until,
					}),
					getCachedMuscleMap(),
				]);
				const volume = computeMuscleVolume(
					workoutsResult.workouts,
					muscleMap.map,
					{
						groupBy,
						includeWarmups,
						countSecondary,
					},
				);
				const digest = {
					tool: "get_muscle_group_volume",
					groupBy,
					units: { volume: "sets" },
					dateRange,
					fetch: workoutsResult.metadata,
					templateFetch: muscleMap.templateFetch,
					templateCount: muscleMap.templateCount,
					volume,
					setRules: {
						default: "primary muscle only; warmups excluded",
						workingSets: "normal, failure, and dropset count as working sets",
					},
				};

				return analyticsResponse(
					`Muscle-group set volume: ${Object.keys(volume.totalSetsByMuscle).length} groups`,
					formatMuscleVolume(volume.totalSetsByMuscle, volume.setsByBucket),
					digest,
				);
			} catch (error) {
				return handleError(error);
			}
		},
	);

	server.tool(
		"get_exercise_progression",
		{
			exercise_template_id: z
				.string()
				.describe("Exercise template ID to analyze"),
			start_date: z
				.string()
				.optional()
				.describe(
					"Optional inclusive start date (ISO 8601; date-only expands to start of UTC day)",
				),
			end_date: z
				.string()
				.optional()
				.describe(
					"Optional inclusive end date (ISO 8601; date-only expands to end of UTC day)",
				),
			group_by: GroupBySchema.optional()
				.default("week")
				.describe("Bucket summaries by ISO week or UTC month"),
		},
		async (args) => {
			try {
				const groupBy = (args.group_by ?? "week") as GroupBy;
				const dateRange = normalizeAnalyticsDateRange(args);
				const history = await client.getExerciseHistory(
					args.exercise_template_id,
					{
						start_date: dateRange.since,
						end_date: dateRange.until,
					},
				);
				const historyEntries = Array.isArray(history.exercise_history)
					? history.exercise_history
					: [];
				const progression = computeProgression(historyEntries, { groupBy });
				const digest = {
					tool: "get_exercise_progression",
					exerciseTemplateId: args.exercise_template_id,
					groupBy,
					units: { weight: "lb", estimatedOneRepMax: "lb" },
					dateRange,
					entryCount: historyEntries.length,
					progression,
					setRules: {
						warmups: "excluded",
						unsupportedWeightMath:
							"sets without positive weight_kg and reps are counted as skipped and omitted from bucket records",
					},
				};

				return analyticsResponse(
					`Exercise progression: best estimated 1RM ${progression.bestE1RMLb} lb`,
					formatProgression(progression),
					digest,
				);
			} catch (error) {
				return handleError(error);
			}
		},
	);

	server.tool(
		"get_personal_records",
		{
			start_date: z
				.string()
				.optional()
				.describe(
					"Optional inclusive start date (ISO 8601; date-only expands to start of UTC day)",
				),
			end_date: z
				.string()
				.optional()
				.describe(
					"Optional inclusive end date (ISO 8601; date-only expands to end of UTC day)",
				),
		},
		async (args) => {
			try {
				const dateRange = normalizeAnalyticsDateRange(args);
				const [workoutsResult, muscleMap] = await Promise.all([
					client.getAllWorkouts({
						since: dateRange.since,
						until: dateRange.until,
					}),
					getCachedMuscleMap(),
				]);
				const personalRecords = computePersonalRecords(
					workoutsResult.workouts,
					muscleMap.map,
				);
				const digest = {
					tool: "get_personal_records",
					units: { weight: "lb", estimatedOneRepMax: "lb" },
					dateRange,
					fetch: workoutsResult.metadata,
					templateFetch: muscleMap.templateFetch,
					templateCount: muscleMap.templateCount,
					personalRecords,
					setRules: {
						warmups: "excluded",
						bestSetVolume: "weight_kg*reps converted to lb",
						unsupportedWeightMath:
							"sets without positive weight_kg and reps are counted as skipped",
					},
				};

				return analyticsResponse(
					`Personal records: ${Object.keys(personalRecords.exercises).length} exercises analyzed`,
					formatPersonalRecords(personalRecords),
					digest,
				);
			} catch (error) {
				return handleError(error);
			}
		},
	);

	// ============================================
	// ROUTINE FOLDERS
	// ============================================

	server.tool(
		"get_routine_folders",
		{
			page: z
				.number()
				.optional()
				.describe("Page number (Must be 1 or greater)")
				.default(1),
			page_size: z
				.number()
				.optional()
				.describe("Number of items per page (Max 10)")
				.default(10),
		},
		async ({ page, page_size }) => {
			try {
				// Validate pagination parameters
				validatePagination(page, page_size, PAGINATION_LIMITS.ROUTINE_FOLDERS);

				const folders = await client.getRoutineFolders({
					page,
					pageSize: page_size,
				});

				const folderDetails =
					folders.routine_folders
						?.map((folder: any, index: number) => {
							return `${index + 1}. ${folder.title}\n   ID: ${folder.id}\n   Index: ${folder.index}`;
						})
						.join("\n") || "No routine folders found";

				return {
					content: [
						{
							type: "text",
							text: `Retrieved ${folders.routine_folders?.length || 0} routine folders (page ${folders.page} of ${folders.page_count})`,
						},
						{
							type: "text",
							text: folderDetails,
						},
					],
				};
			} catch (error) {
				return handleError(error);
			}
		},
	);

	server.tool(
		"get_routine_folder",
		{
			folder_id: z.string().describe("The ID of the routine folder"),
		},
		async ({ folder_id }) => {
			try {
				const folder = await client.getRoutineFolder(folder_id);

				return {
					content: [
						{
							type: "text",
							text: `Folder: ${folder.title}\nID: ${folder.id}\nIndex: ${folder.index}`,
						},
						{
							type: "text",
							text: JSON.stringify(folder, null, 2),
						},
					],
				};
			} catch (error) {
				return handleError(error);
			}
		},
	);

	server.tool(
		"create_routine_folder",
		CreateRoutineFolderSchema.shape,
		async (args) => {
			try {
				const folder = await client.createRoutineFolder(
					transformRoutineFolderToAPI(args),
				);

				return {
					content: [
						{
							type: "text",
							text: `✓ Successfully created routine folder: ${folder.title}`,
						},
						{
							type: "text",
							text: `Folder ID: ${folder.id}\nIndex: ${folder.index}`,
						},
					],
				};
			} catch (error) {
				return handleError(error);
			}
		},
	);
}

function normalizeAnalyticsDateRange(args: {
	start_date?: string;
	end_date?: string;
}): {
	inputStartDate?: string;
	inputEndDate?: string;
	since?: string;
	until?: string;
	inclusive: true;
	dateOnlySemantics: string;
	timezoneSemantics: string;
} {
	if (args.start_date) {
		validateISO8601Date(args.start_date, "start_date");
	}
	if (args.end_date) {
		validateISO8601Date(args.end_date, "end_date");
	}

	const since = args.start_date
		? normalizeDateBoundary(args.start_date, "start")
		: undefined;
	const until = args.end_date
		? normalizeDateBoundary(args.end_date, "end")
		: undefined;

	if (since && until && new Date(until).getTime() < new Date(since).getTime()) {
		throw new ValidationError("end_date must be on or after start_date");
	}

	return {
		inputStartDate: args.start_date,
		inputEndDate: args.end_date,
		since,
		until,
		inclusive: true,
		dateOnlySemantics:
			"start_date uses 00:00:00.000Z; end_date uses 23:59:59.999Z",
		timezoneSemantics:
			"date-only and timezone-less datetimes are treated as UTC",
	};
}

function normalizeDateBoundary(
	value: string,
	boundary: "start" | "end",
): string {
	if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		return boundary === "start"
			? `${value}T00:00:00.000Z`
			: `${value}T23:59:59.999Z`;
	}

	if (!/(Z|[+-]\d{2}:\d{2})$/.test(value)) {
		return new Date(`${value}Z`).toISOString();
	}

	return new Date(value).toISOString();
}

function analyticsResponse(
	summary: string,
	humanReadable: string,
	digest: Record<string, unknown>,
) {
	return {
		content: [
			{
				type: "text" as const,
				text: summary,
			},
			{
				type: "text" as const,
				text: humanReadable,
			},
			{
				type: "text" as const,
				text: JSON.stringify(digest, null, 2),
			},
		],
	};
}

function formatTrainingSummary(
	consistency: ConsistencySummary,
	tonnage: TonnageSummary,
): string {
	return [
		`Sessions: ${consistency.totalSessions}`,
		`Date range: ${formatNullableDate(consistency.firstDate)} to ${formatNullableDate(consistency.lastDate)}`,
		`Average sessions/week: ${consistency.avgSessionsPerWeek}`,
		`Average gap: ${consistency.avgGapDays} days`,
		`Longest layoff: ${consistency.longestLayoffDays} days`,
		`Longest weekly streak: ${consistency.longestStreakWeeks} weeks`,
		`Average duration: ${consistency.avgDurationMinutes} minutes`,
		`Total tonnage: ${tonnage.totalTonnageLb} lb`,
		"",
		"Sessions by bucket:",
		formatNumberRecord(consistency.sessionsPerBucket, "sessions"),
		"",
		"Tonnage by bucket:",
		formatNumberRecord(tonnage.tonnagePerBucket, "lb"),
	].join("\n");
}

function formatMuscleVolume(
	totalSetsByMuscle: MuscleVolumeSummary["totalSetsByMuscle"],
	setsByBucket: MuscleVolumeSummary["setsByBucket"],
): string {
	const totalLines = Object.entries(totalSetsByMuscle)
		.sort(([, left], [, right]) => right - left)
		.map(([muscle, sets]) => `${muscle}: ${sets} sets`);

	const bucketLines = Object.entries(setsByBucket).map(([bucket, muscles]) => {
		const muscleText = Object.entries(muscles)
			.sort(([, left], [, right]) => right - left)
			.map(([muscle, sets]) => `${muscle} ${sets}`)
			.join(", ");
		return `${bucket}: ${muscleText}`;
	});

	return [
		"Total sets by muscle:",
		totalLines.length > 0 ? totalLines.join("\n") : "No sets found",
		"",
		"Sets by bucket:",
		bucketLines.length > 0 ? bucketLines.join("\n") : "No bucketed sets found",
	].join("\n");
}

function formatProgression(progression: ProgressionSummary): string {
	return [
		`Best estimated 1RM: ${progression.bestE1RMLb} lb`,
		`Best set volume: ${progression.bestSetVolumeLb} lb`,
		`Skipped unsupported sets: ${progression.skippedSets}`,
		"",
		"Best estimated 1RM by bucket:",
		formatSetRecord(progression.bestE1RMByBucket, "e1RMLb"),
		"",
		"Top set volume by bucket:",
		formatSetRecord(progression.topSetByBucket, "setVolumeLb"),
	].join("\n");
}

function formatPersonalRecords(
	personalRecords: PersonalRecordsSummary,
): string {
	const lines = Object.values(personalRecords.exercises)
		.sort((left, right) => {
			const leftValue = numericRecordValue(left.bestE1RMLb, "e1RMLb");
			const rightValue = numericRecordValue(right.bestE1RMLb, "e1RMLb");
			return rightValue - leftValue;
		})
		.slice(0, 20)
		.map((record) => {
			const e1rm = numericRecordValue(record.bestE1RMLb, "e1RMLb");
			const heaviest = numericRecordValue(record.heaviestSetLb, "weightLb");
			return `${record.title} (${record.primaryMuscle}): best e1RM ${e1rm} lb, heaviest ${heaviest} lb`;
		});

	return [
		"Top exercise records:",
		lines.length > 0 ? lines.join("\n") : "No weighted working sets found",
		`Skipped unsupported sets: ${personalRecords.skippedSets}`,
	].join("\n");
}

function formatNumberRecord(
	record: Record<string, number>,
	unit: string,
): string {
	const entries = Object.entries(record);
	if (entries.length === 0) return "None";
	return entries.map(([key, value]) => `${key}: ${value} ${unit}`).join("\n");
}

function formatSetRecord(
	record: Record<string, Record<string, unknown>>,
	metricKey: string,
): string {
	const entries = Object.entries(record);
	if (entries.length === 0) return "None";

	return entries
		.map(([bucket, set]) => {
			const metric = numericRecordValue(set, metricKey);
			const weight = numericRecordValue(set, "weightLb");
			const reps = set.reps ?? "n/a";
			return `${bucket}: ${metric} lb (${weight} lb x ${reps})`;
		})
		.join("\n");
}

function numericRecordValue(
	record: Record<string, unknown> | null,
	key: string,
): number {
	if (!record || typeof record[key] !== "number") return 0;
	return record[key];
}

function formatNullableDate(dateIso: string | null): string {
	return dateIso ? dateIso.slice(0, 10) : "n/a";
}
