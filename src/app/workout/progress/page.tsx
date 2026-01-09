import { Suspense } from "react";
import ProgressClient from "./ProgressClient";

export default function ProgressPage() {
  return (
    <Suspense
      fallback={
        <main className="page">
          <section className="card">
            <p className="muted">Loading progress...</p>
          </section>
        </main>
      }
    >
      <ProgressClient />
    </Suspense>
  );
}
