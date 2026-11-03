"use client";
import { useState } from "react";
import dynamic from "next/dynamic";
import { Check, Copy, FileCode2, History, Plus, Trash2, WrapText } from "lucide-react";
import { toast } from "sonner";
import { createSnippet, deleteSnippet, updateSnippet, useSnippets } from "@/lib/data";
import { useAutosave } from "@/lib/autosave";
import { DEFAULT_LANGUAGE, LANGUAGES, defaultExtension, guessLanguage, type LanguageId } from "@/lib/languages";
import type { Snippet } from "@/lib/schemas";
import { cn } from "@/lib/format";
import { Button, EmptyState, ErrorState, IconButton, Skeleton } from "../ui";
import { HistorySheet } from "./history-sheet";

const CodeEditor = dynamic(() => import("../code-editor").then((m) => m.CodeEditor), {
  ssr: false,
  loading: () => <div className="h-40 animate-pulse bg-surface-2/50" />,
});

export function CodePanel({ experimentId }: { experimentId: string }) {
  const { data: snippets, error, isLoading, mutate } = useSnippets(experimentId);
  const [adding, setAdding] = useState(false);

  async function add() {
    setAdding(true);
    try {
      const last = snippets?.at(-1);
      const language = (last?.language as LanguageId | undefined) ?? DEFAULT_LANGUAGE;
      const n = (snippets?.length ?? 0) + 1;
      await createSnippet(
        experimentId,
        { filename: n === 1 ? `main.${defaultExtension(language)}` : `snippet_${n}.${defaultExtension(language)}`, language, content: "" },
        (last?.position ?? -1) + 1,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add snippet");
    } finally {
      setAdding(false);
    }
  }

  if (error) return <ErrorState error={error} onRetry={() => void mutate()} />;
  if (isLoading || !snippets) return <Skeleton className="h-56" />;

  if (!snippets.length) {
    return (
      <EmptyState
        icon={<FileCode2 className="size-5" />}
        title="No code yet"
        body="Paste the training script, the loss function, the one-liner that finally worked. Every save is kept as a version."
        action={
          <Button variant="primary" onClick={add} loading={adding}>
            <Plus className="size-4" />
            Add snippet
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      {snippets.map((s) => (
        <SnippetCard key={s.id} snippet={s} />
      ))}
      <Button onClick={add} loading={adding} className="w-full border-dashed">
        <Plus className="size-4" />
        Add snippet
      </Button>
    </div>
  );
}

interface Draft {
  filename: string;
  language: string;
  content: string;
}

function SnippetCard({ snippet }: { snippet: Snippet }) {
  const [draft, setDraft] = useState<Draft>({ filename: snippet.filename, language: snippet.language, content: snippet.content });
  const [baseline] = useState(draft);
  const [wrap, setWrap] = useState(false);
  const [copied, setCopied] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const { flush } = useAutosave(draft, (d) => updateSnippet(snippet.id, d), { baseline, delay: 1200 });

  async function copy() {
    try {
      await navigator.clipboard.writeText(draft.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Clipboard blocked by the browser");
    }
  }

  async function remove() {
    if (!window.confirm(`Delete ${draft.filename || "this snippet"} and its history?`)) return;
    setDeleting(true);
    try {
      await deleteSnippet(snippet);
    } catch (e) {
      setDeleting(false);
      toast.error(e instanceof Error ? e.message : "Could not delete");
    }
  }

  const lines = draft.content ? draft.content.split("\n").length : 0;

  return (
    <article className={cn("overflow-hidden rounded-2xl border border-border bg-surface", deleting && "opacity-50")} aria-label={draft.filename || "Snippet"}>
      <div className="flex items-center gap-1 border-b border-border bg-surface-2/60 py-1 pl-3 pr-1">
        <FileCode2 className="size-4 shrink-0 text-faint" aria-hidden />
        <input
          value={draft.filename}
          onChange={(e) => setDraft((d) => ({ ...d, filename: e.target.value }))}
          onBlur={() => {
            const guess = guessLanguage(draft.filename);
            if (guess && guess !== draft.language) setDraft((d) => ({ ...d, language: guess }));
          }}
          placeholder="filename.py"
          aria-label="Filename"
          className="h-10 min-w-0 flex-1 bg-transparent font-mono text-[14px] text-fg placeholder:text-faint focus:outline-none md:text-[13px]"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
        <select
          value={draft.language}
          onChange={(e) => setDraft((d) => ({ ...d, language: e.target.value }))}
          aria-label="Language"
          className="h-9 max-w-[7.5rem] shrink-0 rounded-lg bg-transparent px-1.5 text-xs text-muted hover:bg-surface-3 focus:outline-none md:max-w-none"
        >
          {LANGUAGES.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
      </div>

      <div className="relative">
        <CodeEditor
          value={draft.content}
          onChange={(content) => setDraft((d) => ({ ...d, content }))}
          language={draft.language}
          wrap={wrap}
          minHeight="140px"
          label={`Code: ${draft.filename}`}
        />
      </div>

      <div className="flex items-center gap-0.5 border-t border-border px-1 py-1">
        <Button
          size="sm"
          variant={copied ? "secondary" : "ghost"}
          onClick={copy}
          className={cn("h-10 md:h-8", copied && "text-accent")}
          aria-live="polite"
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copied ? "Copied" : "Copy"}
        </Button>
        <IconButton label={wrap ? "Don't wrap lines" : "Wrap long lines"} onClick={() => setWrap((w) => !w)} className={wrap ? "text-accent" : undefined}>
          <WrapText className="size-4" />
        </IconButton>
        <IconButton
          label="Version history"
          onClick={async () => {
            await flush();
            setHistoryOpen(true);
          }}
        >
          <History className="size-4" />
        </IconButton>
        <span className="ml-auto px-2 font-mono text-[11px] text-faint">{lines} lines</span>
        <IconButton label="Delete snippet" onClick={remove} className="hover:text-danger">
          <Trash2 className="size-4" />
        </IconButton>
      </div>

      <HistorySheet
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        snippetId={snippet.id}
        current={draft.content}
        language={draft.language}
        onRestore={(content) => {
          setDraft((d) => ({ ...d, content }));
          setHistoryOpen(false);
          toast.success("Version restored. Saved as a new version.");
        }}
      />
    </article>
  );
}
