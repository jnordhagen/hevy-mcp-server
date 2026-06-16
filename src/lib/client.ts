import { PAGINATION_LIMITS } from "./transforms.js";

export const FETCH_LIMITS = {
	WORKOUTS_MAX_PAGES: 50,
	EXERCISE_TEMPLATES_MAX_PAGES: 50,
} as const;

export interface PaginatedFetchMetadata {
	pagesFetched: number;
	pageCount: number;
	maxPages: number;
	truncated: boolean;
	earlyStopped: boolean;
	totalItemsBeforeFilter: number;
	totalItemsAfterFilter: number;
}

export interface AllWorkoutsResult {
	workouts: any[];
	metadata: PaginatedFetchMetadata & {
		since?: string;
		until?: string;
		newestFirstOptimizationUsed: boolean;
	};
}

export interface AllExerciseTemplatesResult {
	exerciseTemplates: any[];
	metadata: PaginatedFetchMetadata;
}

/**
 * Configuration options for the Hevy API client
 */
export interface HevyClientConfig {
	/**
	 * API key for authenticating with the Hevy API
	 */
	apiKey: string;

	/**
	 * Base URL for the Hevy API (defaults to the production API)
	 */
	baseUrl?: string;
}

/**
 * Error class for Hevy API errors
 */
export class HevyApiError extends Error {
	status: number;
	data?: any;

	constructor(message: string, status: number, data?: any) {
		super(message);
		this.name = "HevyApiError";
		this.status = status;
		this.data = data;
	}
}

/**
 * Client for interacting with the Hevy API
 */
export class HevyClient {
	private apiKey: string;
	private baseUrl: string;

	/**
	 * Create a new Hevy API client
	 */
	constructor(config: HevyClientConfig) {
		this.apiKey = config.apiKey;
		this.baseUrl = config.baseUrl || "https://api.hevyapp.com";
	}

	/**
	 * Execute a request to the Hevy API
	 */
	private async request<T>(
		path: string,
		options: {
			method: "GET" | "POST" | "PUT" | "DELETE";
			body?: unknown;
			queryParams?: Record<string, string | number | boolean | undefined>;
		},
	): Promise<T> {
		const { method, body, queryParams } = options;

		// Construct query string if query parameters are provided
		const queryString = queryParams
			? "?" +
				new URLSearchParams(
					Object.entries(queryParams)
						.filter(([_, value]) => value !== undefined)
						.map(([key, value]) => [key, String(value)]),
				).toString()
			: "";

		// Construct the full URL
		const url = `${this.baseUrl}${path}${queryString}`;

		// Set up request headers
		const headers = new Headers({
			"api-key": this.apiKey,
			"Content-Type": "application/json",
		});

		// Make the request
		const response = await fetch(url, {
			method,
			headers,
			body: body ? JSON.stringify(body) : undefined,
		});

		// Parse the response
		const data = response.headers
			.get("Content-Type")
			?.includes("application/json")
			? await response.json()
			: await response.text();

		// Handle error responses
		if (!response.ok) {
			throw new HevyApiError(
				`Hevy API request failed: ${response.status} ${response.statusText}`,
				response.status,
				data,
			);
		}

		return data as T;
	}

	/**
	 * Helper method for GET requests
	 */
	private async get<T>(
		path: string,
		queryParams?: Record<string, string | number | boolean | undefined>,
	): Promise<T> {
		return this.request<T>(path, { method: "GET", queryParams });
	}

	/**
	 * Helper method for POST requests
	 */
	private async post<T>(
		path: string,
		body?: unknown,
		queryParams?: Record<string, string | number | boolean | undefined>,
	): Promise<T> {
		return this.request<T>(path, { method: "POST", body, queryParams });
	}

	/**
	 * Helper method for PUT requests
	 */
	private async put<T>(
		path: string,
		body?: unknown,
		queryParams?: Record<string, string | number | boolean | undefined>,
	): Promise<T> {
		return this.request<T>(path, { method: "PUT", body, queryParams });
	}

	// ============================================
	// WORKOUTS
	// ============================================

	/**
	 * Get a paginated list of workouts
	 */
	async getWorkouts(options?: {
		page?: number;
		pageSize?: number;
	}): Promise<any> {
		return this.get<any>(
			"/v1/workouts",
			options as Record<string, string | number | boolean | undefined>,
		);
	}

