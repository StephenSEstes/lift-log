"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  getTodayPlanDay,
  type ExerciseCatalogRow,
  type ExercisePlan,
  type LoggedSet,
} from "@/lib/workout";
import { useWorkoutSession } from "@/context/workout-session-context";

type PlanResponse = {
  planDay: string;
  planRows: ExercisePlan[];
  error?: string;
};

type RestTargetMap = Record<string, number>;
type CatalogMap = Record<string, ExerciseCatalogRow>;
type SessionSetsResponse = {
  sets: LoggedSet[];
  error?: string;
};

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error) return error.message;
  return fallback;
};

export default function WorkoutPlanPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, status } = useSession();
  const { state, setState } = useWorkoutSession();
  const selectedDay = useMemo(() => state?.planDay ?? getTodayPlanDay(), [state?.planDay]);
  const [planRows, setPlanRows] = useState<ExercisePlan[]>([]);
  const [restTargets, setRestTargets] = useState<RestTargetMap>({});
  const [catalogMap, setCatalogMap] = useState<CatalogMap>({});
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionSets, setSessionSets] = useState<LoggedSet[]>([]);
  const [loadingSessionSets, setLoadingSessionSets] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingRestTargets, setLoadingRestTargets] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === "loading") return;
    if (!session) {
      router.push("/");
    }
  }, [session, status, router]);

  useEffect(() => {
    const fromQuery = (searchParams.get("sessionId") ?? "").trim();
    if (fromQuery) {
      setSessionId(fromQuery);
      return;
    }
    if (state?.sessionId) {
      setSessionId(state.sessionId);
      return;
    }
    if (typeof window !== "undefined") {
      const stored = window.localStorage.getItem("activeWorkoutSessionId");
      setSessionId(stored ? stored : null);
    }
  }, [searchParams, state?.sessionId]);

  useEffect(() => {
    if (!session) return;
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
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") return;
        if (cancelled) return;
        setError(getErrorMessage(err, "Failed to load plan."));
        setPlanRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [session, selectedDay]);

  const loadSessionSets = useCallback(
    async (activeSessionId: string | null) => {
      if (!activeSessionId) {
        setSessionSets([]);
        return;
      }

      setLoadingSessionSets(true);
      try {
        const response = await fetch(
          `/api/sheets/sets/by-session?sessionId=${encodeURIComponent(activeSessionId)}`
        );
        const data = (await response.json().catch(() => null)) as SessionSetsResponse | null;
        if (!response.ok) {
          throw new Error(data?.error || `Failed to load session sets (${response.status})`);
        }
        setSessionSets(data?.sets ?? []);
      } catch {
        if (state?.sessionId === activeSessionId) {
          setSessionSets(state.sets ?? []);
        } else {
          setSessionSets([]);
        }
      } finally {
        setLoadingSessionSets(false);
      }
    },
    [state]
  );

  useEffect(() => {
    loadSessionSets(sessionId);
  }, [loadSessionSets, sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    const handleFocus = () => {
      loadSessionSets(sessionId);
    };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [loadSessionSets, sessionId]);

  const planForSelectedDay = useMemo(() => {
    return planRows
      .map((row) => ({
        ...row,
        plannedSets: Number.isFinite(row.plannedSets) ? row.plannedSets : 0,
      }))
      .filter((row) => row.plannedSets > 0);
  }, [planRows]);

  const activePlan = useMemo(() => {
    if (state?.plan?.length) return state.plan;
    return planForSelectedDay;
  }, [planForSelectedDay, state?.plan]);

  const progressMap = useMemo(() => {
    const counts = new Map<string, number>();
    sessionSets.forEach((set) => {
      if (sessionId && set.session_id !== sessionId) return;
      if (set.is_deleted === "TRUE") return;
      counts.set(set.exercise_id, (counts.get(set.exercise_id) ?? 0) + 1);
    });

    return activePlan.reduce((map, exercise) => {
      map.set(exercise.exercise_id, {
        loggedCount: counts.get(exercise.exercise_id) ?? 0,
        plannedCount: exercise.plannedSets ?? 0,
      });
      return map;
    }, new Map<string, { loggedCount: number; plannedCount: number }>());
  }, [activePlan, sessionId, sessionSets]);

  useEffect(() => {
    if (!activePlan.length) {
      setRestTargets({});
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    (async () => {
      setLoadingRestTargets(true);
      try {
        const entries = await Promise.all(
          activePlan.map(async (exercise) => {
            try {
              const response = await fetch(
                `/api/sheets/exercise-setup/get?exerciseKey=${encodeURIComponent(
                  exercise.exercise_id
                )}`,
                { signal: controller.signal }
              );
              const data = (await response.json().catch(() => null)) as
                | { found?: boolean; row?: { defaultRestSeconds?: number } }
                | null;
              if (!response.ok || !data?.found || !data.row) {
                return [exercise.exercise_id, 0] as const;
              }
              const candidate = Number(data.row.defaultRestSeconds);
              const nextTarget =
                Number.isFinite(candidate) && candidate > 0 ? candidate : 0;
              return [exercise.exercise_id, nextTarget] as const;
            } catch (err: unknown) {
              if (err instanceof Error && err.name === "AbortError") {
                throw err;
              }
              return [exercise.exercise_id, 0] as const;
            }
          })
        );
        if (cancelled) return;
        setRestTargets(Object.fromEntries(entries));
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") return;
      } finally {
        if (!cancelled) {
          setLoadingRestTargets(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [activePlan]);

  useEffect(() => {
    if (!activePlan.length) {
      setCatalogMap({});
      return;
    }
    const controller = new AbortController();
    let cancelled = false;

    (async () => {
      try {
        const entries = await Promise.all(
          activePlan.map(async (exercise) => {
            try {
              const response = await fetch(
                `/api/sheets/exercise-catalog/get?exerciseKey=${encodeURIComponent(
                  exercise.exercise_id
                )}`,
                { signal: controller.signal }
              );
              const data = (await response.json().catch(() => null)) as
                | { found?: boolean; row?: ExerciseCatalogRow }
                | null;
              if (response.ok && data?.found && data.row) {
                return [exercise.exercise_id, data.row] as const;
              }
              return [exercise.exercise_id, null] as const;
            } catch (err: unknown) {
              if (err instanceof Error && err.name === "AbortError") {
                throw err;
              }
              return [exercise.exercise_id, null] as const;
            }
          })
        );
        if (cancelled) return;
        const nextMap: CatalogMap = {};
        entries.forEach(([key, row]) => {
          if (row) nextMap[key] = row;
        });
        setCatalogMap(nextMap);
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") return;
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [activePlan]);

  const firstExercise = activePlan[0] ?? null;
  const hasSession = Boolean(state?.sessionId);
  const isSessionComplete = useMemo(() => {
    if (!state?.sessionId || !state.plan.length) return false;
    const loggedExerciseIds = new Set(
      state.sets
        .filter((set) => set.session_id === state.sessionId)
        .map((set) => set.exercise_id)
    );
    return state.plan.every((exercise) => loggedExerciseIds.has(exercise.exercise_id));
  }, [state]);
  const hasActiveSession = hasSession && !isSessionComplete;
  const hasCompletedSession = hasSession && isSessionComplete;
  const hasAnyLoggedSets = useMemo(() => {
    if (!sessionId) return false;
    return sessionSets.some(
      (set) => set.session_id === sessionId && set.is_deleted !== "TRUE"
    );
  }, [sessionId, sessionSets]);
  const resumeExercise = state?.plan?.[state.currentExerciseIndex] ?? state?.plan?.[0] ?? null;
  const summaryGridMinWidth = 560;
  const summaryGridStyle: CSSProperties = {
    gridTemplateColumns: "minmax(180px, 1fr) 120px 80px 140px",
    alignItems: "center",
    minWidth: summaryGridMinWidth,
  };

  const getPlanRestDefault = (exercise: ExercisePlan) => {
    const planDefault = Number(exercise.defaultRestSeconds ?? 0);
    return Number.isFinite(planDefault) && planDefault > 0 ? planDefault : 120;
  };

  const getRestTarget = (exercise: ExercisePlan) => {
    const setupRest = restTargets[exercise.exercise_id] ?? 0;
    if (setupRest > 0) return setupRest;
    return getPlanRestDefault(exercise);
  };

  const getProgressLabel = (loggedCount: number, plannedCount: number) => {
    if (loggedCount <= 0) return "Not started";
    if (!plannedCount) return `Set ${loggedCount} complete`;
    if (loggedCount < plannedCount) return `Set ${loggedCount} complete`;
    return "Complete";
  };

  const getTargetSetIndex = (loggedCount: number, plannedCount: number) => {
    if (!plannedCount || plannedCount <= 0) return null;
    if (loggedCount >= plannedCount) return null;
    return Math.min(loggedCount + 1, plannedCount);
  };

  const handleResume = () => {
    if (!state?.sessionId || !resumeExercise) return;
    router.push(
      `/workout/ready?exerciseKey=${encodeURIComponent(
        resumeExercise.exercise_id
      )}&sessionId=${encodeURIComponent(state.sessionId)}`
    );
  };

  const primaryCtaLabel = hasCompletedSession
    ? "Begin another workout"
    : hasSession
    ? hasAnyLoggedSets
      ? "Resume Workout"
      : "Begin Workout"
    : "Begin Workout";

  const handleBegin = async () => {
    if (!firstExercise || !session) return;

    if (hasActiveSession) {
      handleResume();
      return;
    }

    try {
      setLoading(true);
      setError(null);

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

      const nextState = {
        sessionId: payload.sessionId,
        planDay: selectedDay,
        startTimestamp: new Date().toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        exercisesPlanned: activePlan.length,
        exercisesCompleted: 0,
        totalSetsLogged: 0,
        plan: activePlan,
        currentExerciseIndex: 0,
        currentSetIndex: 1,
        sets: [],
        exerciseNotes: {},
        notes: "",
      };

      setState(nextState);
      router.push(
        `/workout/ready?exerciseKey=${encodeURIComponent(
          firstExercise.exercise_id
        )}&sessionId=${encodeURIComponent(payload.sessionId)}`
      );
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to start workout."));
    } finally {
      setLoading(false);
    }
  };

  if (!session) {
    return null;
  }

  return (
    <main className="page">
      <header className="page__header">
        <span className="eyebrow">Workout Summary</span>
        <h1 className="title">Begin Workout</h1>
        <p className="subtitle">{activePlan.length} exercises planned</p>
      </header>

     

      {hasCompletedSession && (
        <section className="card stack">
          <p className="muted">Workout complete.</p>
          <button className="button button--accent" onClick={handleBegin}>
            Begin another workout
          </button>
        </section>
      )}

      {error && (
        <section className="card stack">
          <div>
            <p>
              <strong>Error:</strong> {error}
            </p>
          </div>
        </section>
      )}

      <section className="card stack">
        <div className="overflow-x-auto">
          <div className="stack" style={{ minWidth: summaryGridMinWidth }}>
            <div className="grid muted" style={summaryGridStyle}>
              <span>Exercise</span>
              <span style={{ textAlign: "center" }}>Sets</span>
              <span style={{ textAlign: "right" }}>Rest</span>
              <span style={{ textAlign: "right" }}>Progress</span>
            </div>
            <div className="stack">
              {loading && <p className="muted">Loading plan...</p>}
              {!loading && activePlan.length === 0 && (
                <p className="muted">
                  {state?.plan?.length === 0
                    ? "No exercises selected for this session."
                    : `No exercises found for ${selectedDay}.`}
                </p>
              )}
              {!loading &&
                activePlan.map((exercise) => {
                  const restTarget = getRestTarget(exercise);
                  const displayName =
                    catalogMap[exercise.exercise_id]?.exerciseName || exercise.exercise_name;
                  const progress =
                    progressMap.get(exercise.exercise_id) ?? {
                      loggedCount: 0,
                      plannedCount: exercise.plannedSets ?? 0,
                    };
                  const progressLabel = loadingSessionSets
                    ? "..."
                    : getProgressLabel(progress.loggedCount, progress.plannedCount);
                  const targetSet = getTargetSetIndex(
                    progress.loggedCount,
                    progress.plannedCount
                  );
                  const nextHref = sessionId
                    ? `/workout/exercise?exerciseKey=${encodeURIComponent(
                        exercise.exercise_id
                      )}&sessionId=${encodeURIComponent(sessionId)}${
                        targetSet ? `&targetSet=${targetSet}` : ""
                      }`
                    : "";
                  return (
                    <button
                      type="button"
                      className="grid"
                      style={{
                        ...summaryGridStyle,
                        textAlign: "left",
                        background: "none",
                        border: "none",
                        padding: 0,
                        cursor: sessionId ? "pointer" : "default",
                      }}
                      onClick={() => {
                        if (!sessionId) return;
                        router.push(nextHref);
                      }}
                      key={exercise.exercise_id}
                    >
                      <span>{displayName}</span>
                      <span className="muted" style={{ textAlign: "center" }}>
                        {exercise.plannedSets} sets
                      </span>
                      <span className="muted" style={{ textAlign: "right" }}>
                        {loadingRestTargets && !restTargets[exercise.exercise_id]
                          ? "..."
                          : `${restTarget}s`}
                      </span>
                      <span style={{ textAlign: "right" }}>
                        <span className="tag">{progressLabel}</span>
                      </span>
                    </button>
                  );
                })}
            </div>
          </div>
        </div>
      </section>

      <section className="card stack">
        <button
          className="button button--accent"
          onClick={handleBegin}
          disabled={loading || activePlan.length === 0 || !firstExercise}
        >
          {primaryCtaLabel}
        </button>
        <button className="button button--ghost" onClick={() => router.back()}>
          Back
        </button>
      </section>
    </main>
  );
}
