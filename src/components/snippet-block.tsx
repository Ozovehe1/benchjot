"use client";
import { useState } from "react";
import dynamic from "next/dynamic";
import { useAutosave } from "@/lib/autosave";
import { deleteSnippet, updateSnippet } from "@/lib/data";
import { LANGUAGES, type LanguageId } from "@/lib/languages";
import type { Snippet } from "@/lib/schemas";
import { TextButton } from "./ui";

const CodeEditor = dynamic(() => import("./code-editor").then((m) => m.CodeEditor), {
  ssr: false,
  loading: () => <div className="min-h-[72px]" />,
});

export function SnippetBlock({ snippet, index }: { snippet: Snippet; index: number }) {
  const [language, setLanguage] = useState(snippet.language as LanguageId);
  const [content, setContent] = useState(snippet.content);
  const [copied, setCopied] = useState(false);
  const { flush } = useAutosave({ language, content }, (v) => updateSnippet(snippet.id, v), {
    baseline: { language: snippet.language as LanguageId, content: snippet.content },
  });

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
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value as LanguageId)}
          aria-label={`Language of code ${index + 1}`}
          className="-ml-1 min-h-11 cursor-pointer appearance-none bg-transparent px-1 font-mono text-xs text-muted outline-none hover:text-fg"
        >
          {LANGUAGES.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
        <div className="flex gap-5">
          <TextButton onClick={copy} className="text-xs">
            {copied ? "Copied" : "Copy"}
          </TextButton>
          <TextButton onClick={remove} className="text-xs">
            Remove
          </TextButton>
        </div>
      </div>
      <div className="pb-4">
        <CodeEditor value={content} onChange={setContent} language={language} label={`Code ${index + 1}`} />
      </div>
    </div>
  );
}
