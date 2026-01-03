import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { readWorkoutSets } from "@/lib/google-sheets";

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const exerciseId = (searchParams.get("exerciseId") ?? "").toLowerCase();
  const exerciseName = (searchParams.get("exerciseName") ?? "").toLowerCase();
  const sets = await readWorkoutSets(session.accessToken);

  const matching = sets.filter((set) => {
    if (exerciseId && set.exercise_id.toLowerCase() === exerciseId) return true;
    if (exerciseName && set.exercise_name.toLowerCase() === exerciseName)
      return true;
    return false;
  });

  if (!matching.length) {
    return NextResponse.json({ lastSessionDate: null, sets: [] });
  }

  const sorted = [...matching].sort((a, b) =>
    b.set_timestamp.localeCompare(a.set_timestamp)
  );
  const latestSessionId = sorted[0].session_id;
  const latestSets = matching
    .filter((set) => set.session_id === latestSessionId)
    .sort((a, b) => a.set_number - b.set_number);

  return NextResponse.json({
    lastSessionDate: sorted[0].set_timestamp,
    sets: latestSets,
  });
}
