"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useWorkoutSession } from "@/context/workout-session-context";

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

type PlanRowModel = {
  exerciseId: string;
  name: string;
  plannedSets: number;
  isSelected: boolean;
  loggedCount: number;
  isComplete: boolean;
  isInProgress: boolean;
  statusLabel: string;
};

export default function PlanClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { state, updateState } = useWorkoutSession();

  const sessionIdParam = (searchParams.get("sessionId") ?? "").trim();
  const sessionId = state?.sessionId || sessionIdParam;

  // Expanded exercise details panels
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // Setup notes editing buffers (per exercise)
  const [setupNotesDraft, setSetupNotesDraft] = useState<Record<string, string>>({});
  const [setupSaving, setSetupSaving] = useState<Record<string, boolean>>({});
  const [setupSaveMsg, setSetupSaveMsg] = useState<Record<string, string | null>>({});

  // Cached setup rows we fetch per exercise
  const [setupRows, setSetupRows] = useState<Record<string, ExerciseSetupRow | null>>({});

  useEffect(() => {
    if (!state) router.push("/");
  }, [state, router]);

  // Helper: count logged sets for an exercise in the current session (exclude deleted)
  const loggedCountByExercise = useMemo(() => {
    if (!state) return {} as Record<string, number>;
    const map: Record<string, number> = {};
    for (const s of state.sets ?? []) {
      if (s.session_id !== state.sessionId) continue;
      if (s.is_deleted === "TRUE") continue;
      const key = s.exercise_id;
      map[key] = (map[key] ?? 0) + 1;
    }
    return map;
  }, [state]);

  // Build rows from the current plan state (hub view)
  const rows: PlanRowModel[] = useMemo(() => {
    if (!state?.plan?.length) return [];
    return state.plan.map((p) => {
      const exerciseId = p.exercise_id;
      const plannedSets = Number(p.plannedSets ?? 1) || 1;
      const isSelected =
        ("isSelected" in p ? (p as { isSelected?: boolean }).isSelected : undefined) !==
        false; // default selected unless explicitly false
      const loggedCount = loggedCountByExercise[exerciseId] ?? 0;

      const isComplete = loggedCount >= plannedSets && plannedSets > 0;
      const isInProgress = loggedCount > 0 && !isComplete;
      const statusLabel = isComplete ? "Complete" : isInProgress ? "In progress" : "Not started";

      return {
        exerciseId,
        name: p.exercise_name,
        plannedSets,
        isSelected,
        loggedCount,
        isComplete,
        isInProgress,
        statusLabel,
      };
    });
  }, [loggedCountByExercise, state?.plan]);

  useEffect(() => {
    if (!state?.plan?.length) return;
    const nextPlan = state.plan.map((p) => {
      const logged = loggedCountByExercise[p.exercise_id] ?? 0;
      const planned = Number(p.plannedSets ?? 1) || 1;
      if (planned < logged) {
        return { ...p, plannedSets: logged };
      }
      return p;
    });
    const changed = nextPlan.some(
      (p, idx) => p.plannedSets !== state.plan[idx]?.plannedSets
    );
    if (changed) {
      updateState((prev) => ({ ...prev, plan: nextPlan }));
    }
  }, [loggedCountByExercise, state?.plan, updateState]);

  const selectedRows = useMemo(() => rows.filter((r) => r.isSelected), [rows]);

  const nextAction = useMemo(() => {
    // First selected exercise that is not complete
    const candidate = selectedRows.find((r) => !r.isComplete);
    if (!candidate) return null;
    const nextSet = Math.min(candidate.plannedSets, candidate.loggedCount + 1);
    return { exerciseId: candidate.exerciseId, nextSet };
  }, [selectedRows]);

  // Load setup notes for exercises (so expanded panel can show/edit current notes)
  useEffect(() => {
    if (!rows.length) return;

    const controller = new AbortController();
    let cancelled = false;

    const loadAll = async () => {
      for (const r of rows) {
        const exerciseKey = r.exerciseId;
        if (setupRows[exerciseKey] !== undefined) continue; // already loaded (including null)

        try {
          const resp = await fetch(
            `/api/sheets/exercise-setup/get?exerciseKey=${encodeURIComponent(exerciseKey)}`,
            { signal: controller.signal }
          );
          const payload = (await resp.json().catch(() => null)) as
            | { found?: boolean; row?: ExerciseSetupRow }
            | null;

          if (cancelled) return;

          if (resp.ok && payload?.found && payload.row) {
            const row = payload.row as ExerciseSetupRow;
            setSetupRows((prev) => ({ ...prev, [exerciseKey]: row }));
            setSetupNotesDraft((prev) => {
              if (prev[exerciseKey] !== undefined) return prev;
              return { ...prev, [exerciseKey]: row.notes ?? "" };
            });
          } else {
            setSetupRows((prev) => ({ ...prev, [exerciseKey]: null }));
            setSetupNotesDraft((prev) => {
              if (prev[exerciseKey] !== undefined) return prev;
              return { ...prev, [exerciseKey]: "" };
            });
          }
        } catch (err: unknown) {
          if (err instanceof Error && err.name === "AbortError") return;
          if (!cancelled) {
            setSetupRows((prev) => ({ ...prev, [exerciseKey]: null }));
            setSetupNotesDraft((prev) => {
              if (prev[exerciseKey] !== undefined) return prev;
              return { ...prev, [exerciseKey]: "" };
            });
          }
        }
      }
    };

    loadAll();

    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.map((r) => r.exerciseId).join("|")]);

  // Constraints enforcement helpers
  const canUncheck = (exerciseId: string) => {
    const logged = loggedCountByExercise[exerciseId] ?? 0;
    return logged === 0;
  };

  const canReduceTo = (exerciseId: string, newPlanned: number) => {
    const logged = loggedCountByExercise[exerciseId] ?? 0;
    return newPlanned >= logged && newPlanned >= 1;
  };

  const setRowSelection = (exerciseId: string, nextSelected: boolean) => {
    updateState((prev) => {
      const nextPlan = prev.plan.map((p) =>
        p.exercise_id === exerciseId ? { ...p, isSelected: nextSelected } : p
      );
      return { ...prev, plan: nextPlan };
    });
  };

  const setRowPlannedSets = (exerciseId: string, nextPlannedSets: number) => {
    updateState((prev) => {
      const nextPlan = prev.plan.map((p) =>
        p.exercise_id === exerciseId ? { ...p, plannedSets: nextPlannedSets } : p
      );
      return { ...prev, plan: nextPlan };
    });
  };

  const handleBeginResume = () => {
    if (!state || !sessionId || !nextAction) return;

    const exerciseKey = nextAction.exerciseId;
    const targetSet = nextAction.nextSet;

    // Ensure currentExerciseIndex aligns with the target exercise
    updateState((prev) => {
      const idx = prev.plan.findIndex((p) => p.exercise_id === exerciseKey);
      return {
        ...prev,
        currentExerciseIndex: idx >= 0 ? idx : prev.currentExerciseIndex,
        currentSetIndex: targetSet,
      };
    });

    router.push(
      `/workout/exercise?exerciseKey=${encodeURIComponent(exerciseKey)}&sessionId=${encodeURIComponent(
        sessionId
      )}&targetSet=${encodeURIComponent(String(targetSet))}`
    );
  };

  const handleOpenExercise = (exerciseId: string) => {
    if (!state || !sessionId) return;

    const row = rows.find((r) => r.exerciseId === exerciseId);
    if (!row) return;

    // If incomplete: open at next incomplete set. If complete: open in edit mode (target last set)
    const targetSet = row.isComplete
      ? row.plannedSets
      : Math.min(row.plannedSets, row.loggedCount + 1);

    updateState((prev) => {
      const idx = prev.plan.findIndex((p) => p.exercise_id === exerciseId);
      return {
        ...prev,
        currentExerciseIndex: idx >= 0 ? idx : prev.currentExerciseIndex,
        currentSetIndex: targetSet,
      };
    });

    router.push(
      `/workout/exercise?exerciseKey=${encodeURIComponent(exerciseId)}&sessionId=${encodeURIComponent(
        sessionId
      )}&targetSet=${encodeURIComponent(String(targetSet))}`
    );
  };

  const handleSaveSetupNotes = async (exerciseId: string) => {
    if (!exerciseId) return;

    const notes = (setupNotesDraft[exerciseId] ?? "").toString();

    setSetupSaving((prev) => ({ ...prev, [exerciseId]: true }));
    setSetupSaveMsg((prev) => ({ ...prev, [exerciseId]: null }));

    try {
      const existing = setupRows[exerciseId];
      const defaultRestSeconds = Number(existing?.defaultRestSeconds ?? 120) || 120;
      const requiresWeight =
        typeof existing?.requiresWeight === "boolean" ? existing.requiresWeight : true;

      const resp = await fetch("/api/sheets/exercise-setup/upsert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exerciseKey: exerciseId,
          defaultRestSeconds,
          notes,
          requiresWeight,
          setupJson: existing?.setupJson ?? "",
        }),
      });

      const payload = await resp.json().catch(() => null);
      if (!resp.ok) throw new Error(payload?.error || "Failed to save setup notes.");

      const now = new Date().toISOString();
      const nextRow: ExerciseSetupRow = {
        setupId: existing?.setupId ?? "",
        userEmail: existing?.userEmail ?? "",
        exerciseKey: exerciseId,
        defaultRestSeconds,
        requiresWeight,
        notes,
        setupJson: existing?.setupJson ?? "",
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };

      setSetupRows((prev) => ({ ...prev, [exerciseId]: nextRow }));
      setSetupSaveMsg((prev) => ({ ...prev, [exerciseId]: "Saved." }));
    } catch (err: unknown) {
      setSetupSaveMsg((prev) => ({
        ...prev,
        [exerciseId]: getErrorMessage(err, "Failed to save setup notes."),
      }));
    } finally {
      setSetupSaving((prev) => ({ ...prev, [exerciseId]: false }));
    }
  };

  if (!state) return null;

  return (
    <main className="page">
      <header className="page__header">
        <span className="eyebrow">Workout Plan</span>
        <h1 className="title">Select exercises and sets</h1>
        <p className="muted">
          This is your hub. Adjust exercises/sets, then begin or resume where you left off.
        </p>
      </header>

      <section className="card stack">
        <div className="row spaced">
          <div className="stack" style={{ gap: 4 }}>
            <strong>Session</strong>
            <span className="muted">{sessionId ? sessionId : "No active session"}</span>
          </div>

          <button
            className="button button--accent"
            onClick={handleBeginResume}
            disabled={!sessionId || !nextAction}
            title={!nextAction ? "All selected exercises are complete." : "Begin / Resume"}
          >
            {nextAction ? "Begin / Resume" : "All Done"}
          </button>
        </div>
      </section>

      <section className="card stack">
        <h3>Exercises</h3>

        {rows.length === 0 && <p className="muted">No exercises in the current plan.</p>}

        {rows.length > 0 && (
          <div className="stack">
            {rows.map((r) => {
              const isExpanded = Boolean(expanded[r.exerciseId]);
              const notesValue = setupNotesDraft[r.exerciseId] ?? "";
              const saveMsg = setupSaveMsg[r.exerciseId];
              const saving = Boolean(setupSaving[r.exerciseId]);

              const disableUncheck = r.isSelected && !canUncheck(r.exerciseId);
              const uncheckTitle = disableUncheck
                ? "You can only uncheck an exercise if no sets have been logged for it."
                : "";

              return (
                <div key={r.exerciseId} className="card stack" style={{ padding: 14 }}>
                  <div className="row spaced" style={{ alignItems: "center", gap: 12 }}>
                    <label className="row" style={{ gap: 10, alignItems: "center" }}>
                      <input
                        type="checkbox"
                        checked={r.isSelected}
                        onChange={(e) => {
                          const next = e.target.checked;
                          if (!next && !canUncheck(r.exerciseId)) return;
                          setRowSelection(r.exerciseId, next);
                        }}
                        disabled={disableUncheck}
                        title={uncheckTitle}
                      />
                      <span style={{ fontWeight: 700 }}>{r.name}</span>
                    </label>

                    <div className="row" style={{ gap: 10, alignItems: "center" }}>
                      <span className="muted">{r.statusLabel}</span>

                      <label className="row" style={{ gap: 8, alignItems: "center" }}>
                        <span className="muted">Sets</span>
                        <select
                          className="input input--inline"
                          value={r.plannedSets}
                          onChange={(e) => {
                            const next = Number(e.target.value);
                            if (!canReduceTo(r.exerciseId, next)) return;
                            setRowPlannedSets(r.exerciseId, next);
                          }}
                          disabled={!r.isSelected}
                          title={
                            r.loggedCount > 0
                              ? `Logged: ${r.loggedCount}. Cannot reduce below logged count.`
                              : "Select planned sets."
                          }
                        >
                          {Array.from({ length: 10 }).map((_, i) => {
                            const v = i + 1;
                            const disabled = !canReduceTo(r.exerciseId, v);
                            return (
                              <option key={v} value={v} disabled={disabled}>
                                {v}
                              </option>
                            );
                          })}
                        </select>
                      </label>

                      <button
                        className="button button--ghost"
                        onClick={() => handleOpenExercise(r.exerciseId)}
                        disabled={!r.isSelected}
                        title={!r.isSelected ? "Select the exercise to open it." : "Open exercise"}
                      >
                        {r.isComplete ? "View / Edit" : r.isInProgress ? "Resume" : "Start"}
                      </button>

                      <button
                        className="button button--ghost"
                        onClick={() =>
                          setExpanded((prev) => ({
                            ...prev,
                            [r.exerciseId]: !Boolean(prev[r.exerciseId]),
                          }))
                        }
                        title="Expand details"
                      >
                        {isExpanded ? "Collapse" : "Expand"}
                      </button>
                    </div>
                  </div>

                  <div className="row spaced">
                    <span className="muted">
                      Logged: {r.loggedCount} / Planned: {r.plannedSets}
                    </span>
                    {disableUncheck && (
                      <span className="muted">Can&apos;t remove after logging sets.</span>
                    )}
                  </div>

                  {isExpanded && (
                    <div className="stack" style={{ gap: 10 }}>
                      <div className="stack">
                        <label className="muted" style={{ fontWeight: 700 }}>
                          Setup Notes
                        </label>
                        <textarea
                          className="input"
                          value={notesValue}
                          onChange={(e) =>
                            setSetupNotesDraft((prev) => ({
                              ...prev,
                              [r.exerciseId]: e.target.value,
                            }))
                          }
                          rows={3}
                          placeholder="Rack height, cues, bench settings, etc."
                        />
                      </div>

                      <div className="row" style={{ gap: 10, alignItems: "center" }}>
                        <button
                          className="button button--ghost"
                          onClick={() => handleSaveSetupNotes(r.exerciseId)}
                          disabled={saving}
                        >
                          {saving ? "Saving..." : "Save Notes"}
                        </button>
                        {saveMsg && <span className="muted">{saveMsg}</span>}
                      </div>

                      <p className="muted">
                        (Future) Additional settings can be added here without cluttering the plan view.
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
