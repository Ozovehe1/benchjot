"use client";
// Data access: the only module that talks to Supabase tables.
// Every write validates its input against the zod contracts first.
import useSWR, { mutate as globalMutate } from "swr";
import { supabase } from "./supabase/client";
import { buildTsQuery } from "./search";
import {
  experimentCreate,
  experimentPatch,
  firstIssue,
  projectInput,
  runInput,
  snippetPatch,
  snippetInput,
  type Experiment,
  type ExperimentListItem,
  type ExperimentPatch,
  type Project,
  type ProjectInput,
  type Run,
  type RunInput,
  type Snippet,
  type SnippetVersion,
  type Status,
} from "./schemas";
import type { z } from "zod";

export class DataError extends Error {}

function check<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new DataError(res.error.message);
  if (res.data === null) throw new DataError("Not found");
  return res.data;
}

function validate<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const r = schema.safeParse(input);
  if (!r.success) throw new DataError(firstIssue(r.error));
  return r.data;
}

// ------------------------------------------------------------------ keys
export const keys = {
  experiments: (f: ExperimentFilters) => ["experiments", JSON.stringify(f)] as const,
  experiment: (id: string) => ["experiment", id] as const,
  snippets: (experimentId: string) => ["snippets", experimentId] as const,
  versions: (snippetId: string) => ["versions", snippetId] as const,
  runs: (experimentId: string) => ["runs", experimentId] as const,
  projects: ["projects"] as const,
  project: (id: string) => ["project", id] as const,
  tags: ["tags"] as const,
};

/** Revalidate every cached experiment list (search results, project pages). */
export function refreshLists() {
  return globalMutate((key) => Array.isArray(key) && (key[0] === "experiments" || key[0] === "tags"));
}

// ------------------------------------------------------------------ experiments
export interface ExperimentFilters {
  q?: string;
  statuses?: Status[];
  tags?: string[];
  language?: string | null;
  projectId?: string | null;
}

const LIST_COLUMNS = "*, projects(name), snippets(language), runs(count)";

export async function searchExperiments(f: ExperimentFilters): Promise<ExperimentListItem[]> {
  const res = await supabase()
    .rpc("search_experiments", {
      q: buildTsQuery(f.q ?? ""),
      p_statuses: f.statuses?.length ? f.statuses : null,
      p_tags: f.tags?.length ? f.tags : null,
      p_language: f.language || null,
      p_project: f.projectId || null,
    })
    .select(LIST_COLUMNS);
  return check(res) as unknown as ExperimentListItem[];
}

export function useExperiments(f: ExperimentFilters) {
  return useSWR(keys.experiments(f), () => searchExperiments(f), { keepPreviousData: true });
}

export interface ExperimentDetail extends Experiment {
  projects: { id: string; name: string } | null;
}

export function useExperiment(id: string) {
  return useSWR(keys.experiment(id), async () => {
    const res = await supabase().from("experiments").select("*, projects(id, name)").eq("id", id).maybeSingle();
    return check(res) as ExperimentDetail;
  });
}

export async function createExperiment(input: z.input<typeof experimentCreate>): Promise<Experiment> {
  const row = validate(experimentCreate, input);
  const created = check(await supabase().from("experiments").insert(row).select().single()) as Experiment;
  void refreshLists();
  return created;
}

export async function updateExperiment(id: string, patch: ExperimentPatch): Promise<Experiment> {
  const row = validate(experimentPatch, patch);
  const updated = check(await supabase().from("experiments").update(row).eq("id", id).select().single()) as Experiment;
  void refreshLists();
  return updated;
}

export async function deleteExperiment(id: string) {
  check(await supabase().from("experiments").delete().eq("id", id).select("id").single());
  void refreshLists();
}

export async function forkExperiment(id: string): Promise<string> {
  const newId = check(await supabase().rpc("fork_experiment", { p_id: id })) as string;
  void refreshLists();
  return newId;
}

export function useTags() {
  return useSWR(keys.tags, async () => check(await supabase().rpc("my_tags")) as { tag: string; uses: number }[]);
}

