"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Columns2, Copy, Link2, Play, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { deleteRun, saveRun, useRuns } from "@/lib/data";
import { recordToRows, rowsToNumbers, rowsToStrings, type KVRow } from "@/lib/kv";
import { formatNumber } from "@/lib/compare";
import { runInput, firstIssue, type Link, type Run } from "@/lib/schemas";
import { cn, shortDate } from "@/lib/format";
import { Button, EmptyState, ErrorState, IconButton, Input, Label, Skeleton, Textarea } from "../ui";
import { Sheet } from "../sheet";
import { KVEditor } from "./kv-editor";

type Editing = Run | "new" | { copyOf: Run } | null;

export function RunsPanel({ experimentId }: { experimentId: string }) {
  const router = useRouter();
  const { data: runs, error, isLoading, mutate } = useRuns(experimentId);
  const [editing, setEditing] = useState<Editing>(null);
  const [comparing, setComparing] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);

  useEffect(() => {
    if (picked.length === 2) router.push(`/e/${experimentId}/compare?a=${picked[0]}&b=${picked[1]}`);
  }, [picked, experimentId, router]);

  if (error) return <ErrorState error={error} onRetry={() => void mutate()} />;
  if (isLoading || !runs) return <Skeleton className="h-40" />;

  const togglePick = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id].slice(-2)));

  return (
    <div>
      {runs.length === 0 ? (
        <EmptyState
          icon={<Play className="size-5" />}
          title="No runs logged"
          body="A run is one execution: the hyperparameters, environment and seed you used, and the numbers you got. Log two and compare them side by side."
          action={
            <Button variant="primary" onClick={() => setEditing("new")}>
              <Plus className="size-4" /> Log a run
            </Button>
          }
        />
      ) : (
        <>
          <div className="mb-3 flex items-center gap-2">
            <Button variant="primary" size="sm" onClick={() => setEditing("new")} className="h-10 md:h-8">
              <Plus className="size-4" /> Log run
            </Button>
            {runs.length >= 2 && (
              <Button
                size="sm"
                variant={comparing ? "secondary" : "ghost"}
                className={cn("h-10 md:h-8", comparing && "text-accent")}
                onClick={() => {
                  setComparing((c) => !c);
                  setPicked([]);
                }}
              >
                <Columns2 className="size-4" /> {comparing ? "Cancel" : "Compare"}
              </Button>
            )}
          </div>
          {comparing && (
            <p className="mb-3 rounded-xl bg-accent-soft px-3 py-2.5 text-sm text-fg" role="status">
              {picked.length === 0 ? "Pick two runs to compare." : "Pick one more."}
            </p>
          )}
          <ul className="space-y-3">
            {runs.map((r) => (
              <li key={r.id}>
                <RunCard run={r} selectable={comparing} selected={picked.includes(r.id)} onClick={() => (comparing ? togglePick(r.id) : setEditing(r))} />
              </li>
            ))}
          </ul>
        </>
      )}
      <RunSheet experimentId={experimentId} state={editing} onClose={() => setEditing(null)} onDuplicate={(r) => setEditing({ copyOf: r })} />
    </div>
  );
}

