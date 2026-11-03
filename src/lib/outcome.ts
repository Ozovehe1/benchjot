// A note's outcome: the author marks an experiment Successful or Failed, or
// leaves it unmarked (null). One place for the values, labels and list filter.
// Rule (the user's): only the author decides. Nothing sets or changes it
// automatically (not run results, exit codes, errors or Fix); it starts
// unmarked and is written only by the note page's control (entry-view mark()).

export const OUTCOMES = ["success", "failed"] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const OUTCOME_LABEL: Record<Outcome, string> = { success: "Successful", failed: "Failed" };

export function isOutcome(value: unknown): value is Outcome {
  return (OUTCOMES as readonly unknown[]).includes(value);
}

/** The note page's 3-way control: unmarked ("—"), Successful, Failed. */
export const OUTCOME_CHOICES: { value: Outcome | null; label: string; name: string }[] = [
  { value: null, label: "—", name: "Unmarked" },
  { value: "success", label: OUTCOME_LABEL.success, name: OUTCOME_LABEL.success },
  { value: "failed", label: OUTCOME_LABEL.failed, name: OUTCOME_LABEL.failed },
];

/** The list filter. It narrows search and project views alike. */
export const OUTCOME_FILTERS = ["all", "success", "failed", "unmarked"] as const;
export type OutcomeFilter = (typeof OUTCOME_FILTERS)[number];

export const OUTCOME_FILTER_LABEL: Record<OutcomeFilter, string> = {
  all: "All",
  success: OUTCOME_LABEL.success,
  failed: OUTCOME_LABEL.failed,
  unmarked: "Unmarked",
};

/** The search_entries p_outcome argument: null means no filter. */
export function outcomeParam(filter: OutcomeFilter): Exclude<OutcomeFilter, "all"> | null {
  return filter === "all" ? null : filter;
}

/** One sentence of context for the Fix prompt, or nothing when unmarked. */
export function outcomeContext(outcome: Outcome | null | undefined): string {
  if (outcome === "failed") return "The author marked this experiment as failed.";
  if (outcome === "success") return "The author marked this experiment as successful.";
  return "";
}
