"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { WorkoutSessionState } from "@/lib/workout";

type WorkoutSessionContextValue = {
  state: WorkoutSessionState | null;
  setState: (next: WorkoutSessionState | null) => void;
  updateState: (updater: (prev: WorkoutSessionState) => WorkoutSessionState) => void;
  clear: () => void;
};

const WorkoutSessionContext = createContext<WorkoutSessionContextValue | null>(
  null
);

const STORAGE_KEY = "workout-session";

export const WorkoutSessionProvider = ({ children }: { children: ReactNode }) => {
  const [state, setState] = useState<WorkoutSessionState | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        setState(JSON.parse(stored));
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
    }
  }, []);

  useEffect(() => {
    if (state) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [state]);

  const updateState = useCallback(
    (updater: (prev: WorkoutSessionState) => WorkoutSessionState) => {
      setState((prev) => {
        if (!prev) return prev;
        return updater(prev);
      });
    },
    []
  );

  const clear = useCallback(() => setState(null), []);

  const value = useMemo(
    () => ({ state, setState, updateState, clear }),
    [state, updateState, clear]
  );

  return (
    <WorkoutSessionContext.Provider value={value}>
      {children}
    </WorkoutSessionContext.Provider>
  );
};

export const useWorkoutSession = () => {
  const ctx = useContext(WorkoutSessionContext);
  if (!ctx) {
    throw new Error("useWorkoutSession must be used within WorkoutSessionProvider");
  }
  return ctx;
};
