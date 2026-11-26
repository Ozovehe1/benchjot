"use client";
// The Figures page's data: the latest runs' visuals across the user's notes (RLS: their own cells),
// with signed addresses to show them. The most recent FIGURE_CELLS cells that ran with outputs.
import useSWR from "swr";
import { supabase } from "./supabase/client";
import { figuresOf, type Figure } from "../run/figures";
import { signPaths } from "../run/output-store";

export const FIGURE_CELLS = 300;

export function useFigures() {
  return useSWR(["figures"], async (): Promise<{ figures: Figure[]; urls: Record<string, string> }> => {
    const res = await supabase().from("cells").select("id, note_id, last_run, updated_at").not("last_run", "is", null).order("updated_at", { ascending: false }).limit(FIGURE_CELLS);
    if (res.error) throw new Error(res.error.message, { cause: res.error });
    const figures = figuresOf((res.data ?? []) as Parameters<typeof figuresOf>[0]);
    return { figures, urls: figures.length ? await signPaths(figures.map((f) => f.path)) : {} };
  }, { revalidateOnFocus: false });
}
