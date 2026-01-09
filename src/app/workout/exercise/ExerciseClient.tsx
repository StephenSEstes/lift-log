
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useWorkoutSession } from "@/context/workout-session-context";
import type { ExerciseCatalogRow, LoggedSet } from "@/lib/workout";

type HistoryResponse = {
  lastSessionDate: string | null;
  sets: LoggedSet[];
};

type ExerciseSetupRow = {
  setupId: string;
  userEmail: string;
  exerciseKey: string;
  defaultRestSeconds: number;
  requiresWeight?: boolean;
  notes: string;
  setupJson: string;
  createdAt: string;
  updatedAt: string;
};

type WindowWithWebkitAudioContext = Window & {
  webkitAudioContext?: typeof AudioContext;
};

const formatElapsed = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

const isValidDateValue = (value: string | null | undefined) => {
  if (!value) return false;
  return !Number.isNaN(Date.parse(value));
};

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error) return error.message;
  return fallback;
};

const normalizeRpe = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 5;
};

export default function ExerciseExecutionPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { state, updateState } = useWorkoutSession();
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [exerciseSetup, setExerciseSetup] = useState<ExerciseSetupRow | null>(null);
  const [catalogRow, setCatalogRow] = useState<ExerciseCatalogRow | null>(null);
  const [weight, setWeight] = useState("");
  const [reps, setReps] = useState("");
  const [skipReason, setSkipReason] = useState("");
  const [rpe, setRpe] = useState<number>(5);
  const [isResting, setIsResting] = useState(false);
  const [restSeconds, setRestSeconds] = useState(0);
  const [restTargetSeconds, setRestTargetSeconds] = useState(120);
  const [requiresWeight, setRequiresWeight] = useState(true);
  const [showRpeLegend, setShowRpeLegend] = useState(false);
  const [editingSetId, setEditingSetId] = useState<string | null>(null);
  const [editingSetNumber, setEditingSetNumber] = useState<number | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const restStartRef = useRef<number | null>(null);
  const restBeepedRef = useRef(false);
  const restTargetRef = useRef(120);
  const lastSavedSetIdRef = useRef<string | null>(null);
  const lastRestSecondsRef = useRef(0);
  const skipDefaultRef = useRef(false);
  const appliedTargetRef = useRef(false);

  const exerciseKeyParam = (searchParams.get("exerciseKey") ?? "").trim();
  const sessionIdParam = (searchParams.get("sessionId") ?? "").trim();
  const targetSetParam = useMemo(() => {
    const raw = (searchParams.get("targetSet") ?? "").trim();
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
  }, [searchParams]);

  const exercise = useMemo(() => {
    if (!state?.plan.length) return null;
    if (exerciseKeyParam) {
      return (
        state.plan.find((item) => item.exercise_id === exerciseKeyParam) ??
        state.plan[state.currentExerciseIndex] ??
        null
      );
    }
    return state.plan[state.currentExerciseIndex] ?? null;
  }, [state?.plan, state?.currentExerciseIndex, exerciseKeyParam]);

  useEffect(() => {
    appliedTargetRef.current = false;
  }, [exerciseKeyParam, targetSetParam]);

  useEffect(() => {
    if (!state || !exerciseKeyParam) return;
    const index = state.plan.findIndex((item) => item.exercise_id === exerciseKeyParam);
    if (index < 0 || index === state.currentExerciseIndex) return;
    updateState((prev) => ({
      ...prev,
      currentExerciseIndex: index,
    }));
  }, [state, exerciseKeyParam, updateState]);

  const sessionSets = useMemo(() => {
    if (!state || !exercise) return [];
    return state.sets
      .filter(
        (set) =>
          set.session_id === state.sessionId &&
          set.exercise_id === exercise.exercise_id
      )
      .sort((a, b) => a.set_number - b.set_number);
  }, [state, exercise]);

  useEffect(() => {
    if (!state || !exercise || !targetSetParam || appliedTargetRef.current) return;
    const loggedCount = sessionSets.length;
    if (targetSetParam > loggedCount + 1) return;

    appliedTargetRef.current = true;
    updateState((prev) => {
      if (!prev) return prev;
      const index = prev.plan.findIndex(
        (item) => item.exercise_id === exercise.exercise_id
      );
      return {
        ...prev,
        currentExerciseIndex: index >= 0 ? index : prev.currentExerciseIndex,
        currentSetIndex: targetSetParam,
      };
    });

    if (targetSetParam <= loggedCount) {
      const targetSet =
        sessionSets.find((set) => set.set_number === targetSetParam) ??
        sessionSets[targetSetParam - 1];
      if (targetSet && targetSet.set_id && targetSet.is_skipped !== "TRUE") {
        setEditingSetId(targetSet.set_id);
        setEditingSetNumber(targetSetParam);
        setUpdateError(null);
        if (requiresWeight) {
          setWeight(targetSet.weight ?? "");
        } else {
          setWeight("");
        }
        setReps(targetSet.reps ?? "");
        setRpe(normalizeRpe(targetSet.rpe));
      } else {
        setEditingSetId(null);
        setEditingSetNumber(null);
      }
    } else {
      setEditingSetId(null);
      setEditingSetNumber(null);
    }
  }, [exercise, requiresWeight, sessionSets, state, targetSetParam, updateState]);

  const totalSets = exercise?.plannedSets ?? 0;
  const setNumber = state?.currentSetIndex ?? 1;

  useEffect(() => {
  if (!state) {
    router.push("/");
    return;
  }

  // Only redirect to the plan if we're NOT done with the workout.
  // When currentExerciseIndex >= plan.length, we are finishing and will route to /workout/finish.


  if (!exercise && state.currentExerciseIndex < state.plan.length) {
    router.push("/workout/plan");
  }
  }, [state, exercise, router]);



  useEffect(() => {
    if (!exercise) return;
    const loadHistory = async () => {
      setLoadingHistory(true);
      const response = await fetch(
        `/api/sheets/history?exerciseId=${encodeURIComponent(
          exercise.exercise_id
        )}&exerciseName=${encodeURIComponent(exercise.exercise_name)}`
      );
      const data = (await response.json()) as HistoryResponse;
      setHistory(data);
      setLoadingHistory(false);
    };
    loadHistory();
  }, [exercise]);

  useEffect(() => {
    if (!exercise) return;
    const loadExerciseSetup = async () => {
      const response = await fetch(
        `/api/sheets/exercise-setup/get?exerciseKey=${encodeURIComponent(
          exercise.exercise_id
        )}`
      );
      const data = (await response.json().catch(() => null)) as
        | { found?: boolean; row?: ExerciseSetupRow }
        | null;
      if (!response.ok) return;
      if (data?.found && data.row) {
        setExerciseSetup(data.row);
      } else {
        setExerciseSetup(null);
      }
    };
    loadExerciseSetup();
  }, [exercise]);

  useEffect(() => {
    if (!exercise) return;
    const controller = new AbortController();
    let cancelled = false;

    (async () => {
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
        if (cancelled) return;
        if (response.ok && data?.found && data.row) {
          setCatalogRow(data.row);
          return;
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") return;
      }
      if (!cancelled) {
        setCatalogRow(null);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [exercise]);

  useEffect(() => {
    const setupRest = Number(exerciseSetup?.defaultRestSeconds ?? 0);
    const catalogRest = Number(catalogRow?.defaultRestSeconds ?? 0);
    const restDefault =
      Number.isFinite(setupRest) && setupRest > 0
        ? setupRest
        : Number.isFinite(catalogRest) && catalogRest > 0
        ? catalogRest
        : 120;
    const resolvedRequiresWeight =
      typeof exerciseSetup?.requiresWeight === "boolean"
        ? exerciseSetup.requiresWeight
        : typeof catalogRow?.defaultRequiresWeight === "boolean"
        ? catalogRow.defaultRequiresWeight
        : true;

    setRestTargetSeconds(restDefault);
    restTargetRef.current = restDefault;
    setRequiresWeight(resolvedRequiresWeight);
    if (!resolvedRequiresWeight) {
      setWeight("");
    }
  }, [exerciseSetup, catalogRow]);

  useEffect(() => {
    if (!exercise) return;
    if (skipDefaultRef.current) {
      skipDefaultRef.current = false;
      return;
    }
    if (editingSetId) return;
    if ((requiresWeight && weight) || reps) return;

    const latestSessionSet = [...sessionSets]
      .reverse()
      .find((set) => set.is_skipped !== "TRUE");
    const historySets = loadingHistory ? [] : history?.sets ?? [];
    const latestHistorySet = [...historySets]
      .reverse()
      .find((set) => set.is_skipped !== "TRUE");
    const defaultRepMin = Number(exercise.target_rep_min ?? 0);
    const defaultReps =
      Number.isFinite(defaultRepMin) && defaultRepMin > 0 ? String(defaultRepMin) : "";

    const sourceSet = latestSessionSet ?? latestHistorySet;
    if (sourceSet) {
      if (requiresWeight) {
        setWeight(sourceSet.weight ?? "");
      }
      setReps(sourceSet.reps ?? "");
      return;
    }

    if (!reps && defaultReps) {
      setReps(defaultReps);
    }
  }, [
    exercise,
    editingSetId,
    history,
    loadingHistory,
    reps,
    requiresWeight,
    sessionSets,
    weight,
  ]);

  useEffect(() => {
    if (!isResting) return;
    restBeepedRef.current = false;
    const start = Date.now();
    if (restStartRef.current == null) {
      restStartRef.current = start;
    }
    const initialTarget = restTargetRef.current ?? 120;
    setRestSeconds(initialTarget);

    const id = window.setInterval(() => {
      const startEpoch = restStartRef.current ?? start;
      const elapsed = Math.floor((Date.now() - startEpoch) / 1000);

      const targetSeconds = restTargetRef.current ?? 120;
      const remaining = Math.max(targetSeconds - elapsed, 0);
      const overtime = Math.max(elapsed - targetSeconds, 0);
      setRestSeconds(remaining > 0 ? remaining : overtime);
      if (!restBeepedRef.current && elapsed >= targetSeconds) {
        restBeepedRef.current = true;
        const AudioCtx =
          window.AudioContext ||
          (window as WindowWithWebkitAudioContext).webkitAudioContext;
        if (AudioCtx) {
          const ctx = new AudioCtx();
          const oscillator = ctx.createOscillator();
          const gain = ctx.createGain();
          oscillator.type = "sine";
          oscillator.frequency.value = 880;
          gain.gain.value = 0.15;
          oscillator.connect(gain);
          gain.connect(ctx.destination);
          oscillator.start();
          oscillator.stop(ctx.currentTime + 0.2);
          oscillator.onended = () => ctx.close();
        }
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [isResting]);

  const resetInputs = () => {
    setWeight("");
    setReps("");
    setSkipReason("");
    setRpe(5);
  };

  const logSet = (isSkipped: boolean) => {
    if (!state || !exercise) return;
    const weightValue = requiresWeight ? weight : "";

    const loggedSet: LoggedSet = {
      session_id: state.sessionId,
      set_timestamp: new Date().toISOString(),
      exercise_id: exercise.exercise_id,
      exercise_name: exercise.exercise_name,
      exercise_order: exercise.sortOrder,
      set_number: setNumber,
      weight: isSkipped ? "" : weightValue,
      reps: isSkipped ? "" : reps,
      is_skipped: isSkipped ? "TRUE" : "FALSE",
      skip_reason: isSkipped ? skipReason : "",
      rpe: isSkipped ? "" : rpe,
      rest_seconds: "0",
      rest_target_seconds: restTargetSeconds.toString(),
      notes: "",
    };

    updateState((prev) => {
  const nextSets = [...prev.sets, loggedSet];

  const totalPlannedSets = exercise.plannedSets ?? 0;

  // We just logged `prev.currentSetIndex`
  const isLastSetOfExercise = prev.currentSetIndex >= totalPlannedSets;

  const nextExerciseIndex = isLastSetOfExercise
    ? prev.currentExerciseIndex + 1
    : prev.currentExerciseIndex;

  const nextSetIndex = isLastSetOfExercise
    ? 1
    : prev.currentSetIndex + 1;

  return {
    ...prev,
    sets: nextSets,
    totalSetsLogged: nextSets.length,
    currentSetIndex: nextSetIndex,
    currentExerciseIndex: nextExerciseIndex,
    exercisesCompleted: isLastSetOfExercise
      ? prev.exercisesCompleted + 1
      : prev.exercisesCompleted,
  };
});


    resetInputs();
    if (setNumber < totalSets) {
      const target =
        typeof state?.defaultRestSeconds === "number"
          ? state.defaultRestSeconds
          : 120;
      const nextTarget = Number.isFinite(target) ? Math.max(0, target) : 120;
      setRestTargetSeconds(nextTarget);
      restTargetRef.current = nextTarget;
      setRestSeconds(0);
      setIsResting(true);
    } else {
      const nextExercise = state.plan[state.currentExerciseIndex + 1];
      if (nextExercise) {
        router.push(
          `/workout/ready?exerciseKey=${encodeURIComponent(
            nextExercise.exercise_id
          )}&sessionId=${encodeURIComponent(state.sessionId)}`
        );
      }
    }
  };

  useEffect(() => {
  if (!state) return;

  const done = state.currentExerciseIndex >= state.plan.length;
  if (!done) return;

  // Only set endTimestamp once (idempotent) to avoid infinite update loops
  if (!state.endTimestamp) {
    updateState((prev) => ({
      ...prev,
      endTimestamp: new Date().toISOString(),
    }));
  }

  router.push("/workout/finish");
  }, [state, router, updateState]);

const handleSave = async () => {
  if (!state || !exercise) return;
  const weightValue = requiresWeight ? weight : "";
  setUpdateError(null);

  // Create the local set object first (same as today)
  const loggedSet: LoggedSet = {
    session_id: state.sessionId,
    exercise_id: exercise.exercise_id,
    exercise_name: exercise.exercise_name,
    exercise_order: exercise.sortOrder,
    set_timestamp: new Date().toISOString(),
    set_number: setNumber,
    weight: weightValue,
    reps,
    rpe,
    is_skipped: "FALSE",
    skip_reason: "",
    rest_seconds: String(restTargetSeconds),
    rest_target_seconds: String(restTargetSeconds),
    notes: "",
  };

  try {
    const completedRestSeconds = lastRestSecondsRef.current;

    // Persist to Sheets immediately
    const resp = await fetch("/api/sheets/sets/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: state.sessionId,
        exerciseKey: exercise.exercise_id,
        exerciseName: exercise.exercise_name,
        setNumber,
        weight: weightValue,
        reps,
        rpe,
        restTargetSec: restTargetSeconds,
        RestSeconds: completedRestSeconds,
        notes: "",
      }),
    });

    const payload = await resp.json().catch(() => null);
    if (!resp.ok || !payload?.setId) {
      throw new Error(payload?.error || "Failed to save set to Sheets.");
    }

    loggedSet.set_id = payload.setId;
    lastSavedSetIdRef.current = payload.setId;

    // Update local state (same pattern you already use)
    updateState((prev) => {
      if (!prev) return prev;
      const nextSets = [...prev.sets, loggedSet];

      const totalPlannedSets = exercise.plannedSets ?? 0;
      const isLastSetOfExercise = prev.currentSetIndex >= totalPlannedSets;
      const nextExerciseIndex = isLastSetOfExercise
        ? prev.currentExerciseIndex + 1
        : prev.currentExerciseIndex;
      const nextSetIndex = isLastSetOfExercise ? 1 : prev.currentSetIndex + 1;

      return {
        ...prev,
        sets: nextSets,
        totalSetsLogged: nextSets.length,
        currentSetIndex: nextSetIndex,
        currentExerciseIndex: nextExerciseIndex,
        exercisesCompleted: isLastSetOfExercise
          ? prev.exercisesCompleted + 1
          : prev.exercisesCompleted,
      };
    });

    // Existing behavior: reset inputs + start rest timer
    resetInputs();

    if (setNumber < totalSets) {
      const nextTarget = state.defaultRestSeconds ?? 120;
      setRestTargetSeconds(nextTarget);
      setRestSeconds(0);
      setIsResting(true);
    } else {
      const nextExercise = state.plan[state.currentExerciseIndex + 1];
      if (nextExercise) {
        router.push(
          `/workout/ready?exerciseKey=${encodeURIComponent(
            nextExercise.exercise_id
          )}&sessionId=${encodeURIComponent(state.sessionId)}`
        );
      }
    }
  } catch (e: unknown) {
    // Minimal UX: alert; we can replace later with inline error UI
    alert(getErrorMessage(e, "Could not save set. Please try again."));
  }
};

  const handleUpdateLastSet = async () => {
    if (!state || !exercise) return;
    const weightValue = requiresWeight ? weight : "";

    const targetSetId = editingSetId;
    if (!targetSetId) {
      setUpdateError("Select a set from this session to update.");
      return;
    }

    try {
      setUpdateError(null);
      const completedRestSeconds = lastRestSecondsRef.current;
      const response = await fetch("/api/sheets/sets/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          setId: targetSetId,
          weight: weightValue,
          reps,
          rpe,
          RestSeconds: completedRestSeconds,
          notes: "",
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || "Failed to update set.");
      }

      const updatedTimestamp = new Date().toISOString();
      updateState((prev) => ({
        ...prev,
        sets: prev.sets.map((set) =>
          set.set_id === targetSetId
            ? {
                ...set,
                weight: weightValue,
                reps,
                rpe,
                set_timestamp: updatedTimestamp,
              }
            : set
        ),
      }));
      skipDefaultRef.current = true;
      setEditingSetId(null);
      setEditingSetNumber(null);
    } catch (err: unknown) {
      setUpdateError(getErrorMessage(err, "Failed to update set."));
    }
  };


  const handleSkip = () => {
    logSet(true);
  };

  const lastSessionLabel =
    history?.lastSessionDate && isValidDateValue(history.lastSessionDate)
      ? new Date(history.lastSessionDate).toLocaleDateString()
      : "";
  const lastRpeValue = useMemo(() => {
    if (!history?.sets?.length) return "";
    const match = [...history.sets]
      .reverse()
      .find((set) => (set.rpe ?? "").toString().trim() !== "");
    return match?.rpe?.toString() ?? "";
  }, [history]);
  const rpeDisplay = rpe.toFixed(1);
  const nextSetNumber = sessionSets.length + 1;
  const targetHelper = useMemo(() => {
    if (!targetSetParam) return "";
    if (targetSetParam <= sessionSets.length) {
      return `Viewing: Set ${targetSetParam}`;
    }
    if (targetSetParam === sessionSets.length + 1) {
      return `Next: Set ${targetSetParam}`;
    }
    return "";
  }, [sessionSets.length, targetSetParam]);
  const backSessionId = state?.sessionId || sessionIdParam;
  const backHref = backSessionId
    ? `/workout/plan?sessionId=${encodeURIComponent(backSessionId)}`
    : "/workout/plan";
  if (!exercise || !state) {
    return null;
  }

  const displayName = catalogRow?.exerciseName || exercise.exercise_name;
  const videoUrl = catalogRow?.videoUrl || exercise.youtube_url?.trim();
  const fallbackVideoUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(
    `${displayName} form`
  )}`;
  const resolvedVideoUrl = videoUrl || fallbackVideoUrl;
  const progressHref = `/workout/progress?exerciseKey=${encodeURIComponent(
    exercise.exercise_id
  )}`;

  return (
    <main className="page">
      <header className="page__header">
        <span className="eyebrow">Exercise</span>
        <h1 className="title">{displayName}</h1>
        <p className="subtitle">
          Set {setNumber} of {totalSets}
        </p>
        {targetHelper && <p className="muted">{targetHelper}</p>}
        <button className="button button--ghost" onClick={() => router.push(backHref)}>
          Back to workout plan
        </button>
        <a
          className="button button--ghost"
          href={resolvedVideoUrl}
          target="_blank"
          rel="noreferrer"
        >
          {videoUrl ? "Open Video" : "Search YouTube"}
        </a>
        <button
          className="button button--ghost"
          onClick={() => router.push(progressHref)}
        >
          View Progress
        </button>
      </header>

      <section className="card stack fade-in">
        <h3>Last session</h3>
        {loadingHistory && <p className="muted">Loading history...</p>}
        {!loadingHistory && (!history || history.sets.length === 0) && (
          <p className="muted">No history yet.</p>
        )}
        {!loadingHistory && history && history.sets.length > 0 && (
          <div className="stack">
            <p className="muted">Most recent: {lastSessionLabel}</p>
            {lastRpeValue && <p className="muted">Last RPE: {lastRpeValue}</p>}
            {history.sets.map((set) => (
              <div className="row spaced" key={`${set.session_id}-${set.set_number}`}>
                <span>Set {set.set_number}</span>
                <span className="muted">
                  {set.is_skipped === "TRUE"
                    ? `Skipped (${set.skip_reason || "no reason"})`
                    : `${set.weight || "-"} x ${set.reps || "-"}`}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {sessionSets.length > 0 && (
        <section className="card stack">
          <h3>{displayName ? `This session ${displayName}` : "This session"}</h3>
          {updateError && <p className="muted">{updateError}</p>}
          <div className="stack">
            {sessionSets.map((set, index) => {
              const isSelected = Boolean(set.set_id && set.set_id === editingSetId);
              return (
                <div
                  key={`${set.session_id}-${set.set_number}-${index}`}
                  className={`row spaced ${isSelected ? "card" : ""}`}
                  role={set.set_id && set.is_skipped !== "TRUE" ? "button" : undefined}
                  onClick={() => {
                    if (!set.set_id || set.is_skipped === "TRUE") return;
                    setEditingSetId(set.set_id);
                    setEditingSetNumber(index + 1);
                    setUpdateError(null);
                    if (requiresWeight) {
                      setWeight(set.weight ?? "");
                    } else {
                      setWeight("");
                    }
                    setReps(set.reps ?? "");
                    setRpe(normalizeRpe(set.rpe));
                  }}
                >
                  <span>Set {index + 1}</span>
                  <span className="muted">
                    {set.is_skipped === "TRUE"
                      ? `Skipped (${set.skip_reason || "no reason"})`
                      : `${set.weight || "-"} x ${set.reps || "-"}`}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="card stack">
        {isResting ? (
          <>
            <h3>Rest</h3>
            <p className="muted">
              {restBeepedRef.current
                ? `Overtime +${formatElapsed(restSeconds)}`
                : `Rest ${formatElapsed(restSeconds)} remaining`}
            </p>
            <button
              className="button button--accent"
              onClick={async () => {
                if (!state) return;
                const startEpoch = restStartRef.current;
                const duration = startEpoch
                  ? Math.floor((Date.now() - startEpoch) / 1000)
                  : 0;
                lastRestSecondsRef.current = duration;
                const target = restTargetSeconds;
                updateState((prev) => {
                  const nextSets = [...prev.sets];
                  const lastIndex = nextSets.length - 1;
                  if (lastIndex >= 0) {
                    const lastSet = nextSets[lastIndex];
                    nextSets[lastIndex] = {
                      ...lastSet,
                      rest_seconds: duration.toString(),
                      rest_target_seconds: target.toString(),
                    };
                  }
                  return { ...prev, sets: nextSets };
                });
                try {
                  if (!lastSavedSetIdRef.current) {
                    console.warn("Missing lastSavedSetIdRef; skipping rest update.");
                  } else {
                    await fetch("/api/sheets/sets/update", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        setId: lastSavedSetIdRef.current,
                        restSec: duration,
                        restTargetSec: target,
                      }),
                    });
                  }
                } catch (err) {
                  console.warn("Failed to update rest values in Sheets", err);
                }
                setIsResting(false);
                setRestSeconds(0);
                restStartRef.current = null;
                setEditingSetId(null);
                setEditingSetNumber(null);
                lastSavedSetIdRef.current = null;
              }}
            >
              Begin Next Set
            </button>
          </>
        ) : (
          <>
            <h3>Log this set</h3>
            {editingSetNumber && (
              <p className="muted">Editing: Set {editingSetNumber}</p>
            )}
            <div className="row">
              {requiresWeight && (
                <div>
                  <label className="muted">Weight</label>
                  <input
                    className="input input--inline"
                    type="number"
                    inputMode="decimal"
                    value={weight}
                    onChange={(event) => setWeight(event.target.value)}
                    placeholder="lbs/kg"
                  />
                </div>
              )}
              <div>
                <label className="muted">Reps</label>
                <input
                  className="input input--inline"
                  type="number"
                  inputMode="numeric"
                  value={reps}
                  onChange={(event) => setReps(event.target.value)}
                  placeholder="0"
                />
              </div>
            </div>
            <div className="row spaced">
              <label className="muted">RPE (optional)</label>
              <div className="row" style={{ alignItems: "center", flex: 1 }}>
                <input
                  className="input"
                  type="range"
                  min={1}
                  max={10}
                  step={0.5}
                  value={rpe}
                  onChange={(event) => setRpe(normalizeRpe(event.target.value))}
                  aria-label="RPE"
                  style={{ flex: 1 }}
                />
                <span className="muted" style={{ minWidth: 36, textAlign: "right" }}>
                  {rpeDisplay}
                </span>
              </div>
            </div>
            <button
              type="button"
              className="button button--ghost"
              onClick={() => setShowRpeLegend((prev) => !prev)}
            >
              What&apos;s RPE?
            </button>
            {showRpeLegend && (
              <div className="stack">
                <p className="muted">RPE 10 = Max effort (0 reps left)</p>
                <p className="muted">RPE 9 = 1 rep left</p>
                <p className="muted">RPE 8 = 2 reps left</p>
                <p className="muted">RPE 7 = 3 reps left</p>
                <p className="muted">RPE 6 = 4+ reps left</p>
              </div>
            )}
            <div className="row">
              <button
                className="button button--accent"
                onClick={() => {
                  if (editingSetId) {
                    handleUpdateLastSet();
                  } else {
                    handleSave();
                  }
                }}
                disabled={!reps || (requiresWeight && !weight)}
              >
                {editingSetId
                  ? editingSetNumber
                    ? `Update Set ${editingSetNumber}`
                    : "Update Selected Set"
                  : `Save Set ${nextSetNumber}`}
              </button>
              <button className="button button--ghost" onClick={handleSkip}>
                Skip Set
              </button>
            </div>
            {editingSetId && (
              <button
                className="button button--ghost"
                onClick={() => {
                  setEditingSetId(null);
                  setEditingSetNumber(null);
                  setUpdateError(null);
                    setRpe(5);
                }}
              >
                Clear Selection
              </button>
            )}
            <div className="stack">
              <label className="muted">Skip reason (optional)</label>
              <input
                className="input"
                type="text"
                value={skipReason}
                onChange={(event) => setSkipReason(event.target.value)}
                placeholder="Equipment taken, pain, etc."
              />
            </div>
          </>
        )}
      </section>
    </main>
  );
}
