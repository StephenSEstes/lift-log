"use client";

import { useEffect, useMemo, useState } from "react";
import { signIn, signOut, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { getTodayPlanDay, type ExercisePlan } from "@/lib/workout";
import { useWorkoutSession } from "@/context/workout-session-context";

type PlanResponse = {
  planDay: string;
  availableDays: string[];
  planRows: ExercisePlan[];
  error?: string;
};

type ExerciseSelection = {
  include: boolean;
  sets: string;
  notes?: string;
};

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error) return error.message;
  return fallback;
};

export default function Home() {
  const { data: session } = useSession();
  const { state, setState } = useWorkoutSession();
  const router = useRouter();

  const [selectedDay, setSelectedDay] = useState(getTodayPlanDay());
  const [planRows, setPlanRows] = useState<ExercisePlan[]>([]);
  const [availableDays, setAvailableDays] = useState<string[]>([]);
  const [selections, setSelections] = useState<ExerciseSelection[]>([]);
  const [defaultRestSeconds, setDefaultRestSeconds] = useState(90);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) {
      setPlanRows([]);
      setAvailableDays([]);
      setSelections([]);
      setLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setError(null);

        const response = await fetch(
          `/api/sheets/plan?planDay=${encodeURIComponent(selectedDay)}`,
          { signal: controller.signal }
        );

        let data: PlanResponse;
        try {
          data = (await response.json()) as PlanResponse;
        } catch {
          throw new Error("Plan API returned invalid JSON.");
        }

        if (!response.ok) {
          throw new Error(data?.error || `Failed to load plan (${response.status})`);
        }

        if (cancelled) return;

        setPlanRows(data.planRows ?? []);
        setAvailableDays(data.availableDays ?? []);
      } catch (e: unknown) {
        if (e instanceof Error && e.name === "AbortError") return;
        if (cancelled) return;

        setError(getErrorMessage(e, "Failed to load plan."));
        setPlanRows([]);
        setAvailableDays([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [session, selectedDay]);

  useEffect(() => {
    setSelections(
      planRows.map((row) => ({
        include: true,
        sets: Number.isFinite(row.plannedSets) ? String(row.plannedSets) : "0",
      }))
    );
  }, [planRows]);

  useEffect(() => {
    if (state?.defaultRestSeconds) {
      setDefaultRestSeconds(state.defaultRestSeconds);
    }
  }, [state?.defaultRestSeconds]);

  const dayOptions = useMemo(() => {
    const unique = new Set(availableDays);
    if (selectedDay) unique.add(selectedDay);
    return Array.from(unique);
  }, [availableDays, selectedDay]);

  const plannedExercises = useMemo(() => {
    return planRows.reduce((count, row, index) => {
      const selection = selections[index];
      const sets = Number(selection?.sets ?? row.plannedSets);
      if (!selection?.include) return count;
      if (!Number.isFinite(sets) || sets <= 0) return count;
      return count + 1;
    }, 0);
  }, [planRows, selections]);

  const handleStart = async () => {
    const plan = planRows
      .map((row, index) => {
        const selection = selections[index];
        const sets = Number(selection?.sets ?? row.plannedSets);
        if (!selection?.include || !Number.isFinite(sets) || sets <= 0) {
          return null;
        }
        return {
          ...row,
          plannedSets: sets,
          notes: selection?.notes ?? "",
        };
      })
      .filter(Boolean) as ExercisePlan[];
  
    if (!plan.length) return;
  
    try {
      setLoading(true);
      setError(null);
  
      // 1) Create the session row in Sheets and get a real SessionId
      const resp = await fetch("/api/sheets/sessions/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutName: `Plan Day: ${selectedDay}`,
        }),
      });
  
      const payload = await resp.json().catch(() => null);
  
      if (!resp.ok || !payload?.sessionId) {
        throw new Error(payload?.error || "Failed to create session in Sheets.");
      }
  
      // 2) Use the Sheets SessionId in state (instead of createSessionId())
      const nextState = {
        sessionId: payload.sessionId,
        planDay: selectedDay,
        startTimestamp: new Date().toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        exercisesPlanned: plan.length,
        exercisesCompleted: 0,
        totalSetsLogged: 0,
        defaultRestSeconds,
        plan,
        currentExerciseIndex: 0,
        currentSetIndex: 1,
        sets: [],
        exerciseNotes: {},
        notes: "",
      };
  
      setState(nextState);
      router.push("/workout/plan");
    } catch (e: unknown) {
      setError(getErrorMessage(e, "Failed to start workout."));
    } finally {
      setLoading(false);
    }
  };
  
  return (
    <main className="page">
      <header className="page__header">
        <span className="eyebrow">Workout Setup</span>
        <h1 className="title">Plan today&apos;s session.</h1>
        <p className="subtitle">Pick your plan day and tweak sets before you start.</p>
      </header>

      {!session && (
        <section className="card stack fade-in">
          <p className="muted">Sign in with Google to load your plan and sync results.</p>
          <div className="row">
            <button className="button button--accent" onClick={() => signIn("google")}>
              Sign in with Google
            </button>
          </div>
        </section>
      )}

      {session && (
        <section className="stack">
          <section className="card stack">
            <div className="row spaced">
              <div>
                <p className="muted">Signed in as</p>
                <strong>{session.user?.email}</strong>
              </div>
              <button className="button button--ghost" onClick={() => signOut()}>
                Sign out
              </button>
            </div>
            <div className="stack">
              <label className="muted">Plan day</label>
              <select
                className="input"
                value={selectedDay}
                onChange={(event) => setSelectedDay(event.target.value)}
              >
                {dayOptions.map((day) => (
                  <option key={day} value={day}>
                    {day}
                  </option>
                ))}
              </select>
            </div>
          </section>

          {error && (
            <section className="card stack">
              <p>
                <strong>Error:</strong> {error}
              </p>
              <p className="muted">
                If you have not created your Google Sheet yet, create it (tabs:
                WorkoutPlan, WorkoutSessions, WorkoutSets), set SPREADSHEET_ID in
                .env.local, then restart the dev server.
              </p>
            </section>
          )}

          {loading && (
            <section className="card">
              <p className="muted">Loading plan from Sheets...</p>
            </section>
          )}

          {!loading && planRows.length === 0 && (
            <section className="card">
              <p className="muted">No exercises found for {selectedDay}.</p>
            </section>
          )}

          {!loading && planRows.length > 0 && (
            <section className="stack">
              <div className="card stack">
                <label className="muted">Default Rest Time (seconds)</label>
                <input
                  className="input"
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={defaultRestSeconds}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    setDefaultRestSeconds(Number.isFinite(next) ? next : 0);
                  }}
                />
                <div className="row">
                  {[60, 90, 120, 180].map((seconds) => (
                    <button
                      key={seconds}
                      className="button button--ghost"
                      onClick={() => setDefaultRestSeconds(seconds)}
                    >
                      {seconds}s
                    </button>
                  ))}
                </div>
              </div>
              {planRows.map((exercise, index) => {
                const selection = selections[index];
                return (
                  <div className="card stack fade-in" key={`${exercise.exercise_id}-${index}`}>
                    <div className="row spaced">
                      <div>
                        <h3>{exercise.exercise_name}</h3>
                        <p className="muted">
                          {exercise.plannedSets} sets • {exercise.target_rep_min}-
                          {exercise.target_rep_max} reps
                        </p>
                      </div>
                      <span className="tag">#{exercise.sortOrder}</span>
                    </div>
                    <div className="row spaced">
                      <label className="row">
                        <input
                          type="checkbox"
                          checked={selection?.include ?? true}
                          onChange={(event) => {
                            setSelections((prev) =>
                              prev.map((item, idx) =>
                                idx === index
                                  ? { ...item, include: event.target.checked }
                                  : item
                              )
                            );
                          }}
                        />
                        <span>Include</span>
                      </label>
                      <div>
                        <label className="muted">Sets</label>
                        <input
                          className="input input--inline"
                          type="number"
                          min={0}
                          value={selection?.sets ?? String(exercise.plannedSets)}
                          onChange={(event) => {
                            const value = event.target.value;
                            setSelections((prev) =>
                              prev.map((item, idx) =>
                                idx === index ? { ...item, sets: value } : item
                              )
                            );
                          }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </section>
          )}

          <section className="card">
            <button
              className="button button--accent"
              onClick={handleStart}
              disabled={loading || plannedExercises === 0}
            >
              Start Workout
            </button>
          </section>
        </section>
      )}
    </main>
  );
}
