import { describe, expect, it } from "vitest";
import {
	bucketKey,
	buildTemplateMuscleMap,
	computeConsistency,
	computeMuscleVolume,
	computePersonalRecords,
	computeProgression,
	computeTonnage,
	estimateOneRepMaxLb,
	flattenSets,
	kgToLb,
} from "../../src/lib/analytics.js";
import {
	analyticsProgressionHistory,
	analyticsTemplates,
	analyticsWorkouts,
} from "../fixtures/analytics.js";

describe("analytics", () => {
	it("converts kg to lb", () => {
		expect(kgToLb(10)).toBeCloseTo(22.0462, 4);
	});

	it("builds ISO week and UTC month bucket keys", () => {
		expect(bucketKey("2025-12-29T08:00:00Z", "week")).toBe("2026-W01");
		expect(bucketKey("2026-01-08T10:00:00Z", "week")).toBe("2026-W02");
		expect(bucketKey("2026-01-08T10:00:00Z", "month")).toBe("2026-01");
	});

	it("estimates one-rep max in pounds using Epley", () => {
		expect(estimateOneRepMaxLb(100, 10)).toBe(293.9);
		expect(estimateOneRepMaxLb(null, 10)).toBe(0);
		expect(estimateOneRepMaxLb(100, 0)).toBe(0);
	});

	it("flattens workout sets", () => {
		expect([...flattenSets(analyticsWorkouts)]).toHaveLength(9);
	});

	it("builds a template muscle map", () => {
		const muscleMap = buildTemplateMuscleMap(analyticsTemplates);

		expect(muscleMap.get("bench-template")).toEqual({
			primary: "chest",
			secondary: ["triceps", "shoulders"],
		});
	});

	it("computes consistency with ISO week streaks and layoff gaps", () => {
		const summary = computeConsistency(analyticsWorkouts, { groupBy: "week" });

		expect(summary.totalSessions).toBe(4);
		expect(summary.sessionsPerBucket).toEqual({
			"2025-W51": 1,
			"2026-W01": 2,
			"2026-W02": 1,
		});
		expect(summary.avgSessionsPerWeek).toBe(1);
		expect(summary.avgGapDays).toBe(6.3);
		expect(summary.longestLayoffDays).toBe(9);
		expect(summary.longestStreakWeeks).toBe(2);
		expect(summary.avgDurationMinutes).toBe(67.5);
	});

	it("computes working-set tonnage in pounds", () => {
		const tonnage = computeTonnage(analyticsWorkouts, { groupBy: "month" });

		expect(tonnage.totalTonnageLb).toBe(10229.4);
		expect(tonnage.tonnagePerBucket["2025-12"]).toBe(3306.9);
		expect(tonnage.tonnagePerBucket["2026-01"]).toBe(6922.5);
		expect(tonnage.skippedSets).toBe(1);
	});

	it("computes primary-only muscle set volume by default", () => {
		const muscleMap = buildTemplateMuscleMap(analyticsTemplates);
		const volume = computeMuscleVolume(analyticsWorkouts, muscleMap, {
			groupBy: "week",
		});

		expect(volume.totalSetsByMuscle).toEqual({
			abdominals: 1,
			chest: 2,
			quadriceps: 2,
			unknown: 1,
			upper_back: 2,
		});
		expect(volume.unknownTemplateIds).toEqual(["missing-template"]);
		expect(volume.options).toEqual({
			groupBy: "week",
			includeWarmups: false,
			countSecondary: false,
			metric: "sets",
		});
	});

	it("can include warmups and credit secondary muscles", () => {
		const muscleMap = buildTemplateMuscleMap(analyticsTemplates);
		const volume = computeMuscleVolume(analyticsWorkouts, muscleMap, {
			groupBy: "month",
			includeWarmups: true,
			countSecondary: true,
		});

		expect(volume.totalSetsByMuscle.chest).toBe(3);
		expect(volume.totalSetsByMuscle.triceps).toBe(3);
		expect(volume.totalSetsByMuscle.shoulders).toBe(3);
		expect(volume.totalSetsByMuscle.biceps).toBe(2);
		expect(volume.totalSetsByMuscle.glutes).toBe(2);
	});

	it("computes exercise progression from flat history", () => {
		const progression = computeProgression(
			analyticsProgressionHistory.exercise_history,
			{ groupBy: "week" },
		);

		expect(progression.bestE1RMLb).toBe(293.9);
		expect(progression.bestSetVolumeLb).toBe(2204.6);
		expect(progression.bestE1RMByBucket["2026-W02"].e1RMLb).toBe(293.9);
		expect(progression.bestE1RMByBucket["2026-W01"].e1RMLb).toBe(251.3);
		expect(progression.skippedSets).toBe(0);
	});

	it("computes personal records grouped by primary muscle", () => {
		const muscleMap = buildTemplateMuscleMap(analyticsTemplates);
		const records = computePersonalRecords(analyticsWorkouts, muscleMap);

		expect(records.exercises["bench-template"].bestE1RMLb?.e1RMLb).toBe(293.9);
		expect(records.exercises["squat-template"].heaviestSetLb?.weightLb).toBe(
			264.6,
		);
		expect(records.exercisesByPrimaryMuscle.chest).toEqual(["bench-template"]);
		expect(records.unknownTemplateIds).toEqual(["missing-template"]);
		expect(records.skippedSets).toBe(1);
	});
});
