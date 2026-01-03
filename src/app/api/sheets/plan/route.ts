import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { readWorkoutPlan } from "@/lib/google-sheets";

export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.accessToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Guard: required configuration
    const spreadsheetId = process.env.SPREADSHEET_ID;
    if (!spreadsheetId) {
      return NextResponse.json(
        {
          planDay: "",
          availableDays: [],
          planRows: [],
          error:
            "SPREADSHEET_ID is not set. Create the Google Sheet and set SPREADSHEET_ID in .env.local, then restart the dev server.",
        },
        { status: 400 }
      );
    }

    const { searchParams } = new URL(request.url);
    const planDay = searchParams.get("planDay") ?? "";

    // Read from Sheets (may throw if sheet/tab missing or permissions)
    const planRows = await readWorkoutPlan(session.accessToken);

    const availableDays = Array.from(
      new Set(planRows.map((row) => row.plan_day).filter(Boolean))
    ).sort();

    const filtered = planDay
      ? planRows.filter((row) => row.plan_day === planDay)
      : planRows;

    return NextResponse.json({
      planDay,
      availableDays,
      planRows: filtered.sort((a, b) => a.exercise_order - b.exercise_order),
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
