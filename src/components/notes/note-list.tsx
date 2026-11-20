"use client";
import { SharedWithMe } from "../share/shared-with-me";
import { Fragment, useDeferredValue, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createNote, createProject, createCells, deleteProject, renameProject, useNotes, useNoteDetails, useNoteIndex, useProjects, useRecentlyDeleted, useSearchHits } from "@/lib/data";
import { searchTerms } from "@/lib/data/search";
import type { SearchHit } from "@/lib/notes/search-hit";
import { cn, displayTitle, listDate, listGroup } from "@/lib/ui/format";
import { OUTCOME_FILTER_LABEL, OUTCOME_FILTERS, type OutcomeFilter } from "@/lib/notes/outcome";
import type { NoteListItem, Project } from "@/lib/notes/schemas";
import type { CodeFile } from "@/lib/code/upload";
import { FilePicker } from "../code/file-picker";
import { Button, Column, IconChevron, IconCode, IconFolder, IconPlus, IconSearch, Notice, OutcomeBadge, Segmented, TextButton, TextLink, TopBar } from "../ui";
import { errorFacts, userMessage, userText } from "@/lib/ui/user-message";

/** Rows drawn at a time; more follow as the end of the list comes into view. */
const ROWS_PAGE = 60;
const row = "-mx-4 flex items-start justify-between gap-6 rounded-lg px-4 py-4 transition-colors hover:bg-tint/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg/40";

/**
 * The list in sections, as Apple Notes has it: Pinned first, then by when each note was last
 * edited (Today, Yesterday, Previous 7 days, Previous 30 days, a month, a year). The rows come
 * pinned first, then newest first, so each section is one run of them.
 */
function listSections(rows: readonly NoteListItem[], now = new Date()): { heading: string; rows: NoteListItem[] }[] {
  const out: { heading: string; rows: NoteListItem[] }[] = [];
  for (const r of rows) {
    const heading = r.pinned_at ? "Pinned" : listGroup(r.updated_at, now);
    const last = out.at(-1);
    if (last?.heading === heading) last.rows.push(r);
    else out.push({ heading, rows: [r] });
  }
  return out;
}

/** Placeholder rows in the shape of the list while it loads. */
function ListSkeleton() {
  return (
    <ul aria-hidden className="mt-3 space-y-1">
      {[0, 1, 2, 3].map((i) => (
        <li key={i} className="px-0 py-4">
          <div className="skeleton h-5 w-2/3 rounded-md" />
          <div className="skeleton mt-2.5 h-3.5 w-11/12 rounded" />
          <div className="skeleton mt-3 h-3 w-40 rounded" />
        </li>
      ))}
    </ul>
  );
}

/**
 * Home (no project): project rows, then unfiled notes; search covers every note.
 * Project page: that project's notes; new notes are filed in it.
 */
