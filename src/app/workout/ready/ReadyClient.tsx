"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useWorkoutSession } from "@/context/workout-session-context";
import type { ExerciseCatalogRow, LoggedSet } from "@/lib/workout";
import { computeNextSetNumber } from "@/lib/sets";
import InlineBigNumberInput from "@/components/InlineBigNumberInput";

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

type HistoryResponse = {
  sets: LoggedSet[];
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
  const [recentSets, setRecentSets] = useState<LoggedSet[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [defaultRestSeconds, setDefaultRestSeconds] = useState("");
  const [setupNotes, setSetupNotes] = useState("");
  const [requiresWeight, setRequiresWeight] = useState(true);
  const [showVideo, setShowVideo] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [hasUserEdited, setHasUserEdited] = useState(false);
  const [showReturnDialog, setShowReturnDialog] = useState(false);
  const [cleanupError, setCleanupError] = useState<string | null>(null);
  const [cleaning, setCleaning] = useState(false);

  const exerciseKey = (searchParams.get("exerciseKey") ?? "").trim();
  const sessionId = (searchParams.get("sessionId") ?? "").trim();

  const exercise = useMemo(() => {
    if (!state?.plan.length) return null;
    if (exerciseKey) {
      return state.plan.find((item) => item.exercise_id === exerciseKey) ?? null;
    }
    return state.plan[state.currentExerciseIndex] ?? null;
  }, [state, exerciseKey]);

  const plannedSetCount = exercise?.plannedSets ?? 1;

  const loggedSetsForExercise = useMemo(() => {
    if (!state || !exercise) return [];
    return state.sets
      .filter(
        (set) =>
          set.session_id === state.sessionId &&
          set.exercise_id === exercise.exercise_id &&
          set.is_deleted !== "TRUE"
      )
      .map((set) => ({ setNumber: set.set_number }));
  }, [exercise, state]);

  const activeSetNumber = useMemo(() => {
    return computeNextSetNumber({
      plannedSetCount,
      loggedSetsForExercise,
    });
  }, [loggedSetsForExercise, plannedSetCount]);

  const draftKey = useMemo(() => {
    if (!exercise) return "";
    return `${exercise.exercise_id}::${activeSetNumber}`;
  }, [exercise, activeSetNumber]);

  const draftWeight = useMemo(() => {
    if (!state?.draftSets || !draftKey) return "";
    return state.draftSets[draftKey]?.weight ?? "";
  }, [draftKey, state?.draftSets]);

  const suggestedWeight = useMemo(() => {
    if (!exercise) return "";
    if (draftWeight) return draftWeight;
    if (loadingHistory) return "";
    const usable = recentSets.filter((set) => set.is_skipped !== "TRUE");
    if (!usable.length) return "";
    const match = usable.find(
      (set) => Number(set.set_number) === activeSetNumber
    );
    return match?.weight ?? usable[0]?.weight ?? "";
  }, [activeSetNumber, draftWeight, exercise, loadingHistory, recentSets]);

  const [readyWeight, setReadyWeight] = useState("");

  useEffect(() => {
    setReadyWeight(suggestedWeight);
  }, [draftKey, suggestedWeight]);

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
    if (!exercise) return;

    const controller = new AbortController();
    let cancelled = false;
    const excludeSessionId = state?.sessionId || sessionId || "";

    const loadHistory = async () => {
      setLoadingHistory(true);
      try {
        const response = await fetch(
          `/api/history?exerciseKey=${encodeURIComponent(
            exercise.exercise_id
          )}&excludeSessionId=${encodeURIComponent(excludeSessionId)}`,
          { signal: controller.signal }
        );
        const data = (await response.json().catch(() => null)) as HistoryResponse | null;
        if (cancelled) return;
        if (!response.ok) {
          setRecentSets([]);
          return;
        }
        setRecentSets(data?.sets ?? []);
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") return;
        if (!cancelled) {
          setRecentSets([]);
        }
      } finally {
        if (!cancelled) setLoadingHistory(false);
      }
    };

    loadHistory();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [exercise, sessionId, state?.sessionId]);

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
  }, [exercise, exerciseSetup, catalogRow, hasUserEdited]);

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

  const handleReturnToPlan = async (removeIncomplete: boolean) => {
    if (!removeIncomplete) {
      setShowReturnDialog(false);
      router.push("/workout/plan");
      return;
    }
    if (!resolvedSessionId) {
      setCleanupError("Missing session. Please return to plan and try again.");
      return;
    }
    setCleaning(true);
    setCleanupError(null);
    try {
      const resp = await fetch("/api/sheets/sets/cleanup-incomplete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: resolvedSessionId }),
      });
      const payload = await resp.json().catch(() => null);
      if (!resp.ok) {
        throw new Error(payload?.error || "Failed to remove incomplete sets.");
      }
      setShowReturnDialog(false);
      router.push("/workout/plan");
    } catch (err: unknown) {
      setCleanupError(getErrorMessage(err, "Failed to remove incomplete sets."));
    } finally {
      setCleaning(false);
    }
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
        <h1 className="title">
          <strong>Get ready for {displayName}</strong>
        </h1>
      </header>

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
        <button className="button button--ghost" onClick={handleSaveSetup} disabled={saving}>
          {saving ? "Saving..." : "Save Setup"}
        </button>
        {saveMessage && <p className="muted">{saveMessage}</p>}
      </section>

      {requiresWeight && (
        <section className="card stack">
          <InlineBigNumberInput
            label="Weight to Load"
            value={readyWeight}
            onChange={(next) => {
              setReadyWeight(next);
              updateState((prev) => {
                if (!prev) return prev;
                const currentDrafts = prev.draftSets ?? {};
                const current = currentDrafts[draftKey] ?? {};
                if ((current.weight ?? "") === next) return prev;
                return {
                  ...prev,
                  draftSets: {
                    ...currentDrafts,
                    [draftKey]: { ...current, weight: next },
                  },
                };
              });
            }}
            className="items-center"
          />
          <p className="muted">Set {activeSetNumber}</p>
        </section>
      )}

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
        <button className="button button--ghost" onClick={() => setShowReturnDialog(true)}>
          Back to Plan
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
      {showReturnDialog && (
        <dialog open className="card stack">
          <h3>Return to plan?</h3>
          <p className="muted">Choose how to handle incomplete sets.</p>
          {cleanupError && <p className="muted">{cleanupError}</p>}
          <div className="row">
            <button
              className="button button--accent"
              onClick={() => handleReturnToPlan(false)}
            >
              Return to Plan (Keep Logs)
            </button>
            <button
              className="button button--ghost"
              onClick={() => handleReturnToPlan(true)}
              disabled={cleaning}
            >
              {cleaning ? "Removing..." : "Return to Plan (Remove Incomplete)"}
            </button>
            <button
              className="button button--ghost"
              onClick={() => {
                setCleanupError(null);
                setShowReturnDialog(false);
              }}
            >
              Cancel
            </button>
          </div>
        </dialog>
      )}
    </main>
  );
}
