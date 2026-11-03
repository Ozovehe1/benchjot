// Turns what the user typed into a safe Postgres tsquery string with prefix
// matching ("lr sched" -> "lr:* & sched:*"). Anything that is not a letter or
// digit is treated as a separator, so tsquery syntax can never be injected.

const MAX_TERMS = 8;
const MAX_TERM_LENGTH = 64;

export function searchTerms(input: string): string[] {
  const terms = input.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return [...new Set(terms.map((t) => t.slice(0, MAX_TERM_LENGTH)))].slice(0, MAX_TERMS);
}

export function buildTsQuery(input: string): string {
  return searchTerms(input)
    .map((t) => `${t}:*`)
    .join(" & ");
}