// ------------------------------------------------------------------ projects
export function useProjects() {
  return useSWR(keys.projects, async () => {
    const res = await supabase().from("projects").select("*, experiments(count)").order("updated_at", { ascending: false });
    return check(res) as (Project & { experiments: { count: number }[] })[];
  });
}

export function useProject(id: string) {
  return useSWR(keys.project(id), async () => check(await supabase().from("projects").select("*").eq("id", id).maybeSingle()) as Project);
}

export async function createProject(input: ProjectInput): Promise<Project> {
  const row = validate(projectInput, input);
  const p = check(await supabase().from("projects").insert(row).select().single()) as Project;
  void globalMutate(keys.projects);
  return p;
}

export async function updateProject(id: string, input: Partial<ProjectInput>): Promise<Project> {
  const row = validate(projectInput.partial(), input);
  const p = check(await supabase().from("projects").update(row).eq("id", id).select().single()) as Project;
  void globalMutate(keys.projects);
  return p;
}

export async function deleteProject(id: string) {
  check(await supabase().from("projects").delete().eq("id", id).select("id").single());
  void globalMutate(keys.projects);
  void refreshLists();
}

// ------------------------------------------------------------------ snippets
export function useSnippets(experimentId: string) {
  return useSWR(keys.snippets(experimentId), async () => {
    const res = await supabase().from("snippets").select("*").eq("experiment_id", experimentId).order("position").order("created_at");
    return check(res) as Snippet[];
  });
}

export async function createSnippet(experimentId: string, input: { filename: string; language: string; content: string }, position: number): Promise<Snippet> {
  const row = validate(snippetInput, input);
  const s = check(
    await supabase().from("snippets").insert({ ...row, experiment_id: experimentId, position }).select().single(),
  ) as Snippet;
  void globalMutate(keys.snippets(experimentId));
  return s;
}

export async function updateSnippet(id: string, patch: { filename?: string; language?: string; content?: string }): Promise<Snippet> {
  const row = validate(snippetPatch, patch);
  const s = check(await supabase().from("snippets").update(row).eq("id", id).select().single()) as Snippet;
  void globalMutate(keys.versions(id));
  return s;
}

export async function deleteSnippet(snippet: Snippet) {
  check(await supabase().from("snippets").delete().eq("id", snippet.id).select("id").single());
  void globalMutate(keys.snippets(snippet.experiment_id));
}

export function useVersions(snippetId: string | null) {
  return useSWR(snippetId ? keys.versions(snippetId) : null, async () => {
    const res = await supabase()
      .from("snippet_versions")
      .select("*")
      .eq("snippet_id", snippetId!)
      .order("version", { ascending: false })
      .limit(100);
    return check(res) as SnippetVersion[];
  });
}

// ------------------------------------------------------------------ runs
export function useRuns(experimentId: string) {
  return useSWR(keys.runs(experimentId), async () => {
    const res = await supabase().from("runs").select("*").eq("experiment_id", experimentId).order("ran_at", { ascending: false });
    return check(res) as Run[];
  });
}

export async function saveRun(experimentId: string, input: RunInput, id?: string): Promise<Run> {
  const row = validate(runInput, input);
  const q = id
    ? supabase().from("runs").update(row).eq("id", id)
    : supabase().from("runs").insert({ ...row, experiment_id: experimentId });
  const r = check(await q.select().single()) as Run;
  void globalMutate(keys.runs(experimentId));
  void refreshLists();
  return r;
}

export async function deleteRun(run: Run) {
  check(await supabase().from("runs").delete().eq("id", run.id).select("id").single());
  void globalMutate(keys.runs(run.experiment_id));
  void refreshLists();
}

export async function fetchExportData(id: string) {
  const sb = supabase();
  const [e, s, r] = await Promise.all([
    sb.from("experiments").select("*, projects(name)").eq("id", id).single(),
    sb.from("snippets").select("*").eq("experiment_id", id).order("position"),
    sb.from("runs").select("*").eq("experiment_id", id).order("ran_at", { ascending: false }),
  ]);
  const experiment = check(e) as Experiment & { projects: { name: string } | null };
  return { experiment, projectName: experiment.projects?.name ?? null, snippets: check(s) as Snippet[], runs: check(r) as Run[] };
}
