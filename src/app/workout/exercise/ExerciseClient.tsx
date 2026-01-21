"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useWorkoutSession } from "@/context/workout-session-context";
import type { ExerciseCatalogRow, LoggedSet } from "@/lib/workout";
import { computePrValues } from "@/lib/workout";
import { computeNextSetNumber } from "@/lib/sets";
import InlineBigNumberInput from "@/components/InlineBigNumberInput";

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

const playBeep = () => {
  const AudioCtx =
    window.AudioContext || (window as WindowWithWebkitAudioContext).webkitAudioContext;
  if (!AudioCtx) return;

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
};

export default function ExerciseExecutionPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { state, updateState } = useWorkoutSession();

  const [recentSets, setRecentSets] = useState<LoggedSet[]>([]);
  const [lastSessionDate, setLastSessionDate] = useState<string | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(true);

  const [exerciseSetup, setExerciseSetup] = useState<ExerciseSetupRow | null>(null);
  const [catalogRow, setCatalogRow] = useState<ExerciseCatalogRow | null>(null);

  const [weight, setWeight] = useState("");
  const [reps, setReps] = useState("");
  const [skipReason, setSkipReason] = useState("");

  const [rpe, setRpe] = useState<number>(5);
  const [showRpeLegend, setShowRpeLegend] = useState(false);

  const [requiresWeight, setRequiresWeight] = useState(true);

  const [mode, setMode] = useState<"active" | "rest">("active");
  const [restEndsAtMs, setRestEndsAtMs] = useState<number | null>(null);
  const [restNextSetNumber, setRestNextSetNumber] = useState<number | null>(null);
  const [restSeconds, setRestSeconds] = useState(0);
  const [restTargetSeconds, setRestTargetSeconds] = useState(60);

  const [editingSetId, setEditingSetId] = useState<string | null>(null);
  const [editingSetNumber, setEditingSetNumber] = useState<number | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);

  const restStartRef = useRef<number | null>(null);
  const restBeepedRef = useRef(false);
  const restTargetRef = useRef(60);
  const lastSavedSetIdRef = useRef<string | null>(null);
  const lastRestSecondsRef = useRef(0);
  const skipDefaultRef = useRef(false);
  const appliedTargetRef = useRef(false);
  const appliedDefaultsKeyRef = useRef<string | null>(null);
  const lastDraftKeyRef = useRef<string | null>(null);

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

  const resolvedExerciseKey = useMemo(() => {
    return exerciseKeyParam || exercise?.exercise_id || "";
  }, [exerciseKeyParam, exercise?.exercise_id]);

  // Reset "apply target set" guard when navigation params change
  useEffect(() => {
    appliedTargetRef.current = false;
  }, [exerciseKeyParam, targetSetParam]);

  // Sync currentExerciseIndex from exerciseKey param
  useEffect(() => {
    if (!state || !exerciseKeyParam) return;
    const index = state.plan.findIndex((item) => item.exercise_id === exerciseKeyParam);
    if (index < 0 || index === state.currentExerciseIndex) return;

    updateState((prev) => {
      if (!prev) return prev;
      return { ...prev, currentExerciseIndex: index };
    });
  }, [state, exerciseKeyParam, updateState]);

  const sessionSets = useMemo(() => {
    if (!state || !exercise) return [];
    return state.sets
      .filter(
        (set) => set.session_id === state.sessionId && set.exercise_id === exercise.exercise_id
      )
      .sort((a, b) => a.set_number - b.set_number);
  }, [state, exercise]);

  // Apply deep link targetSet to set selection / edit mode
  useEffect(() => {
    if (!state || !exercise || !targetSetParam || appliedTargetRef.current) return;

    const loggedCount = sessionSets.length;
    if (targetSetParam > loggedCount + 1) return;

    appliedTargetRef.current = true;

    updateState((prev) => {
      if (!prev) return prev;
      const index = prev.plan.findIndex((item) => item.exercise_id === exercise.exercise_id);
      return {
        ...prev,
        currentExerciseIndex: index >= 0 ? index : prev.currentExerciseIndex,
        currentSetIndex: targetSetParam,
      };
    });

    // If targeting an existing set, put UI into edit state
    if (targetSetParam <= loggedCount) {
      const targetSet =
        sessionSets.find((set) => set.set_number === targetSetParam) ??
        sessionSets[targetSetParam - 1];

      if (targetSet?.set_id && targetSet.is_skipped !== "TRUE") {
        setEditingSetId(targetSet.set_id);
        setEditingSetNumber(targetSetParam);
        setUpdateError(null);

        if (requiresWeight) setWeight(targetSet.weight ?? "");
        else setWeight("");

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
  const plannedSetCount = totalSets || 1;
  const activeSetNumber = useMemo(() => {
    return computeNextSetNumber({
      plannedSetCount,
      loggedSetsForExercise: sessionSets.map((set) => ({
        setNumber: set.set_number,
      })),
    });
  }, [plannedSetCount, sessionSets]);
  const displaySetNumber = editingSetNumber ?? activeSetNumber;
  const draftKey = useMemo(() => {
    if (!exercise) return "";
    return `${exercise.exercise_id}::${activeSetNumber}`;
  }, [exercise, activeSetNumber]);
  const draftSet = useMemo(() => {
    if (!state?.draftSets || !draftKey) return null;
    return state.draftSets[draftKey] ?? null;
  }, [state?.draftSets, draftKey]);
  const defaultSet = useMemo(() => {
    if (!exercise) return null;
    const candidates = recentSets.filter((set) => set.is_skipped !== "TRUE");
    if (!candidates.length) return null;
    return (
      candidates.find((set) => Number(set.set_number) === activeSetNumber) ??
      candidates[0] ??
      null
    );
  }, [activeSetNumber, exercise, recentSets]);

  const suggestedWeight = useMemo(() => {
    const draftWeight = draftSet?.weight ?? "";
    if (draftWeight) return draftWeight;
    const match = recentSets.find(
      (set) =>
        set.is_skipped !== "TRUE" && Number(set.set_number) === activeSetNumber
    );
    if (match?.weight) return match.weight ?? "";
    const first = recentSets.find((set) => set.is_skipped !== "TRUE");
    return first?.weight ?? "";
  }, [activeSetNumber, draftSet, recentSets]);

  const pickSuggestedWeightForSet = useCallback(
    (setNo: number): string => {
      if (!exercise) return "";
      const key = `${exercise.exercise_id}::${setNo}`;
      const draft = state?.draftSets?.[key]?.weight;
    if (draft !== undefined && draft !== null && `${draft}`.trim() !== "") {
      return `${draft}`;
    }

    const sameSet = recentSets.find(
      (set) =>
        Number(set.set_number) === setNo &&
        set.weight != null &&
        `${set.weight}`.trim() !== ""
    );
    if (sameSet?.weight != null) return `${sameSet.weight}`;

    const anySet = recentSets.find(
      (set) => set.weight != null && `${set.weight}`.trim() !== ""
    );
    if (anySet?.weight != null) return `${anySet.weight}`;

      return "";
    },
    [exercise, recentSets, state?.draftSets]
  );

  useEffect(() => {
    if (!draftKey || editingSetId) return;
    if (lastDraftKeyRef.current === draftKey) return;
    lastDraftKeyRef.current = draftKey;
    appliedDefaultsKeyRef.current = null;
    setWeight("");
    setReps("");
    setSkipReason("");
    setRpe(5);
  }, [draftKey, editingSetId]);

  // Default inputs from latest matching set number, or latest set for the exercise, or exercise target reps.
  useEffect(() => {
    if (!exercise) return;

    if (skipDefaultRef.current) {
      skipDefaultRef.current = false;
      return;
    }

    if (editingSetId) return;

    if (!draftKey) return;

    const draftWeight = requiresWeight ? (draftSet?.weight ?? "") : "";
    const draftReps = draftSet?.reps ?? "";
    const hasDraft = Boolean(draftWeight) || Boolean(draftReps);

    if (loadingHistory && !hasDraft) return;

    const appliedKey = appliedDefaultsKeyRef.current;
    if (appliedKey === draftKey) return;

    const hasWeight = !requiresWeight || Boolean(weight);
    const hasReps = Boolean(reps);
    const hasDraftWeight = requiresWeight && !weight && Boolean(draftWeight);
    const hasDraftReps = !reps && Boolean(draftReps);

    if (hasDraftWeight && !hasWeight) {
      appliedDefaultsKeyRef.current = draftKey;
      setWeight(draftWeight);
    }
    if (hasDraftReps && !hasReps) {
      appliedDefaultsKeyRef.current = draftKey;
      setReps(draftReps);
    }

    if (requiresWeight && !weight && !hasDraftWeight && suggestedWeight) {
      appliedDefaultsKeyRef.current = draftKey;
      setWeight(suggestedWeight);
    }

    const defaultRepMin = Number(exercise.target_rep_min ?? 0);
    const defaultReps =
      Number.isFinite(defaultRepMin) && defaultRepMin > 0 ? String(defaultRepMin) : "";

    if (defaultSet) {
      if (requiresWeight && !weight && !hasDraftWeight) {
        appliedDefaultsKeyRef.current = draftKey;
        setWeight(defaultSet.weight ?? "");
      }
      if (!reps && !hasDraftReps) {
        appliedDefaultsKeyRef.current = draftKey;
        setReps(defaultSet.reps ?? "");
      }
      return;
    }

    if (!reps && defaultReps) {
      appliedDefaultsKeyRef.current = draftKey;
      setReps(defaultReps);
    }
  }, [
    exercise,
    editingSetId,
    defaultSet,
    reps,
    requiresWeight,
    weight,
    draftSet,
    draftKey,
    loadingHistory,
    suggestedWeight,
  ]);

  // Guard routing when state/exercise missing
  useEffect(() => {
    if (!state) return;

    // Only redirect to the plan if we're NOT done with the workout.
    if (state.plan.length > 0 && !exercise && state.currentExerciseIndex < state.plan.length) {
      router.push("/workout/plan");
    }
  }, [state, exercise, router]);

  // Load exercise history
  useEffect(() => {
    if (!exercise) return;

    const controller = new AbortController();
    let cancelled = false;
    const excludeSessionId = state?.sessionId || sessionIdParam || "";

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
          setLastSessionDate(null);
          return;
        }
        setRecentSets(data?.sets ?? []);
        setLastSessionDate(data?.lastSessionDate ?? null);
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") return;
        if (!cancelled) {
          setRecentSets([]);
          setLastSessionDate(null);
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
  }, [exercise, sessionIdParam, state?.sessionId]);

  // Load exercise setup (per user/exercise)
  useEffect(() => {
    if (!resolvedExerciseKey) {
      setExerciseSetup(null);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    setExerciseSetup(null);

    (async () => {
      try {
        const response = await fetch(
          `/api/sheets/exercise-setup/get?exerciseKey=${encodeURIComponent(
            resolvedExerciseKey
          )}`,
          { signal: controller.signal }
        );
        if (!response.ok) {
          if (!cancelled) {
            setExerciseSetup(null);
          }
          return;
        }
        const data = (await response.json().catch(() => null)) as
          | { found?: boolean; row?: ExerciseSetupRow }
          | null;

        if (cancelled) return;

        if (data?.found && data.row) setExerciseSetup(data.row);
        else setExerciseSetup(null);
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") return;
        if (!cancelled) setExerciseSetup(null);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [resolvedExerciseKey]);

  // Load exercise catalog row (metadata like videoUrl, defaults, requiresWeight, etc.)
  useEffect(() => {
    if (!exercise) return;

    const controller = new AbortController();
    let cancelled = false;

    (async () => {
      try {
        const response = await fetch(
          `/api/sheets/exercise-catalog/get?exerciseKey=${encodeURIComponent(exercise.exercise_id)}`,
          { signal: controller.signal }
        );
        const data = (await response.json().catch(() => null)) as
          | { found?: boolean; row?: ExerciseCatalogRow }
          | null;

        if (cancelled) return;

        if (response.ok && data?.found && data.row) setCatalogRow(data.row);
        else setCatalogRow(null);
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") return;
        if (!cancelled) setCatalogRow(null);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [exercise]);

  // Resolve rest default + requiresWeight from setup and catalog
  useEffect(() => {
    const setupRest = Number(exerciseSetup?.defaultRestSeconds ?? 0);

    const restDefault = Number.isFinite(setupRest) && setupRest > 0 ? setupRest : 60;

    const resolvedRequiresWeight =
      typeof exerciseSetup?.requiresWeight === "boolean"
        ? exerciseSetup.requiresWeight
        : true;

    setRestTargetSeconds(restDefault);
    restTargetRef.current = restDefault;

    setRequiresWeight(resolvedRequiresWeight);
    if (!resolvedRequiresWeight) setWeight("");
  }, [exerciseSetup]);

  useEffect(() => {
    if (!state || !exercise || !draftKey || !requiresWeight || editingSetId) return;
    updateState((prev) => {
      if (!prev) return prev;
      const currentDrafts = prev.draftSets ?? {};
      const current = currentDrafts[draftKey] ?? {};
      if ((current.weight ?? "") === weight) return prev;
      return {
        ...prev,
        draftSets: {
          ...currentDrafts,
          [draftKey]: { ...current, weight },
        },
      };
    });
  }, [draftKey, editingSetId, exercise, requiresWeight, state, updateState, weight]);

  useEffect(() => {
    if (!state || !exercise || !draftKey || editingSetId) return;
    updateState((prev) => {
      if (!prev) return prev;
      const currentDrafts = prev.draftSets ?? {};
      const current = currentDrafts[draftKey] ?? {};
      if ((current.reps ?? "") === reps) return prev;
      return {
        ...prev,
        draftSets: {
          ...currentDrafts,
          [draftKey]: { ...current, reps },
        },
      };
    });
  }, [draftKey, editingSetId, exercise, reps, state, updateState]);

  // Rest timer
  useEffect(() => {
    if (mode !== "rest" || !restEndsAtMs) return;

    restBeepedRef.current = false;

    const targetSeconds = restTargetRef.current ?? 60;
    const tick = () => {
      const remaining = Math.max(
        Math.ceil((restEndsAtMs - Date.now()) / 1000),
        0
      );
      setRestSeconds(remaining);

      if (!restBeepedRef.current && remaining <= 0) {
        restBeepedRef.current = true;
        playBeep();
      }
    };

    tick();
    const id = window.setInterval(tick, 1000);

    return () => window.clearInterval(id);
  }, [mode, restEndsAtMs]);

  const resetInputs = () => {
    setWeight("");
    setReps("");
    setSkipReason("");
    setRpe(5);
  };

  // When workout is complete, set endTimestamp once and route to finish
  useEffect(() => {
    if (!state) return;

    const done = state.currentExerciseIndex >= state.plan.length;
    if (!done) return;

    if (!state.endTimestamp) {
      updateState((prev) => {
        if (!prev) return prev;
        if (prev.endTimestamp) return prev;
        return { ...prev, endTimestamp: new Date().toISOString() };
      });
    }

    router.push("/workout/finish");
  }, [state, router, updateState]);

  const handleSave = async () => {
    if (!state || !exercise) return;

    const weightValue = requiresWeight ? weight : "";
    setUpdateError(null);

    const loggedSet: LoggedSet = {
      session_id: state.sessionId,
      exercise_id: exercise.exercise_id,
      exercise_name: exercise.exercise_name,
      exercise_order: exercise.sortOrder,
      set_timestamp: new Date().toISOString(),
      set_number: activeSetNumber,
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

      const resp = await fetch("/api/sheets/sets/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: state.sessionId,
          exerciseKey: exercise.exercise_id,
          exerciseName: exercise.exercise_name,
          setNumber: activeSetNumber,
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
          exercisesCompleted: isLastSetOfExercise ? prev.exercisesCompleted + 1 : prev.exercisesCompleted,
        };
      });

      resetInputs();

      if (activeSetNumber < totalSets) {
        const nextTarget = restTargetRef.current ?? restTargetSeconds ?? 60;
        const nextSet = Math.min(totalSets, activeSetNumber + 1);
        setRestTargetSeconds(nextTarget);
        restTargetRef.current = nextTarget;
        setRestNextSetNumber(nextSet);
        setRestEndsAtMs(Date.now() + nextTarget * 1000);
        restStartRef.current = Date.now();
        setRestSeconds(nextTarget);
        setMode("rest");
        // Note: rest overlay replaces any dedicated rest route navigation (if previously used).
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
      alert(getErrorMessage(e, "Could not save set. Please try again."));
    }
  };

  const handleUpdateSelectedSet = async () => {
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
      updateState((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          sets: prev.sets.map((set) =>
            set.set_id === targetSetId
              ? { ...set, weight: weightValue, reps, rpe, set_timestamp: updatedTimestamp }
              : set
          ),
        };
      });

      skipDefaultRef.current = true;
      setEditingSetId(null);
      setEditingSetNumber(null);
    } catch (err: unknown) {
      setUpdateError(getErrorMessage(err, "Failed to update set."));
    }
  };

  const handleSkip = () => {
    // Note: current behavior only advances locally (no Sheets write) — preserving your existing semantics.
    if (!state || !exercise) return;

    const skippedSet: LoggedSet = {
      session_id: state.sessionId,
      set_timestamp: new Date().toISOString(),
      exercise_id: exercise.exercise_id,
      exercise_name: exercise.exercise_name,
      exercise_order: exercise.sortOrder,
      set_number: activeSetNumber,
      weight: "",
      reps: "",
      is_skipped: "TRUE",
      skip_reason: skipReason,
      rpe: "",
      rest_seconds: "0",
      rest_target_seconds: String(restTargetSeconds),
      notes: "",
    };

    updateState((prev) => {
      if (!prev) return prev;

      const nextSets = [...prev.sets, skippedSet];
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
        exercisesCompleted: isLastSetOfExercise ? prev.exercisesCompleted + 1 : prev.exercisesCompleted,
      };
    });

    resetInputs();

    if (activeSetNumber < totalSets) {
      const nextTarget = restTargetRef.current ?? restTargetSeconds ?? 60;
      const resolved = Number.isFinite(nextTarget) ? Math.max(0, nextTarget) : 120;
      const nextSet = Math.min(totalSets, activeSetNumber + 1);
      setRestTargetSeconds(resolved);
      restTargetRef.current = resolved;
      setRestNextSetNumber(nextSet);
      setRestEndsAtMs(Date.now() + resolved * 1000);
      restStartRef.current = Date.now();
      setRestSeconds(resolved);
      setMode("rest");
      // Note: rest overlay replaces any dedicated rest route navigation (if previously used).
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

  const handleEndRest = async () => {
    if (!state) return;

    const startEpoch = restStartRef.current;
    const duration = startEpoch ? Math.floor((Date.now() - startEpoch) / 1000) : 0;
    lastRestSecondsRef.current = duration;

    const target = restTargetSeconds;

    // Update local last set rest values
    updateState((prev) => {
      if (!prev) return prev;

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

    // Persist rest to Sheets for the last saved set (if present)
    try {
      if (lastSavedSetIdRef.current) {
        await fetch("/api/sheets/sets/update", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            setId: lastSavedSetIdRef.current,
            restSec: duration,
            restTargetSec: target,
          }),
        });
      } else {
        console.warn("Missing lastSavedSetIdRef; skipping rest update.");
      }
    } catch (err) {
      console.warn("Failed to update rest values in Sheets", err);
    }

  // Reset rest state
  setMode("active");
  setRestEndsAtMs(null);
  setRestNextSetNumber(null);
  setRestSeconds(0);
  restStartRef.current = null;

    // Clear selection state after rest
    setEditingSetId(null);
    setEditingSetNumber(null);
    lastSavedSetIdRef.current = null;
  };

  const lastRpeValue = useMemo(() => {
    if (!recentSets.length) return "";
    const match = [...recentSets]
      .reverse()
      .find((set) => (set.rpe ?? "").toString().trim() !== "");
    return match?.rpe?.toString() ?? "";
  }, [recentSets]);

  const prValues = useMemo(() => {
    return computePrValues(recentSets);
  }, [recentSets]);

  const targetHelper = useMemo(() => {
    if (!targetSetParam) return "";
    if (targetSetParam <= sessionSets.length) return `Viewing: Set ${targetSetParam}`;
    if (targetSetParam === sessionSets.length + 1) return `Next: Set ${targetSetParam}`;
    return "";
  }, [sessionSets.length, targetSetParam]);

  const setupNotes = exerciseSetup?.notes?.trim() ?? "";
  const showRequiresWeight = typeof exerciseSetup?.requiresWeight === "boolean";

  if (!state) {
    return (
      <main className="page">
        <header className="page__header">
          <span className="eyebrow">Exercise</span>
          <h1 className="title">Loading workout session...</h1>
        </header>
        <section className="card">
          <p className="muted">Getting your workout ready.</p>
        </section>
      </main>
    );
  }

  if (!exercise || state.plan.length === 0) {
    return (
      <main className="page">
        <header className="page__header">
          <span className="eyebrow">Exercise</span>
          <h1 className="title">Loading exercise...</h1>
          {exerciseKeyParam && <p className="subtitle">{exerciseKeyParam}</p>}
        </header>
        <section className="card stack">
          <h3>Setup</h3>
          {exerciseSetup?.defaultRestSeconds ? (
            <p className="muted">Rest: {exerciseSetup.defaultRestSeconds}s</p>
          ) : null}
          {setupNotes && <p className="muted">Notes: {setupNotes}</p>}
          {showRequiresWeight && (
            <p className="muted">
              {exerciseSetup?.requiresWeight ? "Requires weight" : "No weight required"}
            </p>
          )}
          {!exerciseSetup && <p className="muted">No setup saved for this exercise.</p>}
        </section>
      </main>
    );
  }

  const displayName = catalogRow?.exerciseName || exercise.exercise_name;

  const videoUrl = (catalogRow?.videoUrl || exercise.youtube_url || "").trim();
  const fallbackVideoUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(
    `${displayName} form`
  )}`;
  const resolvedVideoUrl = videoUrl || fallbackVideoUrl;

  const progressHref = `/workout/progress?exerciseKey=${encodeURIComponent(exercise.exercise_id)}`;

  const backSessionId = state.sessionId || sessionIdParam;
  const backHref = backSessionId
    ? `/workout/plan?sessionId=${encodeURIComponent(backSessionId)}`
    : "/workout/plan";

  const lastSessionLabel =
    lastSessionDate && isValidDateValue(lastSessionDate)
      ? new Date(lastSessionDate).toLocaleDateString()
      : "";

  const showDebug = (searchParams.get("debug") ?? "").trim() === "1";
  const debugHistoryLine = useMemo(() => {
    if (!showDebug) return "";
    const first = recentSets[0];
    const firstSetNumber = first ? Number(first.set_number || 0) : 0;
    const firstWeight = first?.weight ?? "-";
    return `History: ${recentSets.length} sets (first: set ${
      firstSetNumber || "-"
    } @ ${firstWeight || "-"})`;
  }, [recentSets, showDebug]);

  const rpeDisplay = rpe.toFixed(1);
  const nextSetNumber = activeSetNumber;
  const overlaySetNumber = restNextSetNumber ?? activeSetNumber;
  const overlayDraftKey = exercise ? `${exercise.exercise_id}::${overlaySetNumber}` : "";
  const overlayWeightValue = useMemo(() => {
    if (!exercise) return "";
    const draftValue = state?.draftSets?.[overlayDraftKey]?.weight ?? "";
    if (draftValue) return `${draftValue}`;
    return pickSuggestedWeightForSet(overlaySetNumber);
  }, [exercise, overlayDraftKey, overlaySetNumber, pickSuggestedWeightForSet, state?.draftSets]);
  return (
    <main className="page pb-24 md:pb-28">
      <header className="page__header">
        <span className="eyebrow">Exercise</span>
        <h1 className="title">{displayName}</h1>
        <p className="subtitle">
          Set {displaySetNumber} of {totalSets}
        </p>

        {targetHelper && <p className="muted">{targetHelper}</p>}
      </header>

      {mode === "rest" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <section className="card stack" style={{ maxWidth: 520, width: "100%" }}>
            <span className="eyebrow">Rest</span>
            <h2 className="title" style={{ fontSize: "2.4rem" }}>
              Get ready for Set {overlaySetNumber}
            </h2>
            <div className="stack" style={{ alignItems: "center" }}>
              <div style={{ fontSize: "4rem", fontWeight: 700, lineHeight: 1 }}>
                {formatElapsed(restSeconds)}
              </div>
              <p className="muted">Remaining</p>
            </div>
            {requiresWeight && (
              <InlineBigNumberInput
                label="Weight to Load"
                value={overlayWeightValue}
                onChange={(next) => {
                  if (!overlayDraftKey) return;
                  updateState((prev) => {
                    if (!prev) return prev;
                    const currentDrafts = prev.draftSets ?? {};
                    const current = currentDrafts[overlayDraftKey] ?? {};
                    if ((current.weight ?? "") === next) return prev;
                    return {
                      ...prev,
                      draftSets: {
                        ...currentDrafts,
                        [overlayDraftKey]: { ...current, weight: next },
                      },
                    };
                  });
                }}
                className="items-center"
              />
            )}
            <button className="button button--accent" onClick={handleEndRest}>
              Begin Next Set
            </button>
          </section>
        </div>
      )}

      {mode === "active" && (
        <section className="card stack">
          <h3>Log this set</h3>

          {editingSetNumber && <p className="muted">Editing: Set {editingSetNumber}</p>}

          {requiresWeight && (
            <InlineBigNumberInput
              label="Weight to Load"
              value={weight}
              onChange={setWeight}
            />
          )}

          <div className="stack" style={{ alignItems: "center" }}>
            <label className="muted">Reps</label>
            <input
              className="input"
              type="number"
              inputMode="numeric"
              value={reps}
              onChange={(event) => setReps(event.target.value)}
              placeholder="0"
              style={{
                fontSize: "3.25rem",
                fontWeight: 700,
                lineHeight: 1.1,
                textAlign: "center",
                padding: "16px 20px",
                maxWidth: 220,
              }}
            />
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
                if (editingSetId) handleUpdateSelectedSet();
                else handleSave();
              }}
              disabled={!reps || (requiresWeight && !weight)}
            >
              {editingSetId
                ? editingSetNumber
                  ? `Update Set ${editingSetNumber}`
                  : "Update Selected Set"
                : `Save ${displayName || "Exercise"} Set ${nextSetNumber}`}
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
        </section>
      )}

      <section className="card fade-in">
        <div
          className="row"
          style={{ alignItems: "flex-start", gap: "16px", flexWrap: "wrap" }}
        >
          <div style={{ flex: "1 1 320px", minWidth: 320 }}>
            <h3>Setup</h3>
            {exerciseSetup?.defaultRestSeconds ? (
              <p className="muted">Rest: {exerciseSetup.defaultRestSeconds}s</p>
            ) : null}
            {setupNotes && <p className="muted">Notes: {setupNotes}</p>}
            {showRequiresWeight && (
              <p className="muted">
                {exerciseSetup?.requiresWeight ? "Requires weight" : "No weight required"}
              </p>
            )}
            {!exerciseSetup && <p className="muted">No setup saved for this exercise.</p>}
          </div>

          <div style={{ flex: "1 1 320px", minWidth: 320 }}>
            <h3>Last session</h3>

            {loadingHistory && <p className="muted">Loading history...</p>}

            {!loadingHistory && recentSets.length === 0 && (
              <p className="muted">No history yet.</p>
            )}

            {!loadingHistory && recentSets.length > 0 && (
              <div className="stack">
                <div className="row spaced">
                  <span className="muted">Most recent</span>
                  <span>{lastSessionLabel || "-"}</span>
                </div>

                <div className="row spaced">
                  <span className="muted">PR Max Weight</span>
                  <span>{prValues.prMaxWeight ?? "-"}</span>
                </div>

                <div className="row spaced">
                  <span className="muted">PR Max Weight × Reps</span>
                  <span>{prValues.prMaxWeightTimesReps ?? "-"}</span>
                </div>

                {lastRpeValue && <p className="muted">Last RPE: {lastRpeValue}</p>}

                {recentSets.length > 0 && (
                  <div className="stack">
                    {recentSets.map((set) => (
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
                {debugHistoryLine && <p className="muted">{debugHistoryLine}</p>}
              </div>
            )}
          </div>
        </div>
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

                    if (requiresWeight) setWeight(set.weight ?? "");
                    else setWeight("");

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

        {/* Sticky footer with primary actions (kept behavior/routing unchanged) */}
        <div
          className="fixed inset-x-0 bottom-0 border-t z-50"
          style={{
            background: "rgba(255,255,255,0.75)",
            backdropFilter: "blur(6px)",
          }}
        >
          <div className="max-w-5xl mx-auto px-4 py-2 md:py-3 flex gap-2 flex-wrap items-center">
            <button
              className="button button--ghost w-full md:w-auto"
              onClick={() => router.push(backHref)}
            >
              Back to workout plan
            </button>

            <button
              type="button"
              className="button button--ghost w-full md:w-auto"
              onClick={() => window.open(resolvedVideoUrl, "_blank", "noreferrer")}
            >
              Video
            </button>

            <button
              className="button button--ghost w-full md:w-auto"
              onClick={() => router.push(progressHref)}
            >
              View Progress
            </button>
          </div>
        </div>
    </main>
  );
}
