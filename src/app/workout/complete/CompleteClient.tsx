"use client";

import { useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signOut } from "next-auth/react";

export default function CompleteClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const exerciseKey = useMemo(() => {
    return (searchParams.get("exerciseKey") ?? "").trim();
  }, [searchParams]);

  const progressHref = exerciseKey
    ? `/workout/progress?exerciseKey=${encodeURIComponent(exerciseKey)}`
    : "";

  return (
    <main className="page">
      <header className="page__header">
        <span className="eyebrow">Workout Complete</span>
        <h1 className="title">Congrats on your workout</h1>
        <p className="subtitle">Your workout has been synced.</p>
      </header>

      <section className="card stack">
        <button className="button button--accent" onClick={() => router.push("/workout/plan")}>
          Back to workout plan
        </button>
        <button
          className="button button--ghost"
          onClick={() => signOut({ callbackUrl: "/" })}
        >
          Finish & Sign Out
        </button>
        {progressHref && (
          <button className="button button--ghost" onClick={() => router.push(progressHref)}>
            View progress
          </button>
        )}
      </section>
    </main>
  );
}
