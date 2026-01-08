import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { readWorkoutSets } from "@/lib/google-sheets";

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.accessToken) {
    return NextResponse.json({ error: "Unauthorized", sets: [] }, { status: 401 });
  }

  const requiredEnv = ["SPREADSHEET_ID", "SHEET_WORKOUT_SETS"];
  const missing = requiredEnv.filter((key) => !process.env[key]);
  if (missing.length) {
    return NextResponse.json(
      { error: `Missing required env vars: ${missing.join(", ")}`, sets: [] },
      { status: 500 }
    );
  }

  const { searchParams } = new URL(request.url);
  const sessionId = (searchParams.get("sessionId") ?? "").trim();
  if (!sessionId) {
    return NextResponse.json({ error: "Missing sessionId", sets: [] }, { status: 400 });
  }

  const sets = await readWorkoutSets(session.accessToken);
  const filtered = sets.filter(
    (set) => set.session_id === sessionId && set.is_deleted !== "TRUE"
  );

  return NextResponse.json({ sets: filtered });
}
