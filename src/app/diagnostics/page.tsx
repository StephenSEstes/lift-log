"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { signIn, useSession } from "next-auth/react";

type ApiResult = {
  ok: boolean;
  status: number;
  data: unknown;
};

const formatJson = (value: unknown) => JSON.stringify(value, null, 2);

export default function DiagnosticsPage() {
  const { data: session } = useSession();
  const [meResult, setMeResult] = useState<ApiResult | null>(null);
  const [tabsResult, setTabsResult] = useState<ApiResult | null>(null);
  const [loadingMe, setLoadingMe] = useState(false);
  const [loadingTabs, setLoadingTabs] = useState(false);

  const userEmail = useMemo(() => session?.user?.email ?? "Unknown", [session]);

  const fetchJson = useCallback(async (path: string): Promise<ApiResult> => {
    try {
      const response = await fetch(path);
      const text = await response.text();
      const data = text ? JSON.parse(text) : null;
      return { ok: response.ok, status: response.status, data };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return { ok: false, status: 0, data: { error: message } };
    }
  }, []);

  const loadMe = useCallback(async () => {
    setLoadingMe(true);
    const result = await fetchJson("/api/me");
    setMeResult(result);
    setLoadingMe(false);
  }, [fetchJson]);

  const loadTabs = useCallback(async () => {
    setLoadingTabs(true);
    const result = await fetchJson("/api/sheets/tabs");
    setTabsResult(result);
    setLoadingTabs(false);
  }, [fetchJson]);

  const hasAccessToken = useMemo(() => {
    return !!(meResult?.data as { hasAccessToken?: boolean })?.hasAccessToken;
  }, [meResult]);

  const hasSpreadsheetId = useMemo(() => {
    return !!(meResult?.data as { hasSpreadsheetId?: boolean })?.hasSpreadsheetId;
  }, [meResult]);

  useEffect(() => {
    if (!session) return;
    queueMicrotask(() => {
      void loadMe();
    });
  }, [session, loadMe]);

  if (!session) {
    return (
      <main className="page">
        <header className="page__header">
          <span className="eyebrow">Diagnostics</span>
          <h1 className="title">Environment checks</h1>
          <p className="subtitle">Sign in to run authenticated diagnostics.</p>
        </header>
        <section className="card stack">
          <p className="muted">Sign in with Google to view diagnostics.</p>
          <button className="button button--accent" onClick={() => signIn("google")}>
            Sign in with Google
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="page">
      <header className="page__header">
        <span className="eyebrow">Diagnostics</span>
        <h1 className="title">Environment checks</h1>
        <p className="subtitle">Verify auth, tokens, and Sheets connectivity.</p>
      </header>

      <section className="card grid grid--two">
        <div className="stack">
          <span className="muted">Signed-in user</span>
          <strong>{userEmail}</strong>
        </div>
        <div className="stack">
          <span className="muted">Access token present</span>
          <strong>{hasAccessToken ? "true" : "false"}</strong>
        </div>
        <div className="stack">
          <span className="muted">SPREADSHEET_ID configured</span>
          <strong>{hasSpreadsheetId ? "true" : "false"}</strong>
        </div>
      </section>

      <section className="card stack">
        <div className="row spaced">
          <h3>/api/me</h3>
          <button
            className="button button--ghost"
            onClick={loadMe}
            disabled={loadingMe}
          >
            {loadingMe ? "Loading..." : "Call /api/me"}
          </button>
        </div>
        {meResult ? (
          <>
            <p className="muted">
              Status: {meResult.ok ? "success" : "failure"} ({meResult.status})
            </p>
            <pre className="input" style={{ whiteSpace: "pre-wrap" }}>
              {formatJson(meResult.data)}
            </pre>
          </>
        ) : (
          <p className="muted">Not called yet.</p>
        )}
      </section>

      <section className="card stack">
        <div className="row spaced">
          <h3>/api/sheets/tabs</h3>
          <button
            className="button button--ghost"
            onClick={loadTabs}
            disabled={loadingTabs}
          >
            {loadingTabs ? "Loading..." : "Call /api/sheets/tabs"}
          </button>
        </div>
        {tabsResult ? (
          <>
            <p className="muted">
              Status: {tabsResult.ok ? "success" : "failure"} ({tabsResult.status})
            </p>
            <pre className="input" style={{ whiteSpace: "pre-wrap" }}>
              {formatJson(tabsResult.data)}
            </pre>
          </>
        ) : (
          <p className="muted">Not called yet.</p>
        )}
      </section>
    </main>
  );
}
