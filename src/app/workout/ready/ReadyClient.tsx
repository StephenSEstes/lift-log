"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useWorkoutSession } from "@/context/workout-session-context";
import type { ExerciseCatalogRow } from "@/lib/workout";

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

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error) return error.message;
  return fallback;
};

export default function ReadyClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { state, updateState } = useWorkoutSession();
  const [exerciseSetup, setExerciseSetup] = useState<ExerciseSetupRow | null>(null);
  const [catalogRow, setCatalogRow] = useState<ExerciseCatalogRow | null>(null);
  const [defaultRestSeconds, setDefaultRestSeconds] = useState("");
  const [setupNotes, setSetupNotes] = useState("");
  const [requiresWeight, setRequiresWeight] = useState(true);
  const [showVideo, setShowVideo] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [hasUserEdited, setHasUserEdited] = useState(false);

  const exerciseKey = (searchParams.get("exerciseKey") ?? "").trim();
  const sessionId = (searchParams.get("sessionId") ?? "").trim();

  const exercise = useMemo(() => {
    if (!state?.plan.length) return null;
    if (exerciseKey) {
      return state.plan.find((item) => item.exercise_id === exerciseKey) ?? null;
    }
    return state.plan[state.currentExerciseIndex] ?? null;
  }, [state, exerciseKey]);

  useEffect(() => {
    if (!state) {
      router.push("/");
      return;
    }

    if (!exerciseKey && state.plan.length > 0) {
      const fallback = state.plan[state.currentExerciseIndex];
      if (fallback) {
        router.replace(
          `/workout/ready?exerciseKey=${encodeURIComponent(
            fallback.exercise_id
          )}&sessionId=${encodeURIComponent(state.sessionId)}`
        );
      }
    }
  }, [state, router, exerciseKey]);

  useEffect(() => {
    if (!state) return;
    if (exerciseKey && !exercise && state.plan.length > 0) {
      router.push("/workout/plan");
    }
  }, [state, exerciseKey, exercise, router]);

  useEffect(() => {
    if (!state || !exerciseKey) return;
    const index = state.plan.findIndex((item) => item.exercise_id === exerciseKey);
    if (index >= 0 && index !== state.currentExerciseIndex) {
      updateState((prev) => ({
        ...prev,
        currentExerciseIndex: index,
        currentSetIndex: 1,
      }));
    }
  }, [state, exerciseKey, updateState]);

  useEffect(() => {
    setSaveMessage(null);
    setHasUserEdited(false);
    setCatalogRow(null);
    setExerciseSetup(null);
  }, [exercise?.exercise_id]);

  useEffect(() => {
    const exerciseId = exercise?.exercise_id;
    if (!exerciseId) return;
    let cancelled = false;

    const loadExerciseSetup = async () => {
      try {
        const response = await fetch(
          `/api/sheets/exercise-setup/get?exerciseKey=${encodeURIComponent(
            exerciseId
          )}`
        );
        const data = (await response.json().catch(() => null)) as
          | { found?: boolean; row?: ExerciseSetupRow }
          | null;
        if (!response.ok || cancelled) return;
        if (data?.found && data.row) {
          setExerciseSetup(data.row);
          return;
        }
      } catch {
        if (cancelled) return;
      }

      if (cancelled) return;
      setExerciseSetup(null);
    };

    loadExerciseSetup();

    return () => {
      cancelled = true;
    };
  }, [exercise?.exercise_id]);

  useEffect(() => {
    const exerciseId = exercise?.exercise_id;
    if (!exerciseId) return;
    const controller = new AbortController();
    let cancelled = false;

    (async () => {
      try {
        const response = await fetch(
          `/api/sheets/exercise-catalog/get?exerciseKey=${encodeURIComponent(
            exerciseId
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
  }, [exercise?.exercise_id]);

  useEffect(() => {
    if (!exercise || hasUserEdited) return;
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

    setDefaultRestSeconds(String(restDefault));
    setSetupNotes(exerciseSetup?.notes ?? "");
    setRequiresWeight(resolvedRequiresWeight);
    updateState((prev) =>
      prev.defaultRestSeconds === restDefault
        ? prev
        : { ...prev, defaultRestSeconds: restDefault }
    );
  }, [exercise, exerciseSetup, catalogRow, hasUserEdited, updateState]);

  if (!state || !exercise) {
    return null;
  }

  const resolvedSessionId = sessionId || state.sessionId;
  const displayName = catalogRow?.exerciseName || exercise.exercise_name;
  const videoUrl = catalogRow?.videoUrl || exercise.youtube_url?.trim();
  const fallbackVideoUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(
    `${displayName} proper form`
  )}`;
  const resolvedVideoUrl = videoUrl || fallbackVideoUrl;

  const handleBegin = () => {
    updateState((prev) => ({
      ...prev,
      currentSetIndex: 1,
    }));
    router.push(
      `/workout/exercise?exerciseKey=${encodeURIComponent(
        exercise.exercise_id
      )}&sessionId=${encodeURIComponent(resolvedSessionId)}`
    );
  };

  const handleSaveSetup = async () => {
    if (!exercise) return;
    const candidate = Number(defaultRestSeconds);
    const normalized =
      Number.isFinite(candidate) && candidate > 0 ? candidate : 120;
    setSaving(true);
    setSaveMessage(null);
    try {
      const resp = await fetch("/api/sheets/exercise-setup/upsert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exerciseKey: exercise.exercise_id,
          defaultRestSeconds: normalized,
          notes: setupNotes,
          requiresWeight,
          setupJson: exerciseSetup?.setupJson ?? "",
        }),
      });
      const payload = await resp.json().catch(() => null);
      if (!resp.ok) {
        throw new Error(payload?.error || "Failed to save setup.");
      }
      const now = new Date().toISOString();
      setExerciseSetup((prev) => ({
        setupId: prev?.setupId ?? "",
        userEmail: prev?.userEmail ?? "",
        exerciseKey: exercise.exercise_id,
        defaultRestSeconds: normalized,
        notes: setupNotes,
        requiresWeight,
        setupJson: prev?.setupJson ?? "",
        createdAt: prev?.createdAt ?? now,
        updatedAt: now,
      }));
      updateState((prev) =>
        prev.defaultRestSeconds === normalized
          ? prev
          : { ...prev, defaultRestSeconds: normalized }
      );
      setSaveMessage("Setup saved.");
    } catch (err: unknown) {
      setSaveMessage(getErrorMessage(err, "Failed to save setup."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="page">
      <header className="page__header">
        <span className="eyebrow">Get Ready</span>
        <h1 className="title">Get Ready</h1>
        <p className="subtitle">{displayName}</p>
      </header>

      <section className="card stack">
        <button className="button button--accent" onClick={handleBegin}>
          Begin
        </button>
        <button
          className="button button--ghost"
          onClick={() => setShowVideo((prev) => !prev)}
        >
          {showVideo ? "Hide Video" : "Show Video"}
        </button>
        <button className="button button--ghost" onClick={() => router.push("/workout/plan")}>
          Back to Setup
        </button>
        {showVideo && (
          <div className="stack">
            <a
              className="button button--ghost"
              href={resolvedVideoUrl}
              target="_blank"
              rel="noreferrer"
            >
              {videoUrl ? "Open Video" : "Search YouTube"}
            </a>
          </div>
        )}
      </section>

      <section className="card stack">
        <h3>Setup</h3>
        <div className="row">
          <div>
            <label className="muted">Default rest (seconds)</label>
            <input
              className="input input--inline"
              type="number"
              inputMode="numeric"
              min={0}
              value={defaultRestSeconds}
              onChange={(event) => {
                setDefaultRestSeconds(event.target.value);
                setHasUserEdited(true);
              }}
              placeholder="120"
            />
          </div>
        </div>
        <div className="stack">
          <label className="muted">Notes</label>
          <input
            className="input"
            type="text"
            value={setupNotes}
            onChange={(event) => {
              setSetupNotes(event.target.value);
              setHasUserEdited(true);
            }}
            placeholder="Rack height, bench settings, cues."
          />
        </div>
        <label className="row">
          <input
            type="checkbox"
            checked={requiresWeight}
            onChange={(event) => {
              setRequiresWeight(event.target.checked);
              setHasUserEdited(true);
            }}
          />
          <span>Requires weight</span>
        </label>
        <button className="button button--accent" onClick={handleSaveSetup} disabled={saving}>
          {saving ? "Saving..." : "Save Setup"}
        </button>
        {saveMessage && <p className="muted">{saveMessage}</p>}
      </section>
    </main>
  );
}
