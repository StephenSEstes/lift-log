import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { appendExerciseNotes, appendSession, appendSets } from "@/lib/google-sheets";

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const workoutSession = body?.session;
  const sets = Array.isArray(body?.sets) ? body.sets : [];
  const plan = Array.isArray(body?.plan) ? body.plan : [];
  const exerciseNotes =
    body?.exerciseNotes && typeof body.exerciseNotes === "object"
      ? (body.exerciseNotes as Record<string, string>)
      : {};

  if (!workoutSession) {
    return NextResponse.json({ error: "Missing session data" }, { status: 400 });
  }

  await appendSession(session.accessToken, workoutSession);
  await appendSets(session.accessToken, sets);
  const noteRows = plan
    .map((exercise: any) => {
      const notes = (exerciseNotes?.[exercise.exercise_id] ?? "").toString().trim();
      if (!notes) return null;
      return {
        session_id: workoutSession.session_id,
        exercise_id: exercise.exercise_id,
        exercise_name: exercise.exercise_name,
        exercise_order: exercise.exercise_order,
        notes,
        updated_at: new Date().toISOString(),
      };
    })
    .filter(Boolean);

  await appendExerciseNotes(session.accessToken, noteRows);

  return NextResponse.json({ ok: true });
}
