"use client";
import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Copy, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { useVersions } from "@/lib/data";
import { lineDiff, withContext } from "@/lib/diff";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/format";
import { Button, Skeleton } from "../ui";
import { Sheet } from "../sheet";

const CodeEditor = dynamic(() => import("../code-editor").then((m) => m.CodeEditor), { ssr: false });

export function HistorySheet({
  open,
  onOpenChange,
  snippetId,
  current,
  language,
  onRestore,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  snippetId: string;
  current: string;
  language: string;
  onRestore: (content: string) => void;
}) {
  const { data: versions, isLoading, mutate } = useVersions(open ? snippetId : null);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<"diff" | "code">("diff");

  useEffect(() => {
    if (open) {
      void mutate();
      setView("diff");
    }
  }, [open, mutate]);
  useEffect(() => {
    if (versions?.length && !versions.some((v) => v.id === selected)) setSelected(versions[1]?.id ?? versions[0]!.id);
  }, [versions, selected]);

  const version = versions?.find((v) => v.id === selected);
  const diff = useMemo(() => (version ? lineDiff(version.content, current) : null), [version, current]);
  const hunks = useMemo(() => (diff ? withContext(diff.lines, 3) : []), [diff]);
  const isCurrent = version?.content === current;

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Version history" description="Every save is a version. Quick edits within a minute are grouped." size="lg">
      {isLoading || !versions ? (
        <Skeleton className="mt-2 h-40" />
      ) : versions.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted">No versions yet. Start typing; saves appear here.</p>
      ) : (
        <div className="space-y-4 pt-1">
          <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 scrollbar-none" role="listbox" aria-label="Versions">
            {versions.map((v, i) => (
              <button
                key={v.id}
                role="option"
                aria-selected={v.id === selected}
                onClick={() => setSelected(v.id)}
                className={cn(
                  "flex h-14 shrink-0 flex-col items-start justify-center rounded-xl border px-3 text-left transition-colors",
                  v.id === selected ? "border-accent/60 bg-accent-soft" : "border-border hover:border-border-strong",
                )}
              >
                <span className="font-mono text-sm font-medium">
                  v{v.version}
                  {i === 0 && <span className="ml-1.5 text-[11px] font-normal text-accent">latest</span>}
                </span>
                <span className="text-[11px] text-faint">{timeAgo(v.updated_at)}</span>
              </button>
            ))}
          </div>

          {version && diff && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex rounded-lg bg-surface-2 p-0.5 text-xs" role="tablist">
                  {(["diff", "code"] as const).map((m) => (
                    <button
                      key={m}
                      role="tab"
                      aria-selected={view === m}
                      onClick={() => setView(m)}
                      className={cn("h-8 rounded-md px-3", view === m ? "bg-surface text-fg shadow-sm" : "text-muted")}
                    >
                      {m === "diff" ? "Changes to now" : `v${version.version} code`}
                    </button>
                  ))}
                </div>
                <span className="font-mono text-xs">
                  <span className="text-[var(--add-fg)]">+{diff.added}</span> <span className="text-[var(--del-fg)]">−{diff.removed}</span>
                </span>
              </div>

              {view === "diff" ? (
                isCurrent ? (
                  <p className="rounded-xl border border-border px-4 py-6 text-center text-sm text-muted">Same as the current code.</p>
                ) : (
                  <pre className="overflow-x-auto rounded-xl border border-border bg-surface-2/50 py-2 font-mono text-[12.5px] leading-[1.6]" aria-label="Diff">
                    {hunks.map((h, i) =>
                      h.type === "skip" ? (
                        <div key={i} className="select-none px-3 py-0.5 text-[11px] text-faint">
                          ⋯ {h.count} unchanged line{h.count === 1 ? "" : "s"}
                        </div>
                      ) : (
                        <div
                          key={i}
                          className={cn(
                            "min-w-max whitespace-pre px-3",
                            h.type === "add" && "bg-[var(--add)] text-[var(--add-fg)]",
                            h.type === "del" && "bg-[var(--del)] text-[var(--del-fg)]",
                          )}
                        >
                          <span className="mr-3 inline-block w-3 select-none opacity-70">{h.type === "add" ? "+" : h.type === "del" ? "−" : " "}</span>
                          {h.text || " "}
                        </div>
                      ),
                    )}
                  </pre>
                )
              ) : (
                <div className="overflow-hidden rounded-xl border border-border">
                  <CodeEditor value={version.content} language={version.language || language} readOnly label={`Version ${version.version}`} maxHeight="50vh" />
                </div>
              )}

              <div className="flex gap-2">
                <Button
                  className="flex-1"
                  onClick={() => navigator.clipboard.writeText(version.content).then(() => toast.success("Copied", { duration: 1000 }))}
                >
                  <Copy className="size-4" /> Copy v{version.version}
                </Button>
                <Button variant="primary" className="flex-1" disabled={isCurrent} onClick={() => onRestore(version.content)}>
                  <RotateCcw className="size-4" /> Restore
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </Sheet>
  );
}