function RunCard({ run, onClick, selectable, selected }: { run: Run; onClick: () => void; selectable: boolean; selected: boolean }) {
  const metrics = Object.entries(run.metrics);
  const params = Object.entries(run.params);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selectable ? selected : undefined}
      className={cn(
        "block w-full rounded-2xl border bg-surface p-4 text-left transition-colors active:bg-surface-2",
        selected ? "border-accent ring-2 ring-[var(--ring)]" : "border-border hover:border-border-strong",
      )}
    >
      <div className="flex items-baseline gap-2">
        {selectable && (
          <span
            className={cn(
              "grid size-5 shrink-0 place-items-center self-center rounded-full border text-[11px]",
              selected ? "border-accent bg-accent text-accent-fg" : "border-border-strong",
            )}
            aria-hidden
          >
            {selected ? "✓" : ""}
          </span>
        )}
        <h3 className="min-w-0 flex-1 truncate font-mono text-[14.5px] font-medium">{run.name}</h3>
        <span className="shrink-0 text-xs text-faint">{shortDate(run.ran_at)}</span>
      </div>
      {metrics.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {metrics.slice(0, 6).map(([k, v]) => (
            <span key={k} className="inline-flex items-baseline gap-1.5 rounded-lg bg-surface-2 px-2 py-1">
              <span className="text-[11px] text-faint">{k}</span>
              <span className="font-mono text-[13px] font-semibold tabular-nums text-fg">{formatNumber(v)}</span>
            </span>
          ))}
        </div>
      )}
      {params.length > 0 && (
        <p className="mt-2.5 truncate font-mono text-xs text-muted">
          {params
            .slice(0, 6)
            .map(([k, v]) => `${k}=${v}`)
            .join("  ")}
        </p>
      )}
      {run.outcome && <p className="mt-2 line-clamp-2 text-sm text-muted">{run.outcome}</p>}
    </button>
  );
}

interface RunForm {
  name: string;
  ran_at: string; // datetime-local value
  params: KVRow[];
  env: KVRow[];
  metrics: KVRow[];
  links: Link[];
  outcome: string;
}

const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

const ENV_TEMPLATE: KVRow[] = [
  { key: "python", value: "" },
  { key: "framework", value: "" },
  { key: "hardware", value: "" },
  { key: "seed", value: "" },
];

function emptyForm(): RunForm {
  return {
    name: "",
    ran_at: toLocalInput(new Date().toISOString()),
    params: [{ key: "", value: "" }],
    env: ENV_TEMPLATE,
    metrics: [{ key: "", value: "" }],
    links: [],
    outcome: "",
  };
}

function fromRun(r: Run, copy = false): RunForm {
  return {
    name: copy ? `${r.name} (copy)` : r.name,
    ran_at: toLocalInput(copy ? new Date().toISOString() : r.ran_at),
    params: recordToRows(r.params),
    env: recordToRows(r.env),
    metrics: copy ? [{ key: "", value: "" }] : recordToRows(r.metrics),
    links: copy ? [] : r.links,
    outcome: copy ? "" : r.outcome,
  };
}

