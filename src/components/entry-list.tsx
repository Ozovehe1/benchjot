"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createEntry, createProject, createSnippets, deleteProject, renameProject, useEntries, useProjects } from "@/lib/data";
import { displayTitle, listDate } from "@/lib/format";
import { OUTCOME_FILTER_LABEL, OUTCOME_FILTERS, OUTCOME_LABEL, type OutcomeFilter } from "@/lib/outcome";
import type { Project } from "@/lib/schemas";
import type { CodeFile } from "@/lib/upload";
import { FilePicker } from "./file-picker";
import { Button, Column, OutcomeDot, Segmented, TextButton, TextLink, TopBar } from "./ui";

const row = "flex items-baseline justify-between gap-6 py-4";

/**
 * Home (no project): project rows, then unfiled notes; search covers every note.
 * Project page: that project's notes; new notes are filed in it.
 */
export function EntryList({ project }: { project?: Project }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<OutcomeFilter>("all");
  // Searching or filtering on Home looks across every note, not just the unfiled ones.
  const searching = query.trim() !== "" || outcome !== "all";
  const scope = { ...(project ? { projectId: project.id } : searching ? {} : { unfiled: true }), outcome };
  const { data: entries, error: loadError } = useEntries(query, scope);
  const { data: projects } = useProjects();
  const projectId = project?.id ?? null;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const newEntry = () =>
    run(async () => {
      const entry = await createEntry("", projectId);
      router.push(`/n/${entry.id}`);
    });

  async function newFromFiles(files: CodeFile[]) {
    const entry = await createEntry(files.map((f) => f.filename).join(", ").slice(0, 200), projectId);
    await createSnippets(entry.id, 0, files);
    router.push(`/n/${entry.id}`);
  }

  const newProject = () => {
    const name = window.prompt("Project name");
    if (name?.trim()) void run(async () => void (await createProject(name)));
  };

  const rename = () => {
    const name = project && window.prompt("Rename project", project.name);
    if (project && name?.trim() && name.trim() !== project.name) void run(async () => {
      await renameProject(project.id, name);
      router.refresh();
    });
  };

  const remove = () => {
    if (project && window.confirm(`Delete “${project.name}”? Its notes stay, unfiled.`))
      void run(async () => {
        await deleteProject(project.id);
        router.replace("/");
      });
  };

  const showProjects = !project && !searching;

  return (
    <Column className="pb-16">
      <TopBar
        left={project && <TextLink href="/">All notes</TextLink>}
        right={<TextLink href="/settings">Settings</TextLink>}
      />

      {project && (
        <div className="mt-2 flex items-center justify-between gap-6">
          <h1 className="truncate text-xl font-semibold">{project.name}</h1>
          <div className="flex shrink-0 gap-5">
            <TextButton onClick={rename}>Rename</TextButton>
            <TextButton onClick={remove}>Delete</TextButton>
          </div>
        </div>
      )}

      <div className="mt-3 flex items-center gap-5">
        <Button onClick={newEntry} disabled={busy} className="flex-1 sm:flex-none">
          New note
        </Button>
        <FilePicker label="Upload file" onFiles={newFromFiles} onError={setError} />
      </div>

      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search"
        aria-label="Search"
        className="mt-4 h-12 w-full border-b border-line outline-none focus:border-faint"
      />
      <Segmented
        label="Filter by outcome"
        options={OUTCOME_FILTERS.map((f) => ({ value: f, label: OUTCOME_FILTER_LABEL[f] }))}
        value={outcome}
        onChange={setOutcome}
        className="text-muted"
      />
      {(error || loadError) && (
        <p role="alert" className="py-3 text-sm">
          {error ?? "Could not load notes."}
        </p>
      )}

      {showProjects && (
        <ul aria-label="Projects" className="divide-y divide-line border-b border-line">
          {projects?.map((p) => (
            <li key={p.id}>
              <Link href={`/p/${p.id}`} className={row}>
                <span className="truncate">{p.name}</span>
                <span className="shrink-0 text-xs text-faint">Project</span>
              </Link>
            </li>
          ))}
          <li>
            <TextButton onClick={newProject} disabled={busy}>
              New project
            </TextButton>
          </li>
        </ul>
      )}

      {entries && entries.length === 0 &&
        (searching ? (
          <p className="py-10 text-sm text-muted">Nothing matches.</p>
        ) : (
          <p className="py-10 text-sm text-muted">No notes yet.</p>
        ))}
      <ul aria-label="Notes" className="divide-y divide-line">
        {entries?.map((e) => (
          <li key={e.id}>
            <Link href={`/n/${e.id}`} className={row}>
              <span className={e.title.trim() ? "truncate" : "truncate text-muted"}>{displayTitle(e.title)}</span>
              <span className="flex shrink-0 items-center gap-2 text-xs tabular-nums text-faint">
                {e.outcome && <OutcomeDot outcome={e.outcome} name={OUTCOME_LABEL[e.outcome]} />}
                {listDate(e.updated_at)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Column>
  );
}
