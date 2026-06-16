export const analyticsTemplates = [
	{
		id: "bench-template",
		title: "Bench Press",
		type: "weight_reps",
		primary_muscle_group: "chest",
		secondary_muscle_groups: ["triceps", "shoulders"],
		is_custom: false,
	},
	{
		id: "row-template",
		title: "Barbell Row",
		type: "weight_reps",
		primary_muscle_group: "upper_back",
		secondary_muscle_groups: ["biceps", "lats"],
		is_custom: false,
	},
	{
		id: "squat-template",
		title: "Back Squat",
		type: "weight_reps",
		primary_muscle_group: "quadriceps",
		secondary_muscle_groups: ["glutes", "hamstrings"],
		is_custom: false,
	},
	{
		id: "plank-template",
		title: "Plank",
		type: "duration",
		primary_muscle_group: "abdominals",
		secondary_muscle_groups: [],
		is_custom: false,
	},
];

export const analyticsWorkouts = [
	{
		id: "workout-jan-08",
		title: "Push Day",
		start_time: "2026-01-08T10:00:00Z",
		end_time: "2026-01-08T11:00:00Z",
		exercises: [
			{
				title: "Bench Press",
				exercise_template_id: "bench-template",
				sets: [
					{ type: "warmup", weight_kg: 60, reps: 8 },
					{ type: "normal", weight_kg: 100, reps: 10 },
					{ type: "failure", weight_kg: 100, reps: 8 },
				],
			},
			{
				title: "Plank",
				exercise_template_id: "plank-template",
				sets: [{ type: "normal", duration_seconds: 60 }],
			},
		],
	},
	{
		id: "workout-jan-01",
		title: "Pull Day",
		start_time: "2026-01-01T09:00:00Z",
		end_time: "2026-01-01T10:15:00Z",
		exercises: [
			{
				title: "Barbell Row",
				exercise_template_id: "row-template",
				sets: [
					{ type: "normal", weight_kg: 80, reps: 8 },
					{ type: "normal", weight_kg: 70, reps: 10 },
				],
			},
		],
	},
	{
		id: "workout-dec-29",
		title: "Leg Day",
		start_time: "2025-12-29T08:00:00Z",
		end_time: "2025-12-29T09:30:00Z",
		exercises: [
			{
				title: "Back Squat",
				exercise_template_id: "squat-template",
				sets: [
					{ type: "normal", weight_kg: 120, reps: 5 },
					{ type: "dropset", weight_kg: 100, reps: 8 },
				],
			},
		],
	},
	{
		id: "workout-dec-20",
		title: "Accessory Day",
		start_time: "2025-12-20T12:00:00Z",
		end_time: "2025-12-20T12:45:00Z",
		exercises: [
			{
				title: "Mystery Lift",
				exercise_template_id: "missing-template",
				sets: [{ type: "normal", weight_kg: 10, reps: 10 }],
			},
		],
	},
];

export const analyticsWorkoutPages = [
	{
		page: 1,
		page_count: 2,
		workouts: analyticsWorkouts.slice(0, 2),
	},
	{
		page: 2,
		page_count: 2,
		workouts: analyticsWorkouts.slice(2),
	},
];

export const analyticsTemplatePages = [
	{
		page: 1,
		page_count: 1,
		exercise_templates: analyticsTemplates,
	},
];

export const analyticsProgressionHistory = {
	exercise_history: [
		{
			workout_id: "workout-jan-08",
			workout_title: "Push Day",
			workout_start_time: "2026-01-08T10:00:00Z",
			workout_end_time: "2026-01-08T11:00:00Z",
			exercise_template_id: "bench-template",
			weight_kg: 100,
			reps: 10,
			rpe: 8,
			set_type: "normal",
		},
		{
			workout_id: "workout-jan-01",
			workout_title: "Technique Day",
			workout_start_time: "2026-01-01T09:00:00Z",
			workout_end_time: "2026-01-01T10:15:00Z",
			exercise_template_id: "bench-template",
			weight_kg: 90,
			reps: 8,
			rpe: 7,
			set_type: "normal",
		},
		{
			workout_id: "workout-dec-29",
			workout_title: "Warmup Only",
			workout_start_time: "2025-12-29T08:00:00Z",
			workout_end_time: "2025-12-29T09:30:00Z",
			exercise_template_id: "bench-template",
			weight_kg: 60,
			reps: 8,
			rpe: null,
			set_type: "warmup",
		},
	],
};
