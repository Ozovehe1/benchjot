"use client";
import { useState } from "react";
import { mutate } from "swr";
import { X } from "lucide-react";
import { keys, updateExperiment, useProjects, type ExperimentDetail } from "@/lib/data";
import { useAutosave } from "@/lib/autosave";
import { tagSchema, type Status } from "@/lib/schemas";
import { cn } from "@/lib/format";
import { Input, Label, Select, Textarea } from "../ui";
import { StatusPicker } from "../status";
import { Markdown } from "../markdown";

interface Form {
  title: string;
  hypothesis: string;
  status: Status;
  tags: string[];
  notes: string;
  project_id: string | null;
  started_on: string | null;
  ended_on: string | null;
}

const toForm = (e: ExperimentDetail): Form => ({
  title: e.title,
  hypothesis: e.hypothesis,
  status: e.status,
  tags: e.tags,
  notes: e.notes,
  project_id: e.project_id,
  started_on: e.started_on,
  ended_on: e.ended_on,
});

export function NotesPanel({ experiment }: { experiment: ExperimentDetail }) {
  const [form, setForm] = useState<Form>(() => toForm(experiment));
  const [baseline] = useState(form);
  const { data: projects } = useProjects();
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  useAutosave(
    form,
    async (f) => {
      if (!f.title.trim()) throw new Error("Title can't be empty");
      const updated = await updateExperiment(experiment.id, f);
      const project = projects?.find((p) => p.id === updated.project_id);
      await mutate(
        keys.experiment(experiment.id),
        { ...updated, projects: project ? { id: project.id, name: project.name } : null },
        { revalidate: false },
      );
    },
    { baseline },
  );

  return (
    <div className="space-y-6">
      <div>
        <label htmlFor="exp-title" className="sr-only">
          Title
        </label>
        <textarea
          id="exp-title"
          rows={1}
          value={form.title}
          onChange={(e) => set("title", e.target.value.replace(/\n/g, ""))}
          placeholder="Experiment title"
          maxLength={200}
          className="field-sizing-content w-full resize-none bg-transparent text-2xl font-semibold leading-tight tracking-tight placeholder:text-faint focus:outline-none md:text-[28px]"
        />
        {!form.title.trim() && <p className="mt-1 text-sm text-danger">Give it a title to save changes.</p>}
      </div>

      <section>
        <Label>Status</Label>
        <StatusPicker value={form.status} onChange={(s) => set("status", s)} />
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="exp-project">Project</Label>
          <Select id="exp-project" value={form.project_id ?? ""} onChange={(e) => set("project_id", e.target.value || null)}>
            <option value="">No project</option>
            {projects?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label htmlFor="exp-start">Started</Label>
            <Input id="exp-start" type="date" value={form.started_on ?? ""} onChange={(e) => set("started_on", e.target.value || null)} />
          </div>
          <div>
            <Label htmlFor="exp-end">Ended</Label>
            <Input id="exp-end" type="date" value={form.ended_on ?? ""} onChange={(e) => set("ended_on", e.target.value || null)} />
          </div>
        </div>
      </div>
      {form.started_on && form.ended_on && form.ended_on < form.started_on && (
        <p className="-mt-3 text-sm text-danger">End date is before the start date.</p>
      )}

      <section>
        <Label>Tags</Label>
        <TagInput tags={form.tags} onChange={(t) => set("tags", t)} />
      </section>

      <section>
        <Label htmlFor="exp-hyp">Hypothesis / goal</Label>
        <Textarea
          id="exp-hyp"
          rows={3}
          value={form.hypothesis}
          onChange={(e) => set("hypothesis", e.target.value)}
          placeholder="If I change X, then Y should happen, because…"
          className="field-sizing-content"
        />
      </section>

      <NotesEditor value={form.notes} onChange={(v) => set("notes", v)} />
    </div>
  );
}

function NotesEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [mode, setMode] = useState<"write" | "preview">(value ? "preview" : "write");
  return (
    <section>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[13px] font-medium text-muted">Notes</span>
        <div className="flex rounded-lg bg-surface-2 p-0.5 text-xs" role="tablist" aria-label="Notes mode">
          {(["write", "preview"] as const).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={cn("h-8 rounded-md px-3 capitalize", mode === m ? "bg-surface text-fg shadow-sm" : "text-muted")}
            >
              {m}
            </button>
          ))}
        </div>
      </div>
      {mode === "write" ? (
        <>
          <Textarea
            aria-label="Notes (Markdown)"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={"Observations, results, next steps…\n\nMarkdown and $LaTeX$ supported."}
            className="field-sizing-content min-h-56 font-mono text-[14px] leading-relaxed md:text-[13px]"
          />
          <p className="mt-1.5 text-xs text-faint">Markdown · math with $…$ and $$…$$</p>
        </>
      ) : value.trim() ? (
        <button
          type="button"
          onClick={() => setMode("write")}
          className="block w-full rounded-xl border border-border bg-surface p-4 text-left hover:border-border-strong"
          aria-label="Edit notes"
        >
          <Markdown>{value}</Markdown>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setMode("write")}
          className="block h-24 w-full rounded-xl border border-dashed border-border text-sm text-faint hover:text-muted"
        >
          No notes yet. Tap to write.
        </button>
      )}
    </section>
  );
}

function TagInput({ tags, onChange }: { tags: string[]; onChange: (t: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  function commit(raw: string) {
    const parts = raw.split(/[,\s]+/).map((p) => p.replace(/^#/, "")).filter(Boolean);
    if (!parts.length) return;
    const next = [...tags];
    for (const p of parts) {
      const r = tagSchema.safeParse(p);
      if (!r.success) {
        setError(r.error.issues[0]?.message ?? "Invalid tag");
        return;
      }
      if (!next.includes(r.data)) next.push(r.data);
    }
    setError(null);
    onChange(next.slice(0, 30));
    setDraft("");
  }

  return (
    <div>
      <div className="flex min-h-11 flex-wrap items-center gap-1.5 rounded-xl border border-border bg-surface-2 px-2 py-1.5 focus-within:border-accent">
        {tags.map((t) => (
          <span key={t} className="inline-flex h-8 items-center gap-1 rounded-lg bg-surface-3 pl-2.5 pr-1 font-mono text-[13px]">
            #{t}
            <button
              type="button"
              aria-label={`Remove tag ${t}`}
              onClick={() => onChange(tags.filter((x) => x !== t))}
              className="grid size-7 place-items-center rounded-md text-faint hover:text-fg"
            >
              <X className="size-3.5" />
            </button>
          </span>
        ))}
        <input
          aria-label="Add tag"
          value={draft}
          onChange={(e) => {
            const v = e.target.value;
            if (/[,\s]$/.test(v)) commit(v);
            else setDraft(v);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit(draft);
            } else if (e.key === "Backspace" && !draft && tags.length) onChange(tags.slice(0, -1));
          }}
          onBlur={() => commit(draft)}
          placeholder={tags.length ? "" : "transformer, ablation, mnist…"}
          className="h-8 min-w-24 flex-1 bg-transparent px-1.5 text-fg placeholder:text-faint focus:outline-none"
          autoCapitalize="none"
          autoCorrect="off"
        />
      </div>
      {error && <p className="mt-1 text-sm text-danger">{error}</p>}
    </div>
  );
}
