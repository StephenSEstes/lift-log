"use client";

import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useState } from "react";
import { useWorkoutSession } from "@/context/workout-session-context";

export default function FinishPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const { state, clear, updateState } = useWorkoutSession();
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");

  if (!state) {
    return (
      <main className="page">
        <section className="card">
          <p className="muted">No active workout. Start a new one first.</p>
        </section>
      </main>
    );
  }

  const endTimestamp = state.endTimestamp ?? new Date().toISOString();

  const handleSync = async () => {
    if (!session) return;
    setSyncing(true);
    setError("");
    updateState((prev) => ({ ...prev, endTimestamp }));

    const payload = {
      session: {
        session_id: state.sessionId,
        plan_day: state.planDay,
        start_timestamp: state.startTimestamp,
        end_timestamp: endTimestamp,
        timezone: state.timezone,
        exercises_planned: state.exercisesPlanned.toString(),
        exercises_completed: state.exercisesCompleted.toString(),
        total_sets_logged: state.totalSetsLogged.toString(),
        notes: state.notes,
        created_at: new Date().toISOString(),
      },
      sets: state.sets,
      plan: state.plan,
      exerciseNotes: state.exerciseNotes ?? {},
    };

    try {
      const response = await fetch("/api/sheets/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error("Sync failed.");
      }
      clear();
      router.push("/");
    } catch (err) {
      setError("Could not sync to Google Sheets. Please try again.");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <main className="page">
      <header className="page__header">
        <span className="eyebrow">Finish</span>
        <h1 className="title">Session recap</h1>
        <p className="subtitle">Sync everything to Google Sheets.</p>
      </header>

      <section className="card stack">
        <div className="row spaced">
          <span className="muted">Plan day</span>
          <strong>{state.planDay}</strong>
        </div>
        <div className="row spaced">
          <span className="muted">Exercises</span>
          <strong>
            {state.exercisesCompleted}/{state.exercisesPlanned}
          </strong>
        </div>
        <div className="row spaced">
          <span className="muted">Total sets logged</span>
          <strong>{state.totalSetsLogged}</strong>
        </div>
        <div className="row spaced">
          <span className="muted">Time</span>
          <strong>
            {new Date(state.startTimestamp).toLocaleTimeString()} →{" "}
            {new Date(endTimestamp).toLocaleTimeString()}
          </strong>
        </div>
      </section>

      <section className="card stack">
        <h3>Notes</h3>
        <textarea
          className="input"
          value={state.notes}
          onChange={(event) =>
            updateState((prev) => ({ ...prev, notes: event.target.value }))
          }
          placeholder="Anything to remember next time?"
          rows={3}
        />
      </section>

      {error && (
        <section className="card">
          <p className="muted">{error}</p>
        </section>
      )}

      <section className="card">
        {!session && (
          <p className="muted">Sign in to sync your workout.</p>
        )}
        {session && (
          <button
            className="button button--accent"
            onClick={handleSync}
            disabled={syncing}
          >
            {syncing ? "Syncing..." : "Finish & Sync"}
          </button>
        )}
      </section>
    </main>
  );
}
