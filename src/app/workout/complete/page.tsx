import { Suspense } from "react";
import CompleteClient from "./CompleteClient";

export default function WorkoutCompletePage() {
  return (
    <Suspense
      fallback={
        <main className="page">
          <section className="card">
            <p className="muted">Loading...</p>
          </section>
        </main>
      }
    >
      <CompleteClient />
    </Suspense>
  );
}
