import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { readWorkoutSets } from "@/lib/google-sheets";

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.accessToken || !session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const exerciseKey = (searchParams.get("exerciseKey") ?? "").toLowerCase().trim();
  const excludeSessionId = (searchParams.get("excludeSessionId") ?? "").trim();
  const userEmail = session.user.email.toLowerCase();

  if (!exerciseKey) {
    console.log("[history]", {
      userEmail,
      exerciseKey,
      excludeSessionId,
      matched: 0,
    });
    return NextResponse.json({ sets: [], lastSessionDate: null });
  }

  const sets = await readWorkoutSets(session.accessToken);
  const matching = sets.filter((set) => {
    const setEmail = (set.user_email ?? "").toLowerCase();
    if (setEmail && setEmail !== userEmail) return false;
    if (set.exercise_id.toLowerCase() !== exerciseKey) return false;
    if (excludeSessionId && set.session_id === excludeSessionId) return false;
    return true;
  });

  const sorted = [...matching].sort((a, b) =>
    b.set_timestamp.localeCompare(a.set_timestamp)
  );

  console.log("[history]", {
    userEmail,
    exerciseKey,
    excludeSessionId,
    matched: sorted.length,
  });

  return NextResponse.json({
    sets: sorted,
    lastSessionDate: sorted[0]?.set_timestamp ?? null,
  });
}
