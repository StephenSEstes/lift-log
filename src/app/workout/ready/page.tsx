import { Suspense } from "react";
import ReadyClient from "./ReadyClient";

export default function WorkoutReadyPage() {
  return (
    <Suspense
      fallback={
        <main className="page">
          <p className="muted">Loading...</p>
        </main>
      }
    >
      <ReadyClient />
    </Suspense>
  );
}
