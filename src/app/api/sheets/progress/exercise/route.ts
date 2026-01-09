import { getServerSession, type Session } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { readWorkoutSessions, readWorkoutSets } from "@/lib/google-sheets";

type SessionWithAccessToken = Session & { accessToken?: string };

type ProgressSet = {
  setNumber: number;
  setTimestamp: string;
  weight: number;
  reps: number;
  restSeconds: number;
  rpe: string;
};

type ProgressSession = {
  sessionId: string;
  sessionDate: string;
  sets: ProgressSet[];
  topSetWeight: number;
  totalReps: number;
  totalVolume: number;
};

const pickSessionDate = (
  session: { start_timestamp: string; end_timestamp: string } | null,
  fallback: string
) => (session?.end_timestamp || session?.start_timestamp || fallback).toString();

const asSortTimestamp = (value: string) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  const accessToken = (session as SessionWithAccessToken | null)?.accessToken;

  if (!accessToken) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const requiredEnv = ["SPREADSHEET_ID", "SHEET_WORKOUT_SETS", "SHEET_WORKOUT_SESSIONS"];
  const missing = requiredEnv.filter((key) => !process.env[key]);
  if (missing.length) {
    return Response.json(
      { error: `Missing required env vars: ${missing.join(", ")}` },
      { status: 500 }
    );
  }

  const { searchParams } = new URL(request.url);
  const exerciseKey = (searchParams.get("exerciseKey") ?? "").trim();
  if (!exerciseKey) {
    return Response.json({ error: "Missing exerciseKey" }, { status: 400 });
  }

  const [sessions, sets] = await Promise.all([
    readWorkoutSessions(accessToken),
    readWorkoutSets(accessToken),
  ]);

  const sessionMap = new Map(sessions.map((row) => [row.session_id, row]));
  const exerciseSets = sets.filter((set) => set.exercise_id === exerciseKey);

  if (!exerciseSets.length) {
    return Response.json({
      exerciseKey,
      exerciseName: "",
      sessions: [],
    });
  }

  const exerciseName = exerciseSets[0]?.exercise_name ?? "";
  const sessionsById = new Map<string, ProgressSession>();

  for (const set of exerciseSets) {
    const sessionRow = sessionMap.get(set.session_id) ?? null;
    const sessionDate = pickSessionDate(sessionRow, set.set_timestamp);
    const entry =
      sessionsById.get(set.session_id) ??
      ({
        sessionId: set.session_id,
        sessionDate,
        sets: [],
        topSetWeight: 0,
        totalReps: 0,
        totalVolume: 0,
      } satisfies ProgressSession);

    entry.sets.push({
      setNumber: Number(set.set_number ?? 0),
      setTimestamp: set.set_timestamp,
      weight: Number(set.weight ?? 0),
      reps: Number(set.reps ?? 0),
      restSeconds: Number(set.rest_seconds ?? 0),
      rpe: (set.rpe ?? "").toString(),
    });

    sessionsById.set(set.session_id, entry);
  }

  const sessionsSorted = Array.from(sessionsById.values())
    .map((entry) => {
      const setRows = [...entry.sets].sort((a, b) => {
        if (a.setNumber !== b.setNumber) return a.setNumber - b.setNumber;
        return asSortTimestamp(a.setTimestamp) - asSortTimestamp(b.setTimestamp);
      });

      let topSetWeight = 0;
      let totalReps = 0;
      let totalVolume = 0;

      for (const set of setRows) {
        if (Number.isFinite(set.weight)) {
          topSetWeight = Math.max(topSetWeight, set.weight);
        }
        if (Number.isFinite(set.reps)) {
          totalReps += set.reps;
        }
        if (Number.isFinite(set.weight) && Number.isFinite(set.reps)) {
          totalVolume += set.weight * set.reps;
        }
      }

      return {
        ...entry,
        sets: setRows,
        topSetWeight,
        totalReps,
        totalVolume,
      };
    })
    .sort((a, b) => {
      const aTime = asSortTimestamp(a.sessionDate);
      const bTime = asSortTimestamp(b.sessionDate);
      if (aTime !== bTime) return bTime - aTime;
      return b.sessionDate.localeCompare(a.sessionDate);
    })
    .slice(0, 4);

  return Response.json({
    exerciseKey,
    exerciseName,
    sessions: sessionsSorted,
  });
}
