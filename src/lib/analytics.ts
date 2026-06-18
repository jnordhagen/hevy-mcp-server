export const KG_TO_LB = 2.2046226218;

export type GroupBy = "week" | "month";

export interface TemplateMuscleInfo {
	primary: string;
	secondary: string[];
}

export interface FlattenedSet {
	workout: any;
	exercise: any;
	set: any;
	dateIso: string;
}

export interface ConsistencySummary {
	totalSessions: number;
	firstDate: string | null;
	lastDate: string | null;
	sessionsPerBucket: Record<string, number>;
	avgSessionsPerWeek: number;
	avgGapDays: number;
	longestLayoffDays: number;
	longestStreakWeeks: number;
	avgDurationMinutes: number;
}

export interface TonnageSummary {
	units: "lb";
	totalTonnageLb: number;
	tonnagePerBucket: Record<string, number>;
	skippedSets: number;
}

export interface MuscleVolumeSummary {
	totalSetsByMuscle: Record<string, number>;
	setsByBucket: Record<string, Record<string, number>>;
	unknownTemplateIds: string[];
	options: {
		groupBy: GroupBy;
		includeWarmups: boolean;
		countSecondary: boolean;
		metric: "sets";
	};
}

export interface ProgressionSummary {
	units: "lb";
	bestE1RMLb: number;
	bestSetVolumeLb: number;
	bestE1RMByBucket: Record<string, Record<string, unknown>>;
	topSetByBucket: Record<string, Record<string, unknown>>;
	skippedSets: number;
}

export interface PersonalRecordsSummary {
	units: "lb";
	exercises: Record<string, ExercisePRSummary>;
	exercisesByPrimaryMuscle: Record<string, string[]>;
	skippedSets: number;
	unknownTemplateIds: string[];
}