function RunSheet({
  experimentId,
  state,
  onClose,
  onDuplicate,
}: {
  experimentId: string;
  state: Editing;
  onClose: () => void;
  onDuplicate: (r: Run) => void;
}) {
  const [form, setForm] = useState<RunForm>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const existing = state && state !== "new" && !("copyOf" in state) ? state : null;

  useEffect(() => {
    if (!state) return;
    setError(null);
    setForm(state === "new" ? emptyForm() : "copyOf" in state ? fromRun(state.copyOf, true) : fromRun(state));
  }, [state]);

  const set = <K extends keyof RunForm>(k: K, v: RunForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const params = rowsToStrings(form.params);
    if (!params.ok) return setError(`Parameters: ${params.error}`);
    const env = rowsToStrings(form.env);
    if (!env.ok) return setError(`Environment: ${env.error}`);
    const metrics = rowsToNumbers(form.metrics);
    if (!metrics.ok) return setError(`Metrics: ${metrics.error}`);
    const parsed = runInput.safeParse({
      name: form.name,
      ran_at: new Date(form.ran_at || Date.now()).toISOString(),
      params: params.value,
      env: env.value,
      metrics: metrics.value,
      links: form.links.filter((l) => l.url.trim()).map((l) => ({ label: l.label.trim(), url: l.url.trim() })),
      outcome: form.outcome,
    });
    if (!parsed.success) return setError(firstIssue(parsed.error));
    setSaving(true);
    try {
      await saveRun(experimentId, parsed.data, existing?.id);
      toast.success(existing ? "Run updated" : "Run logged", { duration: 1200 });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save run");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!existing || !window.confirm(`Delete run “${existing.name}”?`)) return;
    try {
      await deleteRun(existing);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete");
    }
  }

  return (
    <Sheet
      open={state !== null}
      onOpenChange={(o) => !o && onClose()}
      title={existing ? "Edit run" : "Log a run"}
      size="lg"
      footer={
        <div className="space-y-2">
          {error && (
            <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            {existing && (
              <>
                <IconButton label="Delete run" variant="danger" onClick={remove}>
                  <Trash2 className="size-4" />
                </IconButton>
                <IconButton label="Duplicate as new run" variant="secondary" onClick={() => onDuplicate(existing)}>
                  <Copy className="size-4" />
                </IconButton>
              </>
            )}
            <Button type="submit" form="run-form" variant="primary" className="flex-1" loading={saving}>
              {existing ? "Save run" : "Log run"}
            </Button>
          </div>
        </div>
      }
    >
      <form id="run-form" onSubmit={submit} className="space-y-6 pt-2">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <div>
            <Label htmlFor="run-name">Name</Label>
            <Input id="run-name" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. lr=3e-4, warmup 500" className="font-mono" />
          </div>
          <div>
            <Label htmlFor="run-at">Ran at</Label>
            <Input id="run-at" type="datetime-local" value={form.ran_at} onChange={(e) => set("ran_at", e.target.value)} />
          </div>
        </div>
        <KVEditor label="Parameters" rows={form.params} onChange={(r) => set("params", r)} keyPlaceholder="learning_rate" valuePlaceholder="3e-4" />
        <KVEditor label="Metrics" rows={form.metrics} onChange={(r) => set("metrics", r)} keyPlaceholder="val_acc" valuePlaceholder="0.932" numeric />
        <KVEditor label="Environment" rows={form.env} onChange={(r) => set("env", r)} keyPlaceholder="torch" valuePlaceholder="2.5.1 / A100 / seed 42" />
        <LinksEditor links={form.links} onChange={(l) => set("links", l)} />
        <div>
          <Label htmlFor="run-outcome">Outcome</Label>
          <Textarea
            id="run-outcome"
            rows={3}
            value={form.outcome}
            onChange={(e) => set("outcome", e.target.value)}
            placeholder="What happened? Anything surprising?"
            className="field-sizing-content"
          />
        </div>
      </form>
    </Sheet>
  );
}

function LinksEditor({ links, onChange }: { links: Link[]; onChange: (l: Link[]) => void }) {
  const update = (i: number, patch: Partial<Link>) => onChange(links.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const cell =
    "h-11 min-w-0 rounded-lg border border-border bg-surface-2 px-3 text-[14px] text-fg placeholder:text-faint focus:border-accent focus:outline-none md:h-9 md:text-[13px]";
  return (
    <fieldset>
      <legend className="mb-1.5 text-[13px] font-medium text-muted">Links</legend>
      <div className="space-y-2">
        {links.map((l, i) => (
          <div key={i} className="grid grid-cols-[6.5rem_minmax(0,1fr)_auto] items-center gap-2">
            <input aria-label={`Link label ${i + 1}`} value={l.label} onChange={(e) => update(i, { label: e.target.value })} placeholder="W&B" className={cell} />
            <input
              aria-label={`Link URL ${i + 1}`}
              value={l.url}
              onChange={(e) => update(i, { url: e.target.value })}
              placeholder="https://…"
              inputMode="url"
              autoCapitalize="none"
              className={cn(cell, "font-mono")}
            />
            <IconButton label="Remove link" onClick={() => onChange(links.filter((_, j) => j !== i))}>
              <X className="size-4" />
            </IconButton>
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {["Commit", "Dataset", "Paper", "Colab", "W&B"].map((label) => (
          <button
            key={label}
            type="button"
            onClick={() => onChange([...links, { label, url: "" }])}
            className="inline-flex h-9 items-center gap-1 rounded-full border border-border px-3 text-xs text-muted hover:text-fg md:h-8"
          >
            <Link2 className="size-3.5" /> {label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
