// Validation contracts (zod) and row types. One authoritative place for both.
import { z } from "zod";
import { LANGUAGE_IDS } from "./languages";

export const STATUSES = ["planned", "running", "done", "failed", "abandoned"] as const;
export type Status = (typeof STATUSES)[number];
export const statusSchema = z.enum(STATUSES);

export const STATUS_LABEL: Record<Status, string> = {
  planned: "Planned",
  running: "Running",
  done: "Done",
  failed: "Failed",
  abandoned: "Abandoned",
};

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine((s) => !Number.isNaN(Date.parse(s)), "Not a real date");

export const tagSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(40, "Tags are at most 40 characters")
  .regex(/^[\p{L}\p{N}][\p{L}\p{N}\-_.+/#]*$/u, "Tags use letters, numbers and - _ . + / #");

export const tagsSchema = z
  .array(tagSchema)
  .max(30, "At most 30 tags")
  .transform((tags) => [...new Set(tags)]);

/** Split free text ("cnn, mnist  baseline") into normalised tags. */
export function parseTags(input: string): string[] {
  return tagsSchema.parse(
    input
      .split(/[,\s]+/)
      .map((t) => t.replace(/^#/, ""))
      .filter(Boolean),
  );
}

export const projectInput = z.object({
  name: z.string().trim().min(1, "Name your project").max(120),
  description: z.string().max(2000).default(""),
});
export type ProjectInput = z.input<typeof projectInput>;

const experimentFields = z.object({
  title: z.string().trim().min(1, "Give it a title").max(200),
  hypothesis: z.string().max(4000),
  status: statusSchema,
  tags: tagsSchema,
  notes: z.string().max(200_000),
  project_id: z.uuid().nullable(),
  started_on: isoDate.nullable(),
  ended_on: isoDate.nullable(),
  pinned: z.boolean(),
});

const datesInOrder = (v: { started_on?: string | null; ended_on?: string | null }) =>
  !v.started_on || !v.ended_on || v.started_on <= v.ended_on;
const datesMessage = { message: "End date is before start date", path: ["ended_on"] };

export const experimentCreate = experimentFields
  .partial()
  .required({ title: true })
  .refine(datesInOrder, datesMessage);
export const experimentPatch = experimentFields.partial().refine(datesInOrder, datesMessage);
export type ExperimentPatch = z.input<typeof experimentPatch>;

export const languageSchema = z.enum(LANGUAGE_IDS);

export const snippetInput = z.object({
  filename: z.string().trim().max(200),
  language: languageSchema,
  content: z.string().max(500_000, "Snippet is over 500k characters"),
});
export const snippetPatch = snippetInput.partial();

const kvKey = z.string().trim().min(1).max(120);
export const linkSchema = z.object({
  label: z.string().trim().max(120).default(""),
  url: z.url({ protocol: /^https?$/, message: "Links must start with http(s)://" }),
});
export type Link = z.infer<typeof linkSchema>;

export const runInput = z.object({
  name: z.string().trim().min(1, "Name the run").max(200),
  params: z.record(kvKey, z.string().max(2000)),
  env: z.record(kvKey, z.string().max(2000)),
  metrics: z.record(kvKey, z.number().refine(Number.isFinite, "Metrics must be finite numbers")),
  outcome: z.string().max(20_000),
  links: z.array(linkSchema).max(30),
  ran_at: z.iso.datetime({ offset: true }),
});
export type RunInput = z.infer<typeof runInput>;

/** First human-readable message from a zod error. */
export function firstIssue(err: z.ZodError): string {
  const issue = err.issues[0];
  if (!issue) return "Invalid input";
  const where = issue.path.length ? `${issue.path.join(".")}: ` : "";
  return `${where}${issue.message}`;
}

// ------------------------------------------------------------- row types
export interface Project {
  id: string;
  user_id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
}

export interface Experiment {
  id: string;
  user_id: string;
  project_id: string | null;
  title: string;
  hypothesis: string;
  status: Status;
  tags: string[];
  notes: string;
  pinned: boolean;
  started_on: string | null;
  ended_on: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExperimentListItem extends Experiment {
  projects: { name: string } | null;
  snippets: { language: string }[];
  runs: { count: number }[];
}

export interface Snippet {
  id: string;
  user_id: string;
  experiment_id: string;
  filename: string;
  language: string;
  content: string;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface SnippetVersion {
  id: string;
  snippet_id: string;
  version: number;
  content: string;
  language: string;
  filename: string;
  created_at: string;
  updated_at: string;
}

export interface Run {
  id: string;
  user_id: string;
  experiment_id: string;
  name: string;
  params: Record<string, string>;
  env: Record<string, string>;
  metrics: Record<string, number>;
  outcome: string;
  links: Link[];
  ran_at: string;
  created_at: string;
  updated_at: string;
}