	/**
	 * Get workouts across pages with explicit pagination metadata.
	 *
	 * Results are filtered by workout start_time after each page is fetched. If the
	 * safety cap is reached, metadata.truncated is true so callers can surface that
	 * analytics are partial rather than silently treating them as complete.
	 */
	async getAllWorkouts(options?: {
		since?: string;
		until?: string;
		maxPages?: number;
	}): Promise<AllWorkoutsResult> {
		const maxPages = options?.maxPages ?? FETCH_LIMITS.WORKOUTS_MAX_PAGES;
		const sinceTime = options?.since
			? new Date(options.since).getTime()
			: undefined;
		const untilTime = options?.until
			? new Date(options.until).getTime()
			: undefined;
		const workouts: any[] = [];
		let page = 1;
		let pageCount = 0;
		let pagesFetched = 0;
		let totalItemsBeforeFilter = 0;
		let earlyStopped = false;
		let newestFirstOptimizationUsed = false;
		let newestFirstObserved = true;
		let previousPageOldestTime: number | undefined;

		while (page <= maxPages) {
			const response = await this.getWorkouts({
				page,
				pageSize: PAGINATION_LIMITS.WORKOUTS,
			});
			pagesFetched += 1;
			pageCount = Number(response.page_count || pageCount || page);

			const pageWorkouts = Array.isArray(response.workouts)
				? response.workouts
				: [];
			totalItemsBeforeFilter += pageWorkouts.length;

			const validTimes = pageWorkouts
				.map((workout: any) => new Date(workout.start_time).getTime())
				.filter((time: number) => !Number.isNaN(time));

			if (validTimes.length > 0) {
				for (let index = 1; index < validTimes.length; index += 1) {
					if (validTimes[index - 1] < validTimes[index]) {
						newestFirstObserved = false;
						break;
					}
				}

				const currentNewestTime = Math.max(...validTimes);
				const currentOldestTime = Math.min(...validTimes);
				if (
					previousPageOldestTime !== undefined &&
					previousPageOldestTime < currentNewestTime
				) {
					newestFirstObserved = false;
				}
				previousPageOldestTime = currentOldestTime;
			} else {
				newestFirstObserved = false;
			}

			for (const workout of pageWorkouts) {
				const startTime = new Date(workout.start_time).getTime();
				if (Number.isNaN(startTime)) continue;
				if (sinceTime !== undefined && startTime < sinceTime) continue;
				if (untilTime !== undefined && startTime > untilTime) continue;
				workouts.push(workout);
			}

			if (
				sinceTime !== undefined &&
				newestFirstObserved &&
				validTimes.length > 0 &&
				Math.min(...validTimes) < sinceTime
			) {
				earlyStopped = true;
				newestFirstOptimizationUsed = true;
				break;
			}

			if (page >= pageCount) break;
			page += 1;
		}

		const truncated = !earlyStopped && pageCount > pagesFetched;

		return {
			workouts,
			metadata: {
				pagesFetched,
				pageCount,
				maxPages,
				truncated,
				earlyStopped,
				totalItemsBeforeFilter,
				totalItemsAfterFilter: workouts.length,
				since: options?.since,
				until: options?.until,
				newestFirstOptimizationUsed,
			},
		};
	}

	/**
	 * Get a single workout by ID
	 */
	async getWorkout(workoutId: string): Promise<any> {
		return this.get<any>(`/v1/workouts/${workoutId}`);
	}

	/**
	 * Create a new workout
	 */
	async createWorkout(workout: any): Promise<any> {
		return this.post<any>("/v1/workouts", workout);
	}

	/**
	 * Update an existing workout
	 */
	async updateWorkout(workoutId: string, workout: any): Promise<any> {
		return this.put<any>(`/v1/workouts/${workoutId}`, workout);
	}

	/**
	 * Get the total count of workouts
	 */
	async getWorkoutsCount(): Promise<{ workout_count: number }> {
		return this.get<{ workout_count: number }>("/v1/workouts/count");
	}

	/**
	 * Get workout events (updates or deletes) since a given date
	 */
	async getWorkoutEvents(options?: {
		page?: number;
		pageSize?: number;
		since?: string;
	}): Promise<any> {
		return this.get<any>(
			"/v1/workouts/events",
			options as Record<string, string | number | boolean | undefined>,
		);
	}

