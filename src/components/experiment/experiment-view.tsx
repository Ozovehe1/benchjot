"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Download, GitFork, MoreHorizontal, Pin, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  deleteExperiment,
  fetchExportData,
  forkExperiment,
  updateExperiment,
  useExperiment,
  useRuns,
  useSnippets,
} from "@/lib/data";
import { experimentToMarkdown, exportFilename } from "@/lib/export";
import { cn } from "@/lib/format";
import { ErrorState, IconButton, Skeleton, EmptyState, Button } from "../ui";
import { PageHeader } from "../page-header";
import { Sheet } from "../sheet";
import { StatusBadge } from "../status";
import { NotesPanel } from "./notes-panel";
import { CodePanel } from "./code-panel";
import { RunsPanel } from "./runs-panel";
import { FlaskConical } from "lucide-react";

const TABS = ["notes", "code", "runs"] as const;
type Tab = (typeof TABS)[number];

export function ExperimentView({ id }: { id: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const tabParam = params.get("tab");
  const tab: Tab = TABS.includes(tabParam as Tab) ? (tabParam as Tab) : "notes";
  const { data: exp, error, isLoading, mutate } = useExperiment(id);
  const { data: snippets } = useSnippets(id);
  const { data: runs } = useRuns(id);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const setTab = (t: Tab) => router.replace(`/e/${id}?tab=${t}`, { scroll: false });

  if (error) {
    const missing = error instanceof Error && error.message === "Not found";
    return (
      <>
        <PageHeader back="/" title="Experiment" />
        <main className="mx-auto max-w-3xl px-4 py-8">
          {missing ? (
            <EmptyState
              icon={<FlaskConical className="size-5" />}
              title="Experiment not found"
              body="It may have been deleted."
              action={
                <Link href="/">
                  <Button>Back to experiments</Button>
                </Link>
              }
            />
          ) : (
            <ErrorState error={error} onRetry={() => void mutate()} />
          )}
        </main>
      </>
    );
  }

  if (isLoading || !exp) {
    return (
      <>
        <PageHeader back="/" />
        <main className="mx-auto max-w-3xl space-y-3 px-4 py-6">
          <Skeleton className="h-9 w-3/4" />
          <Skeleton className="h-6 w-1/3" />
          <Skeleton className="h-48" />
        </main>
      </>
    );
  }

  async function togglePin() {
    if (!exp) return;
    const pinned = !exp.pinned;
    await mutate({ ...exp, pinned }, { revalidate: false });
    try {
      await updateExperiment(exp.id, { pinned });
      toast.success(pinned ? "Pinned to top" : "Unpinned", { duration: 1200 });
    } catch (e) {
      void mutate();
      toast.error(e instanceof Error ? e.message : "Could not update");
    }
  }

  async function act(name: string, fn: () => Promise<void>) {
    setBusy(name);
    try {
      await fn();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  }

  const exportMd = () =>
    act("export", async () => {
      const data = await fetchExportData(exp.id);
      const blob = new Blob([experimentToMarkdown(data)], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement("a"), { href: url, download: exportFilename(exp.title) });
      a.click();
      URL.revokeObjectURL(url);
      setMenuOpen(false);
    });

  const fork = () =>
    act("fork", async () => {
      const newId = await forkExperiment(exp.id);
      setMenuOpen(false);
      toast.success("Forked. Code copied; runs start fresh.");
      router.push(`/e/${newId}`);
    });

  const remove = () =>
    act("delete", async () => {
      if (!window.confirm(`Delete “${exp.title}” with all its code and runs? This can't be undone.`)) return;
      await deleteExperiment(exp.id);
      setMenuOpen(false);
      toast.success("Experiment deleted");
      router.replace(exp.projects ? `/projects/${exp.projects.id}` : "/");
    });

  const counts: Record<Tab, number | null> = { notes: null, code: snippets?.length ?? null, runs: runs?.length ?? null };

  return (
    <>
      <PageHeader
        back={exp.projects ? `/projects/${exp.projects.id}` : "/"}
        showSave
        narrow
        title={
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold leading-tight md:text-base">{exp.title}</p>
            <p className="truncate text-xs text-faint">{exp.projects?.name ?? "No project"}</p>
          </div>
        }
        actions={
          <>
            <IconButton label={exp.pinned ? "Unpin" : "Pin to top"} onClick={togglePin} className={exp.pinned ? "text-accent" : undefined}>
              <Pin className={cn("size-[18px]", exp.pinned && "fill-current")} />
            </IconButton>
            <IconButton label="More actions" onClick={() => setMenuOpen(true)}>
              <MoreHorizontal className="size-5" />
            </IconButton>
          </>
        }
      >
        <div className="mx-auto flex max-w-3xl items-center gap-1 px-3 md:px-6" role="tablist" aria-label="Sections">
          {TABS.map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={cn(
                "relative flex h-11 flex-1 items-center justify-center gap-1.5 text-sm font-medium capitalize transition-colors md:flex-none md:px-4",
                tab === t ? "text-fg" : "text-faint hover:text-muted",
              )}
            >
              {t}
              {counts[t] !== null && counts[t]! > 0 && (
                <span className="rounded-full bg-surface-3 px-1.5 text-[11px] text-muted">{counts[t]}</span>
              )}
              {tab === t && <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-accent" />}
            </button>
          ))}
          <span className="ml-auto hidden md:block">
            <StatusBadge status={exp.status} />
          </span>
        </div>
      </PageHeader>

      <main className="mx-auto max-w-3xl px-4 py-5 md:px-6 md:py-8">
        {tab === "notes" && <NotesPanel key={exp.id} experiment={exp} />}
        {tab === "code" && <CodePanel experimentId={exp.id} />}
        {tab === "runs" && <RunsPanel experimentId={exp.id} />}
      </main>

      <Sheet open={menuOpen} onOpenChange={setMenuOpen} title="Experiment">
        <div className="space-y-1 pt-1">
          <MenuItem icon={<GitFork className="size-5" />} label="Fork experiment" hint="Copies notes and code, not runs" onClick={fork} loading={busy === "fork"} />
          <MenuItem icon={<Download className="size-5" />} label="Export as Markdown" hint="Notes, code and runs in one .md file" onClick={exportMd} loading={busy === "export"} />
          <MenuItem icon={<Trash2 className="size-5" />} label="Delete experiment" danger onClick={remove} loading={busy === "delete"} />
        </div>
      </Sheet>
    </>
  );
}

function MenuItem({
  icon,
  label,
  hint,
  onClick,
  danger,
  loading,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  onClick: () => void;
  danger?: boolean;
  loading?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className={cn(
        "flex min-h-14 w-full items-center gap-3.5 rounded-xl px-3 text-left transition-colors hover:bg-surface-2 disabled:opacity-50",
        danger ? "text-danger" : "text-fg",
      )}
    >
      <span className={danger ? "text-danger" : "text-muted"}>{icon}</span>
      <span className="min-w-0">
        <span className="block text-[15px] font-medium">{loading ? "Working…" : label}</span>
        {hint && <span className="block text-xs text-faint">{hint}</span>}
      </span>
    </button>
  );
}
