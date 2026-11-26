"use client";
// Experiment tracking (supabase/migrations/20261126010000_experiment_runs.sql): each run whose code
// called log() is kept with what it logged, so a note shows its runs side by side. Added after the
// run is saved, best effort (a run that couldn't be recorded still shows in its cell).
import useSWR, { mutate } from "swr";
import { supabase } from "./supabase/client";
import type { Logged } from "../run/outputs";

export type ExperimentRun = {
  id: string;
  cellId: string;
  ranAt: string;
  outcome: "ok" | "error" | "timeout" | "stopped";
  ms: number;
  where: "browser" | "server" | "phone";
  codeHash: string;
  logged: Logged;
};

/** The most runs a note's table shows (newest first). */
export const RUNS_SHOWN = 500;

const key = (noteId: string) => ["experiment-runs", noteId] as const;

type Row = { id: string; cell_id: string; ran_at: string; outcome: ExperimentRun["outcome"]; ms: number; where: ExperimentRun["where"]; code_hash: string; logged: Logged };
const fromRow = (r: Row): ExperimentRun => ({ id: r.id, cellId: r.cell_id, ranAt: r.ran_at, outcome: r.outcome, ms: r.ms, where: r.where, codeHash: r.code_hash, logged: r.logged });

export async function listRuns(noteId: string): Promise<ExperimentRun[]> {
  const { data, error } = await supabase()
    .from("experiment_runs")
    .select("id, cell_id, ran_at, outcome, ms, where, code_hash, logged")
    .eq("note_id", noteId)
    .order("ran_at", { ascending: false })
    .limit(RUNS_SHOWN);
  if (error) throw new Error(error.message, { cause: error });
  return ((data ?? []) as Row[]).map(fromRow);
}

export function useRuns(noteId: string) {
  return useSWR(key(noteId), () => listRuns(noteId), { revalidateOnFocus: false });
}

/** Keeps a finished run that logged something. Never throws: tracking must not break a run. */
export async function recordRun(run: { noteId: string; cellId: string; ranAt: string; outcome: ExperimentRun["outcome"]; ms: number; where: ExperimentRun["where"]; codeHash: string; logged: Logged | undefined | null }): Promise<boolean> {
  if (!run.logged || !Object.keys(run.logged).length) return false;
  const { error } = await supabase()
    .from("experiment_runs")
    .insert({ note_id: run.noteId, cell_id: run.cellId, ran_at: run.ranAt, outcome: run.outcome, ms: run.ms, where: run.where, code_hash: run.codeHash, logged: run.logged });
  if (error) {
    console.warn("experiment run not recorded", error.message);
    return false;
  }
  await mutate(key(run.noteId));
  return true;
}

export async function deleteRun(noteId: string, id: string): Promise<void> {
  const { error } = await supabase().from("experiment_runs").delete().eq("id", id);
  if (error) throw new Error(error.message, { cause: error });
  await mutate(key(noteId));
}
