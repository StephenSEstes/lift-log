export type ExercisePlan = {
  userEmail: string;
  dayKey: string;
  sortOrder: number;
  exercise_id: string;
  exercise_name: string;
  plannedSets: number;
  defaultRestSeconds?: number;
  target_rep_min: number;
  target_rep_max: number;
  youtube_url: string;
};

export type ExerciseCatalogRow = {
  exerciseKey: string;
  exerciseName: string;
  videoUrl: string;
  defaultRequiresWeight?: boolean;
  defaultRestSeconds?: number;
  isActive?: boolean;
};

export type LoggedSet = {
  session_id: string;
  set_id?: string;
  set_timestamp: string;
  exercise_id: string;
  exercise_name: string;
  exercise_order: number;
  set_number: number;
  weight: string;
  reps: string;
  is_skipped: string;
  skip_reason: string;
  rpe?: string | number;
  rest_seconds: string;
  rest_target_seconds: string;
  notes: string;
  is_deleted?: string;
};

export type WorkoutSessionState = {
  sessionId: string;
  planDay: string;
  startTimestamp: string;
  endTimestamp?: string;
  timezone: string;
  exercisesPlanned: number;
  exercisesCompleted: number;
  totalSetsLogged: number;
  defaultRestSeconds: number;
  plan: ExercisePlan[];
  currentExerciseIndex: number;
  currentSetIndex: number;
  sets: LoggedSet[];
  exerciseNotes: Record<string, string>;
  notes: string;
};

const weekdays = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export const getTodayPlanDay = () => weekdays[new Date().getDay()];

export const createSessionId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export const createNewSession = (planDay: string): WorkoutSessionState => ({
  sessionId: createSessionId(),
  planDay,
  startTimestamp: new Date().toISOString(),
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  exercisesPlanned: 0,
  exercisesCompleted: 0,
  totalSetsLogged: 0,
  defaultRestSeconds: 90,
  plan: [],
  currentExerciseIndex: 0,
  currentSetIndex: 1,
  sets: [],
  exerciseNotes: {},
  notes: "",
});
