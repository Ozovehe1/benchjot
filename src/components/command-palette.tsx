"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { useTheme } from "next-themes";
import { FlaskConical, FolderTree, Moon, Plus, Search, Settings } from "lucide-react";
import { searchExperiments, useProjects } from "@/lib/data";
import type { ExperimentListItem } from "@/lib/schemas";
import { StatusDot } from "./status";
import { useShell } from "./shell";

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const item =
  "flex min-h-12 cursor-pointer items-center gap-3 rounded-xl px-3 text-[15px] text-fg data-[selected=true]:bg-surface-2 md:min-h-10 md:text-sm";

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const { openNew } = useShell();
  const { resolvedTheme, setTheme } = useTheme();
  const { data: projects } = useProjects();
  const [query, setQuery] = useState("");
  const q = useDebounced(query, 180);
  const [results, setResults] = useState<ExperimentListItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setLoading(true);
    searchExperiments({ q })
      .then((r) => live && setResults(r.slice(0, 20)))
      .catch(() => live && setResults([]))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [q, open]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const go = (fn: () => void) => {
    onOpenChange(false);
    fn();
  };
  const matchingProjects = (projects ?? []).filter((p) => !query || p.name.toLowerCase().includes(query.toLowerCase())).slice(0, 5);

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="Search and commands"
      shouldFilter={false}
      overlayClassName="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]"
      contentClassName="fixed inset-x-3 top-3 z-50 mx-auto max-w-xl overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl md:top-[12vh]"
    >
      <div className="flex items-center gap-2 border-b border-border px-4">
        <Search className="size-5 shrink-0 text-faint" />
        <Command.Input
          value={query}
          onValueChange={setQuery}
          placeholder="Search experiments, code, tags…"
          className="h-14 w-full bg-transparent text-base text-fg placeholder:text-faint focus:outline-none"
        />
      </div>
      <Command.List className="max-h-[min(60vh,480px)] overflow-y-auto p-2">
        {!loading && results.length === 0 && matchingProjects.length === 0 && (
          <Command.Empty className="px-3 py-8 text-center text-sm text-muted">No matches. Try fewer words.</Command.Empty>
        )}
        {results.length > 0 && (
          <Command.Group heading="Experiments" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-faint">
            {results.map((e) => (
              <Command.Item key={e.id} value={`e-${e.id}`} onSelect={() => go(() => router.push(`/e/${e.id}`))} className={item}>
                <StatusDot status={e.status} />
                <span className="min-w-0 flex-1 truncate">{e.title}</span>
                {e.projects && <span className="truncate text-xs text-faint">{e.projects.name}</span>}
              </Command.Item>
            ))}
          </Command.Group>
        )}
        {matchingProjects.length > 0 && (
          <Command.Group heading="Projects" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-faint">
            {matchingProjects.map((p) => (
              <Command.Item key={p.id} value={`p-${p.id}`} onSelect={() => go(() => router.push(`/projects/${p.id}`))} className={item}>
                <FolderTree className="size-4 text-faint" />
                <span className="truncate">{p.name}</span>
              </Command.Item>
            ))}
          </Command.Group>
        )}
        <Command.Group heading="Actions" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-faint">
          <Command.Item value="new" onSelect={() => go(() => openNew())} className={item}>
            <Plus className="size-4 text-faint" /> New experiment
          </Command.Item>
          <Command.Item value="experiments" onSelect={() => go(() => router.push("/"))} className={item}>
            <FlaskConical className="size-4 text-faint" /> All experiments
          </Command.Item>
          <Command.Item value="projects" onSelect={() => go(() => router.push("/projects"))} className={item}>
            <FolderTree className="size-4 text-faint" /> Projects
          </Command.Item>
          <Command.Item value="theme" onSelect={() => go(() => setTheme(resolvedTheme === "light" ? "dark" : "light"))} className={item}>
            <Moon className="size-4 text-faint" /> Toggle light / dark
          </Command.Item>
          <Command.Item value="settings" onSelect={() => go(() => router.push("/settings"))} className={item}>
            <Settings className="size-4 text-faint" /> Settings
          </Command.Item>
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}
