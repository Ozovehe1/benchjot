"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { FlaskConical, Pin, Play, Search, SlidersHorizontal, X } from "lucide-react";
import { useExperiments, useTags, type ExperimentFilters } from "@/lib/data";
import { LANGUAGES, languageLabel } from "@/lib/languages";
import { STATUSES, STATUS_LABEL, type ExperimentListItem, type Status } from "@/lib/schemas";
import { timeAgo } from "@/lib/format";
import { Button, Chip, EmptyState, ErrorState, Skeleton, Tag } from "./ui";
import { StatusBadge, StatusDot } from "./status";
import { Sheet } from "./sheet";
import { PageHeader } from "./page-header";
import { useShell } from "./shell";

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function ExperimentsView({
  projectId,
  title = "Experiments",
  back,
  headerActions,
  intro,
}: {
  projectId?: string;
  title?: React.ReactNode;
  back?: string;
  headerActions?: React.ReactNode;
  intro?: React.ReactNode;
}) {
  const { openNew } = useShell();
  const [query, setQuery] = useState("");
  const [statuses, setStatuses] = useState<Status[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [language, setLanguage] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const q = useDebounced(query, 220);

  const filters: ExperimentFilters = { q, statuses, tags, language, projectId };
  const { data, error, isLoading, mutate } = useExperiments(filters);
  const filtering = Boolean(q || statuses.length || tags.length || language);
  const extraFilters = tags.length + (language ? 1 : 0);

  const toggleStatus = (s: Status) => setStatuses((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));
  const clear = () => {
    setQuery("");
    setStatuses([]);
    setTags([]);
    setLanguage(null);
  };

  return (
    <>
      <PageHeader title={title} back={back} actions={headerActions}>
        <div className="mx-auto max-w-5xl space-y-2.5 px-4 pb-3 md:px-6">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-faint" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search titles, notes, tags and code"
              aria-label="Search experiments"
              className="h-11 w-full rounded-xl border border-border bg-surface-2 pl-10 pr-10 text-fg placeholder:text-faint focus:border-accent focus:outline-none md:h-10"
            />
            {query && (
              <button
                aria-label="Clear search"
                onClick={() => setQuery("")}
                className="absolute right-1 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-lg text-faint hover:text-fg"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 scrollbar-none md:mx-0 md:px-0">
            <Chip active={extraFilters > 0} onClick={() => setFiltersOpen(true)} aria-label="More filters">
              <SlidersHorizontal className="size-3.5" />
              {extraFilters > 0 ? `Filters · ${extraFilters}` : "Filters"}
            </Chip>
            {STATUSES.map((s) => (
              <Chip key={s} active={statuses.includes(s)} onClick={() => toggleStatus(s)}>
                <StatusDot status={s} />
                {STATUS_LABEL[s]}
              </Chip>
            ))}
          </div>
        </div>
      </PageHeader>

      <main className="mx-auto max-w-5xl px-4 py-4 md:px-6 md:py-6">
        {intro}
        {error ? (
          <ErrorState error={error} onRetry={() => void mutate()} />
        ) : isLoading && !data ? (
          <div className="grid gap-3 md:grid-cols-2">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-32" />
            ))}
          </div>
        ) : data && data.length > 0 ? (
          <>
            {filtering && (
              <div className="mb-3 flex items-center justify-between text-sm text-muted">
                <span>
                  {data.length} result{data.length === 1 ? "" : "s"}
                </span>
                <button onClick={clear} className="h-9 px-2 text-accent hover:underline">
                  Clear filters
                </button>
              </div>
            )}
            <ul className="grid gap-3 md:grid-cols-2">
              {data.map((e) => (
                <li key={e.id}>
                  <ExperimentCard e={e} />
                </li>
              ))}
            </ul>
          </>
        ) : filtering ? (
          <EmptyState
            icon={<Search className="size-5" />}
            title="Nothing matches"
            body="Search looks through titles, hypotheses, notes, tags and every line of code."
            action={<Button onClick={clear}>Clear filters</Button>}
          />
        ) : (
          <EmptyState
            icon={<FlaskConical className="size-5" />}
            title={projectId ? "No experiments in this project yet" : "Log your first experiment"}
            body="An experiment holds the code you ran, the runs you tried and what you learned. Start with a title; the rest can come later."
            action={
              <Button variant="primary" onClick={() => openNew(projectId)}>
                New experiment
              </Button>
            }
          />
        )}
      </main>

      <FiltersSheet
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        tags={tags}
        setTags={setTags}
        language={language}
        setLanguage={setLanguage}
      />
    </>
  );
}

