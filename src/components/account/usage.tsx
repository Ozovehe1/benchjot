"use client";
// Settings → Usage: what Benchjot has counted for this account in the last 24 hours (AI requests on
// the user's own connection, GPU runs on the server against the day's limit), and a link to
// OpenRouter's own activity page.
// Counts only: no request's content is kept.
import { Notice, Working } from "../ui";
import { useEffect, useState } from "react";
import { aiStatus, type AiStatus } from "@/lib/account/auth";

type UsageData = {
  ai_own_24h?: number;
  ai_own_30d?: number;
  server_runs_24h?: number;
  ai_connected?: boolean;
  gpu_runs_per_day?: number;
};

function Meter({ label, used, limit, note = "" }: { label: string; used: number; limit: number | null; note?: string }) {
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const n = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
  return (
    <div>
      <div className="flex items-baseline justify-between gap-4 text-sm">
        <span>{label}</span>
        <span className="font-mono text-[13px] text-muted">
          {n(used)}
          {limit !== null ? ` of ${n(limit)}` : ""}
          {note}
        </span>
      </div>
      {limit !== null && (
        <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={limit} aria-valuenow={used} className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-tint">
          <div className="h-full rounded-full bg-fg/70" style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

export function Usage() {
  const [u, setU] = useState<UsageData | null>(null);
  const [ai, setAi] = useState<AiStatus>(null);
  const [failed, setFailed] = useState(false);
  const [tries, setTries] = useState(0);
  useEffect(() => {
    setFailed(false);
    fetch("/api/usage")
      .then((r) => (r.ok ? (r.json() as Promise<UsageData>) : Promise.reject(new Error(String(r.status)))))
      .then(setU, () => setFailed(true));
    void aiStatus().then(setAi);
  }, [tries]);

  return (
    <section id="usage" className="scroll-mt-20">
      <p className="text-sm text-faint">The last 24 hours. Benchjot counts requests and runs, never what was in them.</p>
      {failed && (
        <Notice className="mt-3" actions={[{ label: "Try again", onClick: () => setTries((n) => n + 1) }]}>
          Couldn’t load your usage. Check your connection.
        </Notice>
      )}
      {!u && !failed && <Working label="Loading…" className="mt-3" />}
      {u && (
        <div className="mt-4 space-y-4">
          {u.ai_connected ? <Meter label="AI requests on your OpenRouter connection" used={u.ai_own_24h ?? 0} limit={null} note={` today · ${u.ai_own_30d ?? 0} in 30 days`} /> : <p className="text-sm text-muted">AI isn’t connected yet.</p>}
          <Meter label="GPU runs on the server" used={u.server_runs_24h ?? 0} limit={u.gpu_runs_per_day ?? null} />
          {ai && (
            <a href={`https://openrouter.ai/logs?api_key_hash=${ai.keyHash}`} target="_blank" rel="noreferrer noopener" className="inline-flex min-h-12 items-center text-sm underline underline-offset-4">
              See every request on OpenRouter
            </a>
          )}
        </div>
      )}
    </section>
  );
}
