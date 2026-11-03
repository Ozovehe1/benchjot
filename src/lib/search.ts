// Turns what the user typed into search terms for the search_entries RPC.
// Terms are whitespace-separated and matched literally (case-insensitive
// substring), so "torch.cos" finds exactly that.

const MAX_TERMS = 8;
const MAX_TERM_LENGTH = 64;

export function searchTerms(input: string): string[] {
  const terms = input.toLowerCase().split(/\s+/).filter(Boolean);
  return [...new Set(terms.map((t) => t.slice(0, MAX_TERM_LENGTH)))].slice(0, MAX_TERMS);
}
