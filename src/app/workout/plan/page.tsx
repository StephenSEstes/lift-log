import { Suspense } from "react";
import PlanClient from "./PlanClient";

export default function WorkoutPlanPage() {
  return (
    <Suspense
      fallback={
        <main className="page">
          <section className="card">
            <p className="muted">Loading plan...</p>
          </section>
        </main>
      }
    >
      <PlanClient />
    </Suspense>
  );
}
