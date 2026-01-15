"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useWorkoutSession } from "@/context/workout-session-context";
import type { LoggedSet } from "@/lib/workout";
import { computePrValues } from "@/lib/workout";

type HistoryResponse = {
  lastSessionDate: string | null;
  sets: LoggedSet[];
  recentSets?: LoggedSet[];
};

type ExerciseSummary = {
  exerciseId: string;
  exerciseName: string;
  exerciseOrder: number;
};

type HistoryMap = Record<string, HistoryResponse | null>;

const getWeightTimesRepsValue = (set: LoggedSet) => {
  const repsNum = Number(set.reps);
  const weightNum = Number(set.weight);
  const reps = Number.isFinite(repsNum) ? repsNum : 0;
  const weight = Number.isFinite(weightNum) && weightNum > 0 ? weightNum : 1;
  return reps * weight;
};

const getBestWeightTimesRepsBySession = (sets: LoggedSet[] | undefined) => {
  if (!sets || sets.length === 0) return [];

  const order: string[] = [];
  const seen = new Set<string>();
  const bestBySession = new Map<string, number>();

  for (const set of sets) {
    if (!seen.has(set.session_id)) {
      if (order.length >= 12) continue;
      seen.add(set.session_id);
      order.push(set.session_id);
    }

    if (!seen.has(set.session_id)) continue;

    const value = getWeightTimesRepsValue(set);
    const previous = bestBySession.get(set.session_id);
    if (previous === undefined || value > previous) {
      bestBySession.set(set.session_id, value);
    }
  }

  return order
    .slice(0, 12)
    .reverse()
    .map((sessionId) => bestBySession.get(sessionId) ?? 0);
};

const Sparkline = ({
  values,
  width = 140,
  height = 40,
}: {
  values: number[];
  width?: number;
  height?: number;
}) => {
  if (values.length === 0) return null;

  const padding = 4;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const innerWidth = width - padding * 2;
  const innerHeight = height - padding * 2;
  const step = values.length > 1 ? innerWidth / (values.length - 1) : 0;

  const points = values
    .map((value, index) => {
      const x = padding + index * step;
      const y = height - padding - ((value - min) / range) * innerHeight;
      return `${x},${y}`;
    })
    .join(" ");

  const lastPoint = points.split(" ").pop()?.split(",") ?? [];
  const lastX = Number(lastPoint[0] ?? 0);
  const lastY = Number(lastPoint[1] ?? 0);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Best weight times reps history"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {Number.isFinite(lastX) && Number.isFinite(lastY) && (
        <circle cx={lastX} cy={lastY} r={3} fill="currentColor" />
      )}
    </svg>
  );
};

export default function FinishPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const { state, clear } = useWorkoutSession();
  const [historyByExercise, setHistoryByExercise] = useState<HistoryMap>({});
  const [loadingHistory, setLoadingHistory] = useState(false);

  const performedExercises = useMemo<ExerciseSummary[]>(() => {
    if (!state) return [];

    const seen = new Map<string, ExerciseSummary>();
    const sessionSets = state.sets.filter((set) => set.session_id === state.sessionId);

    for (const set of sessionSets) {
      if (!seen.has(set.exercise_id)) {
        seen.set(set.exercise_id, {
          exerciseId: set.exercise_id,
          exerciseName: set.exercise_name,
          exerciseOrder: set.exercise_order,
        });
      }
    }

    return [...seen.values()].sort((a, b) => a.exerciseOrder - b.exerciseOrder);
  }, [state]);

  useEffect(() => {
    if (!session || performedExercises.length === 0) {
      setHistoryByExercise({});
      setLoadingHistory(false);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    setLoadingHistory(true);

    (async () => {
      const results = await Promise.all(
        performedExercises.map(async (exercise) => {
          try {
            const response = await fetch(
              `/api/sheets/history?exerciseId=${encodeURIComponent(
                exercise.exerciseId
              )}&exerciseName=${encodeURIComponent(exercise.exerciseName)}`,
              { signal: controller.signal }
            );
            if (!response.ok) return [exercise.exerciseId, null] as const;
            const data = (await response.json()) as HistoryResponse;
            return [exercise.exerciseId, data] as const;
          } catch (error: unknown) {
            if (error instanceof Error && error.name === "AbortError") {
              return null;
            }
            return [exercise.exerciseId, null] as const;
          }
        })
      );

      if (cancelled) return;

      const next: HistoryMap = {};
      for (const entry of results) {
        if (!entry) continue;
        const [exerciseId, history] = entry;
        next[exerciseId] = history;
      }

      setHistoryByExercise(next);
      setLoadingHistory(false);
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [session, performedExercises]);

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
  const sessionTime = `${new Date(state.startTimestamp).toLocaleTimeString()} to ${new Date(
    endTimestamp
  ).toLocaleTimeString()}`;

  return (
    <main className="page">
      <header className="page__header">
        <span className="eyebrow">Workout Complete</span>
        <h1 className="title">Congratulations</h1>
        <p className="subtitle">Your session highlights are ready.</p>
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
          <strong>{sessionTime}</strong>
        </div>
      </section>

      {!session && (
        <section className="card">
          <p className="muted">Sign in to load PR history and session trends.</p>
        </section>
      )}

      {performedExercises.length === 0 && (
        <section className="card">
          <p className="muted">No logged exercises found for this session.</p>
        </section>
      )}

      {performedExercises.map((exercise) => {
        const history = historyByExercise[exercise.exerciseId] ?? null;
        const historySets = history?.recentSets ?? history?.sets ?? [];
        const prValues = computePrValues(historySets);
        const sparklineValues = getBestWeightTimesRepsBySession(
          history?.recentSets ?? []
        );

        return (
          <section className="card stack" key={exercise.exerciseId}>
            <div className="row spaced">
              <h3>{exercise.exerciseName}</h3>
              {loadingHistory && <span className="muted">Loading...</span>}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="stack">
                <div className="row spaced">
                  <span className="muted">PR Max Weight</span>
                  <strong>{prValues.prMaxWeight ?? "-"}</strong>
                </div>
                <div className="row spaced">
                  <span className="muted">PR Max Weight × Reps</span>
                  <strong>{prValues.prMaxWeightTimesReps ?? "-"}</strong>
                </div>
              </div>

              <div className="stack md:col-span-2">
                <span className="muted">Best Weight × Reps (recent sessions)</span>
                {loadingHistory ? (
                  <p className="muted">Loading history...</p>
                ) : sparklineValues.length > 0 ? (
                  <Sparkline values={sparklineValues} />
                ) : (
                  <p className="muted">No history yet.</p>
                )}
              </div>
            </div>
          </section>
        );
      })}

      <section className="card stack">
        <button
          className="button button--accent"
          onClick={() => {
            clear();
            router.push("/workout/plan");
          }}
        >
          Back to workout plan
        </button>
      </section>
    </main>
  );
}