	// ============================================
	// ROUTINES
	// ============================================

	/**
	 * Get a paginated list of routines
	 */
	async getRoutines(options?: {
		page?: number;
		pageSize?: number;
	}): Promise<any> {
		return this.get<any>(
			"/v1/routines",
			options as Record<string, string | number | boolean | undefined>,
		);
	}

	/**
	 * Get a single routine by ID
	 */
	async getRoutine(routineId: string): Promise<{ routine: any }> {
		return this.get<{ routine: any }>(`/v1/routines/${routineId}`);
	}

	/**
	 * Create a new routine
	 */
	async createRoutine(routine: any): Promise<any> {
		return this.post<any>("/v1/routines", routine);
	}

	/**
	 * Update an existing routine
	 */
	async updateRoutine(routineId: string, routine: any): Promise<any> {
		return this.put<any>(`/v1/routines/${routineId}`, routine);
	}

	// ============================================
	// EXERCISE TEMPLATES
	// ============================================

	/**
	 * Get a paginated list of exercise templates
	 */
	async getExerciseTemplates(options?: {
		page?: number;
		pageSize?: number;
	}): Promise<any> {
		return this.get<any>(
			"/v1/exercise_templates",
			options as Record<string, string | number | boolean | undefined>,
		);
	}

	/**
	 * Get all exercise templates across pages with explicit pagination metadata.
	 */
	async getAllExerciseTemplates(options?: {
		maxPages?: number;
	}): Promise<AllExerciseTemplatesResult> {
		const maxPages =
			options?.maxPages ?? FETCH_LIMITS.EXERCISE_TEMPLATES_MAX_PAGES;
		const exerciseTemplates: any[] = [];
		let page = 1;
		let pageCount = 0;
		let pagesFetched = 0;

		while (page <= maxPages) {
			const response = await this.getExerciseTemplates({
				page,
				pageSize: PAGINATION_LIMITS.EXERCISE_TEMPLATES,
			});
			pagesFetched += 1;
			pageCount = Number(response.page_count || pageCount || page);

			const pageTemplates = Array.isArray(response.exercise_templates)
				? response.exercise_templates
				: [];
			exerciseTemplates.push(...pageTemplates);

			if (page >= pageCount) break;
			page += 1;
		}

		return {
			exerciseTemplates,
			metadata: {
				pagesFetched,
				pageCount,
				maxPages,
				truncated: pageCount > pagesFetched,
				earlyStopped: false,
				totalItemsBeforeFilter: exerciseTemplates.length,
				totalItemsAfterFilter: exerciseTemplates.length,
			},
		};
	}

	/**
	 * Get a single exercise template by ID
	 */
	async getExerciseTemplate(exerciseTemplateId: string): Promise<any> {
		return this.get<any>(`/v1/exercise_templates/${exerciseTemplateId}`);
	}

	/**
	 * Get exercise history for a specific exercise template
	 */
	async getExerciseHistory(
		exerciseTemplateId: string,
		params?: { start_date?: string; end_date?: string },
	): Promise<any> {
		return this.get<any>(
			`/v1/exercise_history/${exerciseTemplateId}`,
			params as Record<string, string | number | boolean | undefined>,
		);
	}

	// ============================================
	// ROUTINE FOLDERS
	// ============================================

	/**
	 * Get a paginated list of routine folders
	 */
	async getRoutineFolders(options?: {
		page?: number;
		pageSize?: number;
	}): Promise<any> {
		return this.get<any>(
			"/v1/routine_folders",
			options as Record<string, string | number | boolean | undefined>,
		);
	}

	/**
	 * Get a single routine folder by ID
	 */
	async getRoutineFolder(folderId: string): Promise<any> {
		return this.get<any>(`/v1/routine_folders/${folderId}`);
	}

	/**
	 * Create a new routine folder
	 */
	async createRoutineFolder(folder: any): Promise<any> {
		return this.post<any>("/v1/routine_folders", folder);
	}

	/**
	 * Create a new custom exercise template
	 */
	async createExerciseTemplate(exercise: any): Promise<any> {
		return this.post<any>("/v1/exercise_templates", exercise);
	}
}
