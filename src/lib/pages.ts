// Paging through PostgREST, which answers at most PAGE_ROWS rows a request. Pure: no client import.

/** PostgREST answers at most this many rows per request (Supabase's max rows). */
export const PAGE_ROWS = 1000;

/** Every row of a query, a page at a time, so long lists aren't cut at the server's row cap. Rows are typed by the caller (`T`). */
export async function allRows<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_ROWS) {
    const res = await page(from, from + PAGE_ROWS - 1);
    if (res.error) throw new Error(res.error.message, { cause: res.error }); // shown via userMessage, never raw
    const got = (res.data ?? []) as T[];
    rows.push(...got);
    if (got.length < PAGE_ROWS) return rows;
  }
}

