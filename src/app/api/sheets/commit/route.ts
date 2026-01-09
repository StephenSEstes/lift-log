import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let errorId = "unknown";
  try {
    errorId = crypto.randomUUID();
    console.info("[api/sheets/commit] start", { errorId });

    const { getServerSession } = await import("next-auth/next");
    const { authOptions } = await import("@/lib/auth");
    const {
      appendExerciseNotes,
      appendSession,
      appendSets,
    } = await import("@/lib/google-sheets");
    type WorkoutExerciseNoteRow = import("@/lib/google-sheets").WorkoutExerciseNoteRow;
    type WorkoutSessionRow = import("@/lib/google-sheets").WorkoutSessionRow;
    type WorkoutSetRow = import("@/lib/google-sheets").WorkoutSetRow;
    type ExercisePlan = import("@/lib/workout").ExercisePlan;

    const session = await getServerSession(authOptions);
    if (!session?.accessToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const requiredEnv = [
      "SPREADSHEET_ID",
      "SHEET_WORKOUT_SESSIONS",
      "SHEET_WORKOUT_SETS",
      "SHEET_WORKOUT_EXERCISE_NOTES",
    ];
    const missing = requiredEnv.filter((key) => !process.env[key]);
    if (missing.length) {
      return NextResponse.json(
        {
          error: `Missing required env vars: ${missing.join(", ")}`,
        },
        { status: 500 }
      );
    }

    const body = (await request.json().catch(() => null)) as
      | {
          workoutSession?: WorkoutSessionRow;
          session?: WorkoutSessionRow;
          sets?: unknown;
          plan?: unknown;
          exerciseNotes?: unknown;
        }
      | null;
    const {
      workoutSession: rawWorkoutSession,
      session: rawSession,
      sets: rawSets,
      plan: rawPlan,
      exerciseNotes: rawExerciseNotes,
    } = body ?? {};
    const workoutSession = rawWorkoutSession ?? rawSession ?? null;
    const sets = Array.isArray(rawSets) ? (rawSets as WorkoutSetRow[]) : [];
    const plan = Array.isArray(rawPlan) ? (rawPlan as ExercisePlan[]) : [];
    const exerciseNotes =
      rawExerciseNotes && typeof rawExerciseNotes === "object"
        ? (rawExerciseNotes as Record<string, string>)
        : {};

    const hasStringField = (value: unknown) => typeof value === "string";
    const isWorkoutSessionRow = (value: unknown): value is WorkoutSessionRow => {
      if (!value || typeof value !== "object") return false;
      const candidate = value as WorkoutSessionRow;
      return (
        hasStringField(candidate.session_id) &&
        hasStringField(candidate.plan_day) &&
        hasStringField(candidate.start_timestamp) &&
        hasStringField(candidate.end_timestamp) &&
        hasStringField(candidate.timezone) &&
        hasStringField(candidate.exercises_planned) &&
        hasStringField(candidate.exercises_completed) &&
        hasStringField(candidate.total_sets_logged) &&
        hasStringField(candidate.default_rest_seconds) &&
        hasStringField(candidate.notes) &&
        hasStringField(candidate.created_at)
      );
    };

    if (!isWorkoutSessionRow(workoutSession)) {
      return NextResponse.json({ error: "Invalid session data" }, { status: 400 });
    }

    await appendSession(session.accessToken, workoutSession);
    await appendSets(session.accessToken, sets);
    const noteRows = plan
      .map((exercise) => {
        const notes = (exerciseNotes?.[exercise.exercise_id] ?? "").toString().trim();
        if (!notes) return null;
        return {
          session_id: workoutSession.session_id,
          exercise_id: exercise.exercise_id,
          exercise_name: exercise.exercise_name,
          exercise_order: exercise.sortOrder,
          notes,
          updated_at: new Date().toISOString(),
        } satisfies WorkoutExerciseNoteRow;
      })
      .filter((row): row is WorkoutExerciseNoteRow => Boolean(row));

    await appendExerciseNotes(session.accessToken, noteRows);

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    console.error("[api/sheets/commit] error", {
      errorId,
      message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    return NextResponse.json({ errorId, message }, { status: 500 });
  }
}
