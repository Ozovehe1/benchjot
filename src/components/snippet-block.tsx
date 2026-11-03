"use client";
import { useState } from "react";
import dynamic from "next/dynamic";
import { useAutosave } from "@/lib/autosave";
import { deleteSnippet, updateSnippet } from "@/lib/data";
import { detectLanguage } from "@/lib/detect-language";
import { downloadName, isLanguageId, LANGUAGES, type LanguageId } from "@/lib/languages";
import type { Snippet } from "@/lib/schemas";
import { TextButton } from "./ui";

const CodeEditor = dynamic(() => import("./code-editor").then((m) => m.CodeEditor), {
  ssr: false,
  loading: () => <div className="min-h-[72px]" />,
});

function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function SnippetBlock({ snippet, index }: { snippet: Snippet; index: number }) {
  const initial: LanguageId = isLanguageId(snippet.language) ? snippet.language : "text";
  const [language, setLanguage] = useState<LanguageId>(initial);
  const [content, setContent] = useState(snippet.content);
  // A language counts as chosen once the user picks it, or once the block was saved with code in it.
  const [chosen, setChosen] = useState(initial !== "text" || snippet.content.trim() !== "");
  const [copied, setCopied] = useState(false);
  const { flush } = useAutosave({ language, content }, (v) => updateSnippet(snippet.id, v), {
    baseline: { language: initial, content: snippet.content },
  });

  function edit(next: string) {
    setContent(next);
    if (!chosen) setLanguage(detectLanguage(next) ?? "text");
  }

  async function copy() {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function remove() {
    if (content.trim() && !window.confirm("Remove this code?")) return;
    await flush();
    await deleteSnippet(snippet);
  }

  return (
    <div className="border-t border-line">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3 font-mono text-xs text-muted">
          {snippet.filename && <span className="truncate">{snippet.filename}</span>}
          <select
            value={language}
            onChange={(e) => {
              setLanguage(e.target.value as LanguageId);
              setChosen(true);
            }}
            aria-label={`Language of code ${index + 1}`}
            className="-ml-1 min-h-11 shrink-0 cursor-pointer appearance-none bg-transparent px-1 outline-none hover:text-fg"
          >
            {LANGUAGES.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex shrink-0 gap-5">
          <TextButton onClick={copy} className="text-xs">
            {copied ? "Copied" : "Copy"}
          </TextButton>
          <TextButton onClick={() => download(downloadName(snippet.filename, language, index), content)} className="text-xs">
            Download
          </TextButton>
          <TextButton onClick={remove} className="text-xs">
            Remove
          </TextButton>
        </div>
      </div>
      <div className="pb-4">
        <CodeEditor value={content} onChange={edit} language={language} label={`Code ${index + 1}`} />
      </div>
    </div>
  );
}