export interface ExercisePRSummary {
	exerciseTemplateId: string;
	title: string;
	primaryMuscle: string;
	bestE1RMLb: Record<string, unknown> | null;
	heaviestSetLb: Record<string, unknown> | null;
	bestSetVolumeLb: Record<string, unknown> | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

export function kgToLb(kg: number): number {
	return kg * KG_TO_LB;
}

export function lbToKg(lb: number): number {
	return lb / KG_TO_LB;
}

export function bucketKey(dateIso: string, groupBy: GroupBy): string {
	const date = new Date(dateIso);
	if (Number.isNaN(date.getTime())) return "unknown";

	if (groupBy === "month") {
		const month = String(date.getUTCMonth() + 1).padStart(2, "0");
		return `${date.getUTCFullYear()}-${month}`;
	}

	const week = getIsoWeek(date);
	return `${week.year}-W${String(week.week).padStart(2, "0")}`;
}

export function* flattenSets(workouts: any[]): Iterable<FlattenedSet> {
	for (const workout of workouts) {
		const dateIso = workout?.start_time;
		if (!dateIso || !Array.isArray(workout.exercises)) continue;

		for (const exercise of workout.exercises) {
			if (!Array.isArray(exercise?.sets)) continue;

			for (const set of exercise.sets) {
				yield { workout, exercise, set, dateIso };
			}
		}
	}
}

export function isWorkingSet(set: any): boolean {
	return getSetType(set) !== "warmup";
}

export function estimateOneRepMaxLb(weightKg: unknown, reps: unknown): number {
	if (typeof weightKg !== "number" || typeof reps !== "number") return 0;
	if (weightKg <= 0 || reps <= 0) return 0;
	return round1(kgToLb(weightKg * (1 + reps / 30)));
}

export function buildTemplateMuscleMap(
	templates: any[],
): Map<string, TemplateMuscleInfo> {
	const muscleMap = new Map<string, TemplateMuscleInfo>();

	for (const template of templates) {
		if (!template?.id) continue;
		muscleMap.set(String(template.id), {
			primary: template.primary_muscle_group || "unknown",
			secondary: Array.isArray(template.secondary_muscle_groups)
				? template.secondary_muscle_groups.filter(
						(muscle: unknown) => typeof muscle === "string",
					)
				: [],
		});
	}

	return muscleMap;
}

export function computeConsistency(
	workouts: any[],
	options: { groupBy: GroupBy },
): ConsistencySummary {
	const sortedDates = getSortedWorkoutDates(workouts);
	const sessionsPerBucket: Record<string, number> = {};
	const durations: number[] = [];

	for (const workout of workouts) {
		if (!workout?.start_time) continue;

		const key = bucketKey(workout.start_time, options.groupBy);
		sessionsPerBucket[key] = (sessionsPerBucket[key] || 0) + 1;

		const duration = durationMinutes(workout.start_time, workout.end_time);
		if (duration !== null) durations.push(duration);
	}

	if (sortedDates.length === 0) {
		return {
			totalSessions: 0,
			firstDate: null,
			lastDate: null,
			sessionsPerBucket,
			avgSessionsPerWeek: 0,
			avgGapDays: 0,
			longestLayoffDays: 0,
			longestStreakWeeks: 0,
			avgDurationMinutes: 0,
		};
	}

	const gaps = workoutGapsDays(sortedDates);
	const firstDate = sortedDates[0];
	const lastDate = sortedDates[sortedDates.length - 1];

	return {
		totalSessions: sortedDates.length,
		firstDate: firstDate.toISOString(),
		lastDate: lastDate.toISOString(),
		sessionsPerBucket: sortRecord(sessionsPerBucket),
		avgSessionsPerWeek: round1(
			sortedDates.length / countInclusiveWeeks(firstDate, lastDate),
		),
		avgGapDays: round1(average(gaps)),
		longestLayoffDays: gaps.length > 0 ? Math.max(...gaps) : 0,
		longestStreakWeeks: longestWeeklyStreak(sortedDates),
		avgDurationMinutes: round1(average(durations)),
	};
}

export function computeTonnage(
	workouts: any[],
	options: { groupBy: GroupBy },
): TonnageSummary {
	const tonnagePerBucket: Record<string, number> = {};
	let totalTonnageLb = 0;
	let skippedSets = 0;

	for (const { set, dateIso } of flattenSets(workouts)) {
		if (!isWorkingSet(set)) continue;
		const tonnage = setTonnageLb(set);
		if (tonnage === null) {
			skippedSets += 1;
			continue;
		}

		const bucket = bucketKey(dateIso, options.groupBy);
		totalTonnageLb += tonnage;
		tonnagePerBucket[bucket] = (tonnagePerBucket[bucket] || 0) + tonnage;
	}

	return {
		units: "lb",
		totalTonnageLb: round1(totalTonnageLb),
		tonnagePerBucket: roundRecord(sortRecord(tonnagePerBucket)),
		skippedSets,
	};
}

export function computeMuscleVolume(
	workouts: any[],
	muscleMap: Map<string, TemplateMuscleInfo>,
	options: {
		groupBy: GroupBy;
		includeWarmups?: boolean;
		countSecondary?: boolean;
	},
): MuscleVolumeSummary {
	const includeWarmups = options.includeWarmups ?? false;
	const countSecondary = options.countSecondary ?? false;
	const totalSetsByMuscle: Record<string, number> = {};
	const setsByBucket: Record<string, Record<string, number>> = {};
	const unknownTemplateIds = new Set<string>();

	for (const { exercise, set, dateIso } of flattenSets(workouts)) {
		if (!includeWarmups && !isWorkingSet(set)) continue;

		const templateId = String(exercise?.exercise_template_id || "unknown");
		const muscles = creditedMuscles(templateId, muscleMap, countSecondary);
		if (!muscleMap.has(templateId)) unknownTemplateIds.add(templateId);

		const bucket = bucketKey(dateIso, options.groupBy);
		setsByBucket[bucket] = setsByBucket[bucket] || {};

		for (const muscle of muscles) {
			totalSetsByMuscle[muscle] = (totalSetsByMuscle[muscle] || 0) + 1;
			setsByBucket[bucket][muscle] = (setsByBucket[bucket][muscle] || 0) + 1;
		}
	}

	return {
		totalSetsByMuscle: sortRecord(totalSetsByMuscle),
		setsByBucket: sortNestedRecord(setsByBucket),
		unknownTemplateIds: [...unknownTemplateIds].sort(),
		options: {
			groupBy: options.groupBy,
			includeWarmups,
			countSecondary,
			metric: "sets",
		},
	};
}

export function computeProgression(
	historyEntries: any[],
	options: { groupBy: GroupBy },
): ProgressionSummary {
	const bestE1RMByBucket: Record<string, Record<string, unknown>> = {};
	const topSetByBucket: Record<string, Record<string, unknown>> = {};
	let bestE1RMLb = 0;
	let bestSetVolumeLb = 0;
	let skippedSets = 0;

	for (const entry of historyEntries) {
		if (!isWorkingSet({ type: entry?.set_type ?? entry?.type })) continue;
		const e1rmLb = estimateOneRepMaxLb(entry?.weight_kg, entry?.reps);
		const volumeLb = setTonnageLb(entry);
		if (e1rmLb === 0 && volumeLb === null) {
			skippedSets += 1;
			continue;
		}
		if (e1rmLb === 0 || volumeLb === null) {
			skippedSets += 1;
		}

		const dateIso = entry?.workout_start_time || entry?.start_time;
		const bucket = dateIso ? bucketKey(dateIso, options.groupBy) : "unknown";
		const candidate = progressionSet(entry, e1rmLb, volumeLb ?? 0);

		if (e1rmLb > bestE1RMLb) bestE1RMLb = e1rmLb;
		if (volumeLb !== null && volumeLb > bestSetVolumeLb)
			bestSetVolumeLb = volumeLb;

		const existingBest = bestE1RMByBucket[bucket]?.e1RMLb;
		if (typeof existingBest !== "number" || e1rmLb > existingBest) {
			bestE1RMByBucket[bucket] = candidate;
		}

		const existingVolume = topSetByBucket[bucket]?.setVolumeLb;
		if (
			typeof existingVolume !== "number" ||
			(volumeLb ?? 0) > existingVolume
		) {
			topSetByBucket[bucket] = candidate;
		}
	}

	return {
		units: "lb",
		bestE1RMLb: round1(bestE1RMLb),
		bestSetVolumeLb: round1(bestSetVolumeLb),
		bestE1RMByBucket: sortObjectRecord(bestE1RMByBucket),
		topSetByBucket: sortObjectRecord(topSetByBucket),
		skippedSets,
	};
}

export function computePersonalRecords(
	workouts: any[],
	muscleMap: Map<string, TemplateMuscleInfo>,
): PersonalRecordsSummary {
	const exercises: Record<string, ExercisePRSummary> = {};
	const exercisesByPrimaryMuscle: Record<string, string[]> = {};
	const unknownTemplateIds = new Set<string>();
	let skippedSets = 0;

	for (const { workout, exercise, set } of flattenSets(workouts)) {
		if (!isWorkingSet(set)) continue;

		const templateId = String(exercise?.exercise_template_id || "unknown");
		const muscle = muscleMap.get(templateId)?.primary || "unknown";
		const e1RMLb = estimateOneRepMaxLb(set?.weight_kg, set?.reps);
		const weightLb =
			typeof set?.weight_kg === "number" && set.weight_kg > 0
				? round1(kgToLb(set.weight_kg))
				: 0;
		const volumeLb = setTonnageLb(set);
		if (weightLb === 0) {
			skippedSets += 1;
			continue;
		}
		if (e1RMLb === 0 || volumeLb === null) skippedSets += 1;

		if (!muscleMap.has(templateId)) unknownTemplateIds.add(templateId);

		exercises[templateId] = exercises[templateId] || {
			exerciseTemplateId: templateId,
			title: exercise?.title || templateId,
			primaryMuscle: muscle,
			bestE1RMLb: null,
			heaviestSetLb: null,
			bestSetVolumeLb: null,
		};

		if (!exercisesByPrimaryMuscle[muscle])
			exercisesByPrimaryMuscle[muscle] = [];
		if (!exercisesByPrimaryMuscle[muscle].includes(templateId)) {
			exercisesByPrimaryMuscle[muscle].push(templateId);
		}

		const recordSet = {
			workoutId: workout?.id,
			workoutTitle: workout?.title,
			date: workout?.start_time,
			weightLb,
			reps: set?.reps ?? null,
			setType: getSetType(set),
			e1RMLb,
			setVolumeLb: round1(volumeLb ?? 0),
		};

		const summary = exercises[templateId];
		const currentE1RM = summary.bestE1RMLb?.e1RMLb;
		if (typeof currentE1RM !== "number" || e1RMLb > currentE1RM) {
			summary.bestE1RMLb = recordSet;
		}

		const currentHeaviest = summary.heaviestSetLb?.weightLb;
		if (typeof currentHeaviest !== "number" || weightLb > currentHeaviest) {
			summary.heaviestSetLb = recordSet;
		}

		const currentVolume = summary.bestSetVolumeLb?.setVolumeLb;
		if (typeof currentVolume !== "number" || (volumeLb ?? 0) > currentVolume) {
			summary.bestSetVolumeLb = recordSet;
		}
	}

	for (const ids of Object.values(exercisesByPrimaryMuscle)) {
		ids.sort();
	}

	return {
		units: "lb",
		exercises: sortObjectRecord(exercises),
		exercisesByPrimaryMuscle: sortArrayRecord(exercisesByPrimaryMuscle),
		skippedSets,
		unknownTemplateIds: [...unknownTemplateIds].sort(),
	};
}

function getIsoWeek(date: Date): { year: number; week: number } {
	const utcDate = new Date(
		Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
	);
	const day = utcDate.getUTCDay() || 7;
	utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day);
	const year = utcDate.getUTCFullYear();
	const yearStart = new Date(Date.UTC(year, 0, 1));
	const week = Math.ceil(
		((utcDate.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7,
	);
	return { year, week };
}

function isoWeekStartMs(date: Date): number {
	const utcDate = new Date(
		Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
	);
	const day = utcDate.getUTCDay() || 7;
	utcDate.setUTCDate(utcDate.getUTCDate() - day + 1);
	return utcDate.getTime();
}

function getSortedWorkoutDates(workouts: any[]): Date[] {
	return workouts
		.map((workout) => new Date(workout?.start_time))
		.filter((date) => !Number.isNaN(date.getTime()))
		.sort((left, right) => left.getTime() - right.getTime());
}

function countInclusiveWeeks(firstDate: Date, lastDate: Date): number {
	return Math.max(
		1,
		Math.round(
			(isoWeekStartMs(lastDate) - isoWeekStartMs(firstDate)) / WEEK_MS,
		) + 1,
	);
}

function workoutGapsDays(sortedDates: Date[]): number[] {
	const gaps: number[] = [];
	for (let index = 1; index < sortedDates.length; index += 1) {
		const previousDay = Date.UTC(
			sortedDates[index - 1].getUTCFullYear(),
			sortedDates[index - 1].getUTCMonth(),
			sortedDates[index - 1].getUTCDate(),
		);
		const currentDay = Date.UTC(
			sortedDates[index].getUTCFullYear(),
			sortedDates[index].getUTCMonth(),
			sortedDates[index].getUTCDate(),
		);
		gaps.push(Math.round((currentDay - previousDay) / DAY_MS));
	}
	return gaps;
}

function longestWeeklyStreak(sortedDates: Date[]): number {
	const weeks = [...new Set(sortedDates.map(isoWeekStartMs))].sort(
		(left, right) => left - right,
	);
	if (weeks.length === 0) return 0;

	let longest = 1;
	let current = 1;
	for (let index = 1; index < weeks.length; index += 1) {
		if (weeks[index] - weeks[index - 1] === WEEK_MS) {
			current += 1;
		} else {
			current = 1;
		}
		longest = Math.max(longest, current);
	}
	return longest;
}

function durationMinutes(startIso: string, endIso: string): number | null {
	const start = new Date(startIso).getTime();
	const end = new Date(endIso).getTime();
	if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return null;
	return (end - start) / (60 * 1000);
}

function average(values: number[]): number {
	if (values.length === 0) return 0;
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function getSetType(set: any): string {
	return set?.set_type || set?.type || "normal";
}

function setTonnageLb(set: any): number | null {
	if (typeof set?.weight_kg !== "number" || typeof set?.reps !== "number")
		return null;
	if (set.weight_kg <= 0 || set.reps <= 0) return null;
	return kgToLb(set.weight_kg * set.reps);
}

function creditedMuscles(
	templateId: string,
	muscleMap: Map<string, TemplateMuscleInfo>,
	countSecondary: boolean,
): string[] {
	const info = muscleMap.get(templateId);
	if (!info) return ["unknown"];
	if (!countSecondary) return [info.primary];
	return [...new Set([info.primary, ...info.secondary])];
}

function progressionSet(
	entry: any,
	e1RMLb: number,
	setVolumeLb: number,
): Record<string, unknown> {
	return {
		workoutId: entry?.workout_id,
		workoutTitle: entry?.workout_title,
		date: entry?.workout_start_time || entry?.start_time,
		weightLb:
			typeof entry?.weight_kg === "number"
				? round1(kgToLb(entry.weight_kg))
				: 0,
		reps: entry?.reps ?? null,
		setType: entry?.set_type ?? entry?.type ?? "normal",
		e1RMLb,
		setVolumeLb: round1(setVolumeLb),
	};
}

function round1(value: number): number {
	return Math.round(value * 10) / 10;
}

function sortRecord(record: Record<string, number>): Record<string, number> {
	return Object.fromEntries(
		Object.entries(record).sort(([left], [right]) => left.localeCompare(right)),
	);
}

function roundRecord(record: Record<string, number>): Record<string, number> {
	return Object.fromEntries(
		Object.entries(record).map(([key, value]) => [key, round1(value)]),
	);
}

function sortNestedRecord(
	record: Record<string, Record<string, number>>,
): Record<string, Record<string, number>> {
	return Object.fromEntries(
		Object.entries(record)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, value]) => [key, sortRecord(value)]),
	);
}

function sortObjectRecord<T>(record: Record<string, T>): Record<string, T> {
	return Object.fromEntries(
		Object.entries(record).sort(([left], [right]) => left.localeCompare(right)),
	);
}

function sortArrayRecord(
	record: Record<string, string[]>,
): Record<string, string[]> {
	return Object.fromEntries(
		Object.entries(record)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, value]) => [key, [...value].sort()]),
	);
}
