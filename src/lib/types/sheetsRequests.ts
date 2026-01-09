export type CreateSetRequest = {
  sessionId: string;
  exerciseKey: string;
  exerciseName: string;
  exerciseOrder?: number | string;
  setNumber?: number | string;
  weight?: number | string | null;
  reps?: number | string | null;
  rpe?: number | string | null;
  notes?: string | null;
  RestSeconds?: number | string | null;
  restSeconds?: number | string | null;
  restSec?: number | string | null;
  restTargetSec?: number | string | null;
};

export type UpdateSetRequest = {
  setId: string;
  setNumber?: number | string;
  weight?: number | string | null;
  reps?: number | string | null;
  rpe?: number | string | null;
  notes?: string | null;
  RestSeconds?: number | string | null;
  restSeconds?: number | string | null;
  restSec?: number | string | null;
  restTargetSec?: number | string | null;
};

export type CreateSessionRequest = {
  workoutName?: string | null;
  sessionDate?: string | null;
};

export type UpsertExerciseSetupRequest = {
  exerciseKey?: string | null;
  defaultRestSeconds?: number | string | null;
  notes?: string | null;
  setupJson?: string | null;
  requiresWeight?: boolean | string | null;
};
