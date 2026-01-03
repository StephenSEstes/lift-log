"use client";

import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useWorkoutSession } from "@/context/workout-session-context";

export default function ExerciseBeginPage() {
  const router = useRouter();
  const { state, updateState } = useWorkoutSession();

  useEffect(() => {
    if (!state) {
      router.push("/");
      return;
    }

    if (state.currentExerciseIndex >= state.plan.length) {
      router.push("/workout/finish");
    }
  }, [state, router]);

  const exercise = useMemo(() => {
    if (!state?.plan.length) return null;
    return state.plan[state.currentExerciseIndex] ?? null;
  }, [state?.plan, state?.currentExerciseIndex]);

  if (!state || !exercise) {
    return null;
  }

  const exerciseNotes = state.exerciseNotes?.[exercise.exercise_id] ?? "";

  const handleNotesChange = (value: string) => {
    updateState((prev) => ({
      ...prev,
      exerciseNotes: {
        ...(prev.exerciseNotes ?? {}),
        [exercise.exercise_id]: value,
      },
    }));
  };

  const handleBegin = () => {
    updateState((prev) => ({
      ...prev,
      currentSetIndex: 1,
    }));
    router.push("/workout/exercise");
  };

  const handleWatch = () => {
    const url =
      exercise.youtube_url?.trim() ||
      `https://www.youtube.com/results?search_query=${encodeURIComponent(
        `${exercise.exercise_name} proper form`
      )}`;
    window.open(url, "_blank");
  };

  return (
    <main className="page">
      <header className="page__header">
        <span className="eyebrow">Exercise Begin</span>
        <h1 className="title">{exercise.exercise_name}</h1>
        <p className="subtitle">
          {exercise.sets} sets • {exercise.target_rep_min}-{exercise.target_rep_max} reps
        </p>
      </header>

      <section className="card stack">
        <div className="stack">
          <label className="muted">Notes</label>
          <textarea
            className="input"
            value={exerciseNotes}
            onChange={(event) => handleNotesChange(event.target.value)}
            placeholder="Rack/bench setup, cues, etc."
            rows={3}
          />
        </div>
        <button className="button button--accent" onClick={handleBegin}>
          Begin
        </button>
        <button className="button button--ghost" onClick={handleWatch}>
          Watch Video
        </button>
        <button className="button button--ghost" onClick={() => router.push("/")}>
          Back to Setup
        </button>
      </section>
    </main>
  );
}