function ExperimentCard({ e }: { e: ExperimentListItem }) {
  const languages = [...new Set(e.snippets.map((s) => s.language))];
  const runs = e.runs[0]?.count ?? 0;
  return (
    <Link
      href={`/e/${e.id}`}
      className="group flex h-full flex-col rounded-2xl border border-border bg-surface p-4 transition-colors hover:border-border-strong active:bg-surface-2"
    >
      <div className="flex items-start gap-2">
        <h2 className="min-w-0 flex-1 text-[15.5px] font-semibold leading-snug tracking-tight group-hover:text-accent">{e.title}</h2>
        {e.pinned && <Pin className="mt-0.5 size-4 shrink-0 fill-current text-accent" aria-label="Pinned" />}
      </div>
      {e.hypothesis && <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-muted">{e.hypothesis}</p>}
      {e.tags.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1">
          {e.tags.slice(0, 5).map((t) => (
            <Tag key={t}>{t}</Tag>
          ))}
        </div>
      )}
      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-3.5 text-xs text-faint">
        <StatusBadge status={e.status} />
        {e.projects && <span className="max-w-[10rem] truncate">{e.projects.name}</span>}
        {languages.length > 0 && <span className="font-mono">{languages.map(languageLabel).join(" · ")}</span>}
        {runs > 0 && (
          <span className="inline-flex items-center gap-1">
            <Play className="size-3" />
            {runs} run{runs === 1 ? "" : "s"}
          </span>
        )}
        <span className="ml-auto">{timeAgo(e.updated_at)}</span>
      </div>
    </Link>
  );
}

function FiltersSheet({
  open,
  onOpenChange,
  tags,
  setTags,
  language,
  setLanguage,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  tags: string[];
  setTags: (t: string[]) => void;
  language: string | null;
  setLanguage: (l: string | null) => void;
}) {
  const { data: allTags } = useTags();
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Filters"
      footer={
        <div className="flex gap-2">
          <Button
            className="flex-1"
            onClick={() => {
              setTags([]);
              setLanguage(null);
            }}
          >
            Reset
          </Button>
          <Button variant="primary" className="flex-1" onClick={() => onOpenChange(false)}>
            Show results
          </Button>
        </div>
      }
    >
      <section className="pt-2">
        <h3 className="mb-2 text-sm font-medium text-muted">Tags</h3>
        {allTags && allTags.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {allTags.map(({ tag, uses }) => (
              <Chip
                key={tag}
                active={tags.includes(tag)}
                onClick={() => setTags(tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag])}
              >
                #{tag}
                <span className="text-xs text-faint">{uses}</span>
              </Chip>
            ))}
          </div>
        ) : (
          <p className="text-sm text-faint">Tags you add to experiments show up here.</p>
        )}
      </section>
      <section className="mt-6">
        <h3 className="mb-2 text-sm font-medium text-muted">Has code in</h3>
        <div className="flex flex-wrap gap-2">
          {LANGUAGES.map((l) => (
            <Chip key={l.id} active={language === l.id} onClick={() => setLanguage(language === l.id ? null : l.id)}>
              {l.label}
            </Chip>
          ))}
        </div>
      </section>
    </Sheet>
  );
}
