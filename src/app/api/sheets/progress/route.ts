import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { readWorkoutSessions, readWorkoutSets } from "@/lib/google-sheets";

type ExerciseSeriesPoint = {
  date: string;
  weight: number;
  reps: number;
};

type ExerciseProgress = {
  exerciseId: string;
  exerciseName: string;
  series: ExerciseSeriesPoint[];
};

const pickSessionDate = (session: {
  start_timestamp: string;
  end_timestamp: string;
}) => session.end_timestamp || session.start_timestamp;

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const requiredEnv = ["SPREADSHEET_ID", "SHEET_WORKOUT_SESSIONS", "SHEET_WORKOUT_SETS"];
  const missing = requiredEnv.filter((key) => !process.env[key]);
  if (missing.length) {
    return NextResponse.json(
      { error: `Missing required env vars: ${missing.join(", ")}` },
      { status: 500 }
    );
  }

  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
  }

  const [sessions, sets] = await Promise.all([
    readWorkoutSessions(session.accessToken),
    readWorkoutSets(session.accessToken),
  ]);

  const sessionMap = new Map(sessions.map((row) => [row.session_id, row]));

  const sessionSets = sets.filter((set) => set.session_id === sessionId);
  if (!sessionSets.length) {
    return NextResponse.json({ exercises: [] });
  }

  const exercises = Array.from(
    new Map(
      sessionSets.map((set) => [
        set.exercise_id,
        { exerciseId: set.exercise_id, exerciseName: set.exercise_name },
      ])
    ).values()
  );

  const progress: ExerciseProgress[] = exercises.map((exercise) => {
    const exerciseSets = sets.filter((set) => set.exercise_id === exercise.exerciseId);
    const sessionIds = Array.from(new Set(exerciseSets.map((set) => set.session_id)));

    const sessionRows = sessionIds
      .map((id) => sessionMap.get(id))
      .filter(Boolean)
      .sort((a, b) => pickSessionDate(a!).localeCompare(pickSessionDate(b!)));

    const lastFour = sessionRows.slice(-4);

    const series: ExerciseSeriesPoint[] = lastFour.map((row) => {
      const perSessionSets = exerciseSets.filter((set) => set.session_id === row!.session_id);
      const nonSkipped = perSessionSets.filter((set) => set.is_skipped !== "TRUE");

      let topWeight = 0;
      let topReps = 0;
      for (const set of nonSkipped) {
        const weight = Number(set.weight ?? 0);
        const reps = Number(set.reps ?? 0);
        if (weight > topWeight || (weight === topWeight && reps > topReps)) {
          topWeight = weight;
          topReps = reps;
        }
      }

      return {
        date: pickSessionDate(row!),
        weight: topWeight,
        reps: topReps,
      };
    });

    return {
      exerciseId: exercise.exerciseId,
      exerciseName: exercise.exerciseName,
      series,
    };
  });

  return NextResponse.json({
    userId: session.user?.email ?? "",
    exercises: progress,
  });
}
