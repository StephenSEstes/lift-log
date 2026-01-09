import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { readWorkoutPlan } from "@/lib/google-sheets";

export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);

    const userEmail = session?.user?.email ?? "";

    if (!session?.accessToken || !userEmail) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Guard: required configuration
    const requiredEnv = ["SPREADSHEET_ID", "SHEET_WORKOUT_PLAN"];
    const missing = requiredEnv.filter((key) => !process.env[key]);
    if (missing.length) {
      return NextResponse.json(
        {
          planDay: "",
          availableDays: [],
          planRows: [],
          error: `Missing required env vars: ${missing.join(", ")}`,
        },
        { status: 500 }
      );
    }

    const { searchParams } = new URL(request.url);
    const planDay = searchParams.get("planDay") ?? "";

    // Read from Sheets (may throw if sheet/tab missing or permissions)
    const planRows = await readWorkoutPlan(session.accessToken);

    const userRows = planRows.filter((row) => row.userEmail === userEmail);

    const availableDays = Array.from(
      new Set(userRows.map((row) => row.dayKey).filter(Boolean))
    ).sort();

    const filtered = planDay
      ? userRows.filter((row) => row.dayKey === planDay)
      : userRows;

    return NextResponse.json({
      planDay,
      availableDays,
      planRows: filtered.sort((a, b) => a.sortOrder - b.sortOrder),
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown error reading WorkoutPlan";

    // Always return JSON so the client never fails response.json()
    return NextResponse.json(
      {
        planDay: "",
        availableDays: [],
        planRows: [],
        error: message,
      },
      { status: 500 }
    );
  }
}
