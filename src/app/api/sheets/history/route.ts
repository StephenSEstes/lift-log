import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { readWorkoutSets } from "@/lib/google-sheets";

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const requiredEnv = ["SPREADSHEET_ID", "SHEET_WORKOUT_SETS"];
  const missing = requiredEnv.filter((key) => !process.env[key]);
  if (missing.length) {
    return NextResponse.json(
      {
        lastSessionDate: null,
        sets: [],
        error: `Missing required env vars: ${missing.join(", ")}`,
      },
      { status: 500 }
    );
  }

  const { searchParams } = new URL(request.url);
  const exerciseId = (searchParams.get("exerciseId") ?? "").toLowerCase();
  const exerciseName = (searchParams.get("exerciseName") ?? "").toLowerCase();
  const userEmail = (session.user?.email ?? "").toLowerCase();
  const sets = await readWorkoutSets(session.accessToken);

  const matching = sets.filter((set) => {
    const setUserEmail = (set.user_email ?? "").toLowerCase();
    if (userEmail && setUserEmail && setUserEmail !== userEmail) return false;
    if (exerciseId && set.exercise_id.toLowerCase() === exerciseId) return true;
    if (exerciseName && set.exercise_name.toLowerCase() === exerciseName)
      return true;
    return false;
  });

  if (!matching.length) {
    return NextResponse.json({ lastSessionDate: null, sets: [], recentSets: [] });
  }

  const sorted = [...matching].sort((a, b) =>
    b.set_timestamp.localeCompare(a.set_timestamp)
  );

  // Determine the latest session id and return those sets as the "last session" (preserves existing behavior)
  const latestSessionId = sorted[0].session_id;
  const latestSets = matching
    .filter((set) => set.session_id === latestSessionId)
    .sort((a, b) => a.set_number - b.set_number);

  // Also include recent sets across the last N sessions for PR calculations.
  const MAX_SESSIONS = 12;
  const sessionOrder: string[] = [];
  for (const s of sorted) {
    if (!sessionOrder.includes(s.session_id)) sessionOrder.push(s.session_id);
    if (sessionOrder.length >= MAX_SESSIONS) break;
  }

  const recentSets = matching
    .filter((set) => sessionOrder.includes(set.session_id))
    .sort((a, b) => b.set_timestamp.localeCompare(a.set_timestamp));

  return NextResponse.json({
    lastSessionDate: sorted[0].set_timestamp,
    sets: latestSets,
    recentSets,
  });
}
