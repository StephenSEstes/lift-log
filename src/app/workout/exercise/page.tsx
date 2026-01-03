"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useWorkoutSession } from "@/context/workout-session-context";
import type { LoggedSet } from "@/lib/workout";

type HistoryResponse = {
  lastSessionDate: string | null;
  sets: LoggedSet[];
};

const formatElapsed = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

export default function ExerciseExecutionPage() {
  const router = useRouter();
  const { state, updateState } = useWorkoutSession();
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [weight, setWeight] = useState("");
  const [reps, setReps] = useState("");
  const [skipReason, setSkipReason] = useState("");
  const [rpe, setRpe] = useState(7);
  const [isResting, setIsResting] = useState(false);
  const [restSeconds, setRestSeconds] = useState(0);

  const exercise = useMemo(() => {
    if (!state?.plan.length) return null;
    return state.plan[state.currentExerciseIndex] ?? null;
  }, [state?.plan, state?.currentExerciseIndex]);


  const totalSets = exercise?.sets ?? 0;
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
}, [!!state, !!exercise, state?.currentExerciseIndex, state?.plan.length, router]);



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
    if (!history || loadingHistory) return;
    if (weight || reps) return;

    const nonSkipped = history.sets.filter((set) => set.is_skipped !== "TRUE");
    if (!nonSkipped.length) return;

    const match = nonSkipped.find((set) => set.set_number === setNumber) ?? nonSkipped[0];
    if (!match) return;

    setWeight(match.weight ?? "");
    setReps(match.reps ?? "");
  }, [history, loadingHistory, setNumber]);

  useEffect(() => {
    if (!isResting) return;
    const id = window.setInterval(() => {
      setRestSeconds((value) => value + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, [isResting]);

  const resetInputs = () => {
    setWeight("");
    setReps("");
    setSkipReason("");
    setRpe(7);
  };

  const logSet = (isSkipped: boolean) => {
    if (!state || !exercise) return;

    const loggedSet: LoggedSet = {
      session_id: state.sessionId,
      set_timestamp: new Date().toISOString(),
      exercise_id: exercise.exercise_id,
      exercise_name: exercise.exercise_name,
      exercise_order: exercise.exercise_order,
      set_number: setNumber,
      weight: isSkipped ? "" : weight,
      reps: isSkipped ? "" : reps,
      is_skipped: isSkipped ? "TRUE" : "FALSE",
      skip_reason: isSkipped ? skipReason : "",
      rpe: isSkipped ? "" : rpe.toString(),
      notes: "",
    };

    updateState((prev) => {
  const nextSets = [...prev.sets, loggedSet];

  const totalPlannedSets = exercise.sets ?? 0;

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
      setIsResting(true);
      setRestSeconds(0);
    } else {
      router.push("/workout/plan");
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
}, [
  state?.currentExerciseIndex,
  state?.plan.length,
  state?.endTimestamp,
  router,
  updateState,
]);


  if (!exercise || !state) {
    return null;
  }

  const handleSave = () => {
    if (!weight || !reps) return;
    logSet(false);
  };

  const handleSkip = () => {
    logSet(true);
  };

  const lastSessionLabel = history?.lastSessionDate
    ? new Date(history.lastSessionDate).toLocaleDateString()
    : null;

  return (
    <main className="page">
      <header className="page__header">
        <span className="eyebrow">Exercise</span>
        <h1 className="title">{exercise.exercise_name}</h1>
        <p className="subtitle">
          Set {setNumber} of {totalSets}
        </p>
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

      <section className="card stack">
        {isResting ? (
          <>
            <h3>Rest</h3>
            <p className="muted">Resting for {formatElapsed(restSeconds)}</p>
            <button
              className="button button--accent"
              onClick={() => {
                setIsResting(false);
                setRestSeconds(0);
              }}
            >
              Begin Next Set
            </button>
          </>
        ) : (
          <>
            <h3>Log this set</h3>
            <div className="row">
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
              <label className="muted">RPE</label>
              <div className="row">
                <input
                  className="input"
                  type="range"
                  min={1}
                  max={10}
                  step={0.5}
                  value={rpe}
                  onChange={(event) => setRpe(Number(event.target.value))}
                />
                <span>{rpe}</span>
              </div>
            </div>
            <div className="row">
              <button
                className="button button--accent"
                onClick={handleSave}
                disabled={!weight || !reps}
              >
                Save Set
              </button>
              <button className="button button--ghost" onClick={handleSkip}>
                Skip Set
              </button>
            </div>
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
