"use client";
// Settings → Usage: this account's own numbers, each against its limit: AI requests today, AI
// credits this month (one credit is one cent of what the AI request cost), GPU runs today. Read from
// the server for the signed-in account, so another account shows its own. Counts only.
import { Notice, Working } from "../ui";
import { useEffect, useState } from "react";

export type UsageData = {
  ai_own_24h?: number;
  ai_oldest_at?: string | null;
  ai_credits_month?: number;
  ai_month_resets_at?: string;
  server_runs_24h?: number;
  ai_per_day?: number;
  ai_credits_per_month?: number;
  gpu_runs_per_day?: number;
};

const time = (iso: string) => new Date(new Date(iso).getTime() + 86_400_000).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const num = (v: number) => (Number.isInteger(v) ? v.toLocaleString("en") : v.toLocaleString("en", { maximumFractionDigits: 1 }));

function Meter({ label, used, limit, note }: { label: string; used: number; limit: number; note?: string }) {
  const pct = Math.min(100, Math.round((used / Math.max(limit, 1)) * 100));
  return (
    <div>
      <div className="flex items-baseline justify-between gap-4 text-sm">
        <span>{label}</span>
        <span className="font-mono text-[13px] tabular-nums text-muted">
          {num(used)} / {num(limit)}
        </span>
      </div>
      <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={limit} aria-valuenow={used} className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-tint">
        <div className={`h-full rounded-full ${pct >= 100 ? "bg-fail" : "bg-fg/70"}`} style={{ width: `${pct}%` }} />
      </div>
      {note && <p className="mt-1 text-xs text-faint">{note}</p>}
    </div>
  );
}

export function Usage() {
  const [u, setU] = useState<UsageData | null>(null);
  const [failed, setFailed] = useState(false);
  const [tries, setTries] = useState(0);
  useEffect(() => {
    setFailed(false);
    fetch("/api/usage", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<UsageData>) : Promise.reject(new Error(String(r.status)))))
      .then(setU, () => setFailed(true));
  }, [tries]);

  if (failed)
    return (
      <Notice actions={[{ label: "Try again", onClick: () => setTries((n) => n + 1) }]}>Couldn’t load your usage. Check your connection.</Notice>
    );
  if (!u) return <Working label="Loading…" />;
  const perDay = u.ai_per_day ?? 50;
  const used = u.ai_own_24h ?? 0;
  return (
    <div id="usage" className="scroll-mt-20 space-y-5">
      <Meter label="AI requests today" used={used} limit={perDay} note={used >= perDay && u.ai_oldest_at ? `Next one at ${time(u.ai_oldest_at)}` : "Each Assistant step, Fix or picture check is one"} />
      <Meter label="AI credits this month" used={u.ai_credits_month ?? 0} limit={u.ai_credits_per_month ?? 1000} note={u.ai_month_resets_at ? `Renews ${day(u.ai_month_resets_at)} · Haiku uses fewer` : undefined} />
      <Meter label="GPU runs today" used={u.server_runs_24h ?? 0} limit={u.gpu_runs_per_day ?? 10} />
    </div>
  );
}
