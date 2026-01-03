"use client";

import { SessionProvider } from "next-auth/react";
import type { ReactNode } from "react";
import { WorkoutSessionProvider } from "@/context/workout-session-context";

type ProvidersProps = {
  children: ReactNode;
};

export default function Providers({ children }: ProvidersProps) {
  return (
    <SessionProvider>
      <WorkoutSessionProvider>{children}</WorkoutSessionProvider>
    </SessionProvider>
  );
}
