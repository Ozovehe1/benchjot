"use client";
// A saved run's output on its own page (/n/{id}/out/{snippet}/{n}): the run from the note's
// code blocks, its files signed from Storage, shown by OutputView.
import { useSnippets } from "@/lib/data";
import { notePath, outputPagePath } from "@/lib/paths";
import { fetchOutput, useOutputUrls } from "@/lib/run/output-store";
import { renderFigure } from "@/lib/run/runner";
import { OutputView } from "./output-view";

export function OutputViewer({ noteId, snippetId, index }: { noteId: string; snippetId: string; index: number }) {
  const { data: snippets, isLoading } = useSnippets(noteId);
  const snippet = snippets?.find((s) => s.id === snippetId);
  const outputs = snippet?.last_run?.outputs ?? null;
  const { data: urls } = useOutputUrls(outputs);
  return (
    <OutputView
      items={outputs?.items ?? null}
      index={index}
      urls={urls}
      read={(name) => fetchOutput(outputs!, name)}
      figure={renderFigure}
      base={snippet?.filename || "output"}
      back={notePath(noteId)}
      step={(i) => outputPagePath(noteId, snippetId, i)}
      missing={isLoading ? "Loading…" : "This output isn’t here any more. Run the code again to make it."}
    />
  );
}
