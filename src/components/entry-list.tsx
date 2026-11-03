"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { APP_NAME } from "@/config/app";
import { createEntry, useEntries } from "@/lib/data";
import { displayTitle, listDate } from "@/lib/format";
import { Column, TextButton, TextLink, TopBar } from "./ui";

export function EntryList() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { data: entries, error: loadError } = useEntries(query);

  async function newEntry() {
    setCreating(true);
    setError(null);
    try {
      const entry = await createEntry();
      router.push(`/n/${entry.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create a note");
      setCreating(false);
    }
  }

  return (
    <Column>
      <TopBar
        left={<span className="font-medium">{APP_NAME}</span>}
        right={
          <>
            <TextButton onClick={newEntry} disabled={creating}>
              New
            </TextButton>
            <TextLink href="/settings">Settings</TextLink>
          </>
        }
      />
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search"
        aria-label="Search"
        className="mt-4 h-11 w-full border-b border-line outline-none focus:border-faint"
      />
      {(error || loadError) && <p className="py-3 text-sm text-muted">{error ?? "Could not load notes."}</p>}
      {entries && entries.length === 0 && (
        <p className="py-10 text-sm text-muted">{query.trim() ? "Nothing matches." : "No notes yet."}</p>
      )}
      <ul className="divide-y divide-line pb-16">
        {entries?.map((e) => (
          <li key={e.id}>
            <Link href={`/n/${e.id}`} className="flex items-baseline justify-between gap-6 py-4">
              <span className={e.title.trim() ? "truncate" : "truncate text-muted"}>{displayTitle(e.title)}</span>
              <span className="shrink-0 text-xs tabular-nums text-faint">{listDate(e.updated_at)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Column>
  );
}
