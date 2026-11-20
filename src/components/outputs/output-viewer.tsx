"use client";
// A saved run's output on its own page (/n/{id}/out/{cell}/{n}): the run from the note's
// code blocks, its files signed from Storage, shown by OutputView.
import { useCells } from "@/lib/data";
import { notePath, outputPagePath } from "@/lib/web/paths";
import { fetchOutput, useOutputUrls } from "@/lib/run/output-store";
import { renderFigure } from "@/lib/run/runner";
import { OutputView } from "./output-view";

export function OutputViewer({ noteId, cellId, index }: { noteId: string; cellId: string; index: number }) {
  const { data: cells, isLoading } = useCells(noteId);
  const cell = cells?.find((s) => s.id === cellId);
  const outputs = cell?.last_run?.outputs ?? null;
  const { data: urls } = useOutputUrls(outputs);
  return (
    <OutputView
      items={outputs?.items ?? null}
      index={index}
      urls={urls}
      read={(name) => fetchOutput(outputs!, name)}
      figure={renderFigure}
      base={cell?.filename || "output"}
      back={notePath(noteId)}
      step={(i) => outputPagePath(noteId, cellId, i)}
      missing={isLoading ? "Loading…" : "This output isn’t here any more. Run the code again to make it."}
    />
  );
}
