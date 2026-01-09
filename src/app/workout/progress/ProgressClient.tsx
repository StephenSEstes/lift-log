"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";

type ProgressSet = {
  setNumber: number;
  weight: number;
  reps: number;
  restSeconds: number;
  rpe: string;
};

type ProgressSession = {
  sessionId: string;
  sessionDate: string;
  sets: ProgressSet[];
  topSetWeight: number;
  totalReps: number;
  totalVolume: number;
};

type ProgressResponse = {
  exerciseKey: string;
  exerciseName: string;
  sessions: ProgressSession[];
  error?: string;
};

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error) return error.message;
  return fallback;
};

const formatDate = (value: string) => {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString();
};

const formatMetric = (value: number) =>
  Number.isFinite(value) ? value.toLocaleString() : "-";

const renderLineChart = (series: { date: string; weight: number; totalReps: number }[]) => {
  const width = 240;
  const height = 120;
  const padding = 16;

  if (!series.length) {
    return (
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Progress chart"
      />
    );
  }

  const weights = series.map((point) => point.weight);
  const max = Math.max(1, ...weights);
  const min = Math.min(...weights);
  const range = Math.max(1, max - min);

  const points = series.map((point, index) => {
    const x =
      padding +
      (series.length === 1 ? 0 : (index / (series.length - 1)) * (width - padding * 2));
    const normalized = (point.weight - min) / range;
    const y = height - padding - normalized * (height - padding * 2);
    return { x, y, weight: point.weight, totalReps: point.totalReps };
  });

  const linePath = points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`)
    .join(" ");

  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Progress chart"
    >
      <path d={linePath} fill="none" stroke="currentColor" strokeWidth="2" />
      {points.map((point, index) => (
        <g key={`point-${index}`}>
          <title>{`${formatDate(series[index]?.date)} • Total reps: ${point.totalReps}`}</title>
          <circle cx={point.x} cy={point.y} r="3" fill="currentColor" />
        </g>
      ))}
    </svg>
  );
};

export default function ProgressClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const exerciseKey = useMemo(() => {
    return (
      searchParams.get("exerciseKey") ??
      searchParams.get("exerciseId") ??
      ""
    ).trim();
  }, [searchParams]);
  const { data: session } = useSession();

  const [data, setData] = useState<ProgressResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session || !exerciseKey) {
      if (!exerciseKey) {
        setError(
          "We couldn't find an exercise to load progress for. Head back to your workout and try again."
        );
      }
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await fetch(
          `/api/sheets/progress/exercise?exerciseKey=${encodeURIComponent(
            exerciseKey
          )}`,
          { signal: controller.signal }
        );
        const payload = (await response.json()) as ProgressResponse;
        if (!response.ok) {
          throw new Error(payload.error || "Failed to load progress.");
        }
        if (cancelled) return;
        setData(payload);
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") return;
        if (cancelled) return;
        setError(getErrorMessage(err, "Failed to load progress."));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [session, exerciseKey]);

  const sessions = data?.sessions ?? [];
  const series = sessions
    .map((entry) => {
      return {
        date: entry.sessionDate,
        weight: entry.topSetWeight,
        totalReps: entry.totalReps,
      };
    })
    .slice()
    .reverse();

  if (!session) {
    return (
      <main className="page">
        <section className="card">
          <p className="muted">Sign in to view progress.</p>
        </section>
      </main>
    );
  }

  if (loading) {
    return (
      <main className="page">
        <section className="card">
          <p className="muted">Loading progress...</p>
        </section>
      </main>
    );
  }

  return (
    <main className="page">
      <header className="page__header">
        <span className="eyebrow">Progress</span>
        <h1 className="title">{data?.exerciseName || "Exercise Progress"}</h1>
        <p className="subtitle">Last four sessions for this exercise.</p>
        <button className="button button--ghost" onClick={() => router.back()}>
          Back
        </button>
      </header>

      {error && (
        <section className="card">
          <p className="muted">{error}</p>
          {!exerciseKey && (
            <Link className="button button--ghost" href="/workout/plan">
              Back to workout
            </Link>
          )}
        </section>
      )}

      {!error && sessions.length === 0 && (
        <section className="card">
          <p className="muted">No progress data found for this exercise.</p>
        </section>
      )}

      {!error && sessions.length > 0 && (
        <section className="stack">
          <section className="card stack">
            <h3>Top set trend</h3>
            {renderLineChart(series)}
            <div className="row spaced">
              {series.map((point, index) => (
                <div key={`series-label-${index}`}>
                  <span className="muted">{formatDate(point.date)}</span>
                  <div>
                    <strong>{point.weight}</strong>
                    <span className="muted"> top</span>
                  </div>
                  <div className="muted">{point.totalReps} total reps</div>
                </div>
              ))}
            </div>
          </section>

          <section className="card stack">
            <h3>Last 4 sessions</h3>
            <div className="stack">
              {sessions.map((entry) => (
                <div className="card stack" key={entry.sessionId}>
                  <div className="row spaced">
                    <strong>{formatDate(entry.sessionDate)}</strong>
                    <span className="muted">{entry.sets.length} sets</span>
                  </div>
                  <div className="row spaced">
                    <span className="muted">Top set: {formatMetric(entry.topSetWeight)}</span>
                    <span className="muted">Total reps: {formatMetric(entry.totalReps)}</span>
                    <span className="muted">Volume: {formatMetric(entry.totalVolume)}</span>
                  </div>
                  <div className="row spaced">
                    <span className="muted">Set</span>
                    <span className="muted">Weight x Reps</span>
                    <span className="muted">RPE</span>
                    <span className="muted">Rest</span>
                  </div>
                  {entry.sets.map((set) => (
                    <div className="row spaced" key={`${entry.sessionId}-${set.setNumber}`}>
                      <span>#{set.setNumber}</span>
                      <span>
                        {set.weight || "-"} x {set.reps || "-"}
                      </span>
                      <span>{set.rpe?.toString().trim() ? set.rpe : "-"}</span>
                      <span>{set.restSeconds ? `${set.restSeconds}s` : "-"}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </section>
        </section>
      )}
    </main>
  );
}