export function NoteList({ project }: { project?: Project }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<OutcomeFilter>("all");
  const search = useRef<HTMLInputElement>(null);
  // "/" jumps to search (when not already typing somewhere).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey || t?.closest("input, textarea, select, [contenteditable]")) return;
      e.preventDefault();
      search.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  // Searching or filtering on Home looks across every note, not just the unfiled ones.
  const searching = query.trim() !== "" || outcome !== "all";
  const scope = { ...(project ? { projectId: project.id } : searching ? {} : { unfiled: true }), outcome };
  // Typing stays quick on a big account: the list follows the query a moment behind the keys.
  const deferredQuery = useDeferredValue(query);
  const { data: notes, error: loadError, mutate: reload } = useNotes(deferredQuery, scope);
  // Rows are drawn a page at a time: the first ROWS_PAGE, then more as the end comes into view.
  const [shownRows, setShownRows] = useState(ROWS_PAGE);
  const listKey = `${deferredQuery}|${outcome}|${project?.id ?? ""}`;
  const [lastKey, setLastKey] = useState(listKey);
  if (listKey !== lastKey) {
    setLastKey(listKey);
    setShownRows(ROWS_PAGE);
  }
  const more = useRef<HTMLLIElement>(null);
  // Searching: where each shown note matched (the line, and the cell it's in).
  const shownIds = (notes ?? []).slice(0, shownRows).map((e) => e.id);
  const { data: hits } = useSearchHits(deferredQuery, shownIds);
  const hasMore = (notes?.length ?? 0) > shownRows;
  useEffect(() => {
    const el = more.current;
    if (!el || !hasMore) return;
    const io = new IntersectionObserver(([e]) => e?.isIntersecting && setShownRows((n) => n + ROWS_PAGE), { rootMargin: "800px" });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, shownRows]);
  const { data: projects } = useProjects();
  const { data: index } = useNoteIndex();
  const { data: deleted } = useRecentlyDeleted();
  const titleOf = new Map(index?.map((n) => [n.id, displayTitle(n.title)]));
  const projectId = project?.id ?? null;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(userMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const newNote = () =>
    run(async () => {
      const note = await createNote("", projectId);
      router.push(`/n/${note.id}`);
    });

  async function newFromFiles(files: CodeFile[]) {
    const note = await createNote(files.map((f) => f.filename).join(", ").slice(0, 200), projectId);
    await createCells(note.id, 0, files);
    router.push(`/n/${note.id}`);
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

  const details = useNoteDetails(shownIds).data;
  const projectName = new Map(projects?.map((p) => [p.id, p.name]));
  const projectOf = new Map(index?.map((n) => [n.id, n.project_id]));
  const notesIn = new Map<string, number>();
  for (const n of index ?? []) if (n.project_id) notesIn.set(n.project_id, (notesIn.get(n.project_id) ?? 0) + 1);
  const count = notes?.length;

  return (
    <Column className="pb-20">
      <TopBar
        left={project && <TextLink href="/">All notes</TextLink>}
        right={
          <>
            <TextLink href="/map" className="shell-hide min-w-12 justify-center">Map</TextLink>
            <TextLink href="/settings" className="shell-hide">Settings</TextLink>
          </>
        }
      />

      <header className="mt-2 flex flex-wrap items-end justify-between gap-x-6 gap-y-4 lg:mt-8">
        <div className="min-w-0">
          {project && <p className="eyebrow">Project</p>}
          <h1 className="mt-2 truncate text-[34px] font-normal leading-none tracking-[-0.02em] lg:text-[40px]">{project ? project.name : "All notes"}</h1>
          {count !== undefined && (
            <p className="mt-2.5 text-sm text-muted">
              {searching ? `${count} ${count === 1 ? "note matches" : "notes match"}` : project ? `${count} ${count === 1 ? "note" : "notes"}` : `${index?.length ?? count} ${(index?.length ?? count) === 1 ? "note" : "notes"} · ${projects?.length ?? 0} ${projects?.length === 1 ? "project" : "projects"}`}
            </p>
          )}
        </div>
        <div className="flex w-full items-center gap-3 sm:w-auto">
          {project && (
            <>
              <TextButton onClick={rename}>Rename</TextButton>
              <TextButton onClick={remove}>Delete</TextButton>
            </>
          )}
          <FilePicker label="Upload" onFiles={newFromFiles} onError={setError} variant="soft" />
          <Button onClick={newNote} loading={busy} className="flex-1 sm:flex-none">
            <IconPlus />
            New note
          </Button>
        </div>
      </header>

      <div className="mt-7 flex flex-col gap-3 lg:flex-row lg:items-center">
        <label className="relative block flex-1">
          <IconSearch className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-faint" />
          <input
            ref={search}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && (setQuery(""), e.currentTarget.blur())}
            placeholder={project ? `Search ${project.name}` : "Search titles, notes and code"}
            aria-label="Search"
            aria-keyshortcuts="/"
            className="h-12 w-full rounded-xl border border-line bg-tint/40 pl-10 pr-12 outline-none transition-[border-color,background-color] placeholder:text-faint focus:border-faint focus:bg-transparent"
          />
          <kbd aria-hidden className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border border-line px-1.5 font-mono text-[11px] text-faint lg:block">
            /
          </kbd>
        </label>
        <Segmented label="Filter by outcome" options={OUTCOME_FILTERS.map((f) => ({ value: f, label: OUTCOME_FILTER_LABEL[f] }))} value={outcome} onChange={setOutcome} />
      </div>
      {(error || loadError) && (
        <Notice className="my-3" actions={loadError && !error ? [{ label: "Try again", onClick: () => void reload() }] : []} onDismiss={error ? () => setError(null) : undefined}>
          {error ?? userText(errorFacts(loadError), "load_notes")}
        </Notice>
      )}

      {showProjects && (
        <section aria-label="Projects" className="mt-10">
          <h2 className="eyebrow">Projects</h2>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {projects?.map((p) => (
              <li key={p.id}>
                <Link href={`/p/${p.id}`} className="group flex h-full items-center gap-3 rounded-lg border border-line px-4 py-3.5 transition-colors hover:bg-tint/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg/40">
                  <IconFolder className="shrink-0 text-muted" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-display text-[18px] leading-tight text-fg">{p.name}</span>
                    <span className="mt-0.5 block text-xs text-faint">{notesIn.get(p.id) ?? 0} {(notesIn.get(p.id) ?? 0) === 1 ? "note" : "notes"}</span>
                  </span>
                  <IconChevron className="size-4 text-faint group-hover:text-fg" />
                </Link>
              </li>
            ))}
            <li>
              <button type="button" onClick={newProject} disabled={busy} className="flex h-full min-h-12 w-full items-center gap-3 rounded-lg px-4 text-sm text-muted transition-colors hover:bg-tint/50 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg/40">
                <IconPlus />
                New project
              </button>
            </li>
          </ul>
        </section>
      )}

      {showProjects && <SharedWithMe />}

      <section aria-label="Notes" className="mt-10">
        {showProjects && <h2 className="eyebrow">Uncategorized</h2>}
        {notes && notes.length === 0 &&
          (searching ? (
            <p className="py-10 text-sm text-muted">Nothing matches.</p>
          ) : (
            <div className="my-6 py-6 text-sm leading-relaxed text-muted">
              <p className="font-display text-[26px] leading-tight text-fg">{project ? "No notes in this project yet." : "Your first experiment starts here."}</p>
              <p className="mt-2 max-w-[34rem]">
                A note is one experiment: what you expect, the code, its output, and what happened. Start with New note, or Upload to begin from a script or
                notebook you already have.
              </p>
            </div>
          ))}
        {!notes && !loadError && <ListSkeleton />}
        {(searching ? [{ heading: null, rows: notes?.slice(0, shownRows) ?? [] }] : listSections(notes?.slice(0, shownRows) ?? [])).map((section) => (
          <Fragment key={section.heading ?? "all"}>
            {section.heading && <h3 className="eyebrow mt-8 first:mt-3">{section.heading}</h3>}
            <ul className="mt-2 space-y-1">
              {section.rows.map((e) => {
                const d = details?.get(e.id);
                const pid = projectOf.get(e.id);
                const hit = hits?.get(e.id) ?? null;
                return (
                  <li key={e.id}>
                    <Link href={hit?.cellId ? `/n/${e.id}#cell-${hit.cellId}` : `/n/${e.id}`} className={row}>
                      <span className="min-w-0 flex-1">
                        <span className={e.title.trim() ? "block truncate font-display text-[19px] leading-snug text-fg" : "block truncate font-display text-[19px] italic leading-snug text-muted"}>
                          {e.parent_id && titleOf.has(e.parent_id) && <span className="text-faint">{titleOf.get(e.parent_id)} › </span>}
                          {displayTitle(e.title)}
                        </span>
                        {hit ? <HitLine hit={hit} terms={searchTerms(deferredQuery)} /> : d?.excerpt && <span className="mt-1 block truncate text-sm text-muted">{d.excerpt}</span>}
                        <span className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-faint">
                          {(searching || project === undefined) && pid && projectName.get(pid) && (
                            <span className="inline-flex items-center gap-1.5"><IconFolder className="size-3.5" />{projectName.get(pid)}</span>
                          )}
                          {d && d.cells > 0 && <span className="inline-flex items-center gap-1.5"><IconCode className="size-3.5" />{d.cells} {d.cells === 1 ? "cell" : "cells"}</span>}
                          <span className="tabular-nums">{listDate(e.updated_at)}</span>
                        </span>
                      </span>
                      {e.outcome && <span className="self-start pt-1"><OutcomeBadge outcome={e.outcome} /></span>}
                    </Link>
                  </li>
                );
                        })}
            </ul>
          </Fragment>
        ))}
        <ul>
          {hasMore && (
            <li ref={more} className="py-6 text-center text-sm text-faint">
              {notes!.length - shownRows} more…
            </li>
          )}
        </ul>
      </section>

      {!project && !searching && deleted && deleted.length > 0 && (
        <TextLink href="/deleted" className="mt-10 text-sm">
          Recently deleted · {deleted.length}
        </TextLink>
      )}
    </Column>
  );
}

/** Where a search matched: the line (the words marked), and in which cell and line, or the note's text. */
function HitLine({ hit, terms }: { hit: SearchHit; terms: readonly string[] }) {
  const words = terms.map((t) => t.toLowerCase()).filter(Boolean);
  const parts: { text: string; mark: boolean }[] = [];
  const low = hit.line.toLowerCase();
  let i = 0;
  while (i < hit.line.length) {
    const next = words.map((w) => ({ w, at: low.indexOf(w, i) })).filter((m) => m.at >= 0).sort((a, b) => a.at - b.at)[0];
    if (!next) {
      parts.push({ text: hit.line.slice(i), mark: false });
      break;
    }
    if (next.at > i) parts.push({ text: hit.line.slice(i, next.at), mark: false });
    parts.push({ text: hit.line.slice(next.at, next.at + next.w.length), mark: true });
    i = next.at + next.w.length;
  }
  const where = hit.where === "note" ? `Note, line ${hit.lineNo}` : `Cell ${hit.cell}${hit.filename ? ` · ${hit.filename}` : ""}${hit.where === "cell note" ? " · its notes" : ""}, line ${hit.lineNo}`;
  return (
    <span className="mt-1.5 block">
      <span className="block text-[11px] text-faint">{where}</span>
      <span className={cn("mt-0.5 block truncate rounded-md border border-line bg-raise px-2 py-1 text-[13px] text-muted", hit.where === "code" && "font-mono text-[12.5px]")}>
        {parts.map((p, k) => (p.mark ? <mark key={k} className="rounded-[3px] bg-fg/15 px-0.5 text-fg">{p.text}</mark> : <span key={k}>{p.text}</span>))}
      </span>
    </span>
  );
}

