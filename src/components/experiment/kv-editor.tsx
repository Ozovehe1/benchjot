"use client";
import { useState } from "react";
import { ClipboardPaste, Plus, X } from "lucide-react";
import { parseKVText, type KVRow } from "@/lib/kv";
import { IconButton, Textarea, Button } from "../ui";

/** Editable list of key/value rows with a "paste lines" shortcut. */
export function KVEditor({
  label,
  rows,
  onChange,
  keyPlaceholder,
  valuePlaceholder,
  numeric,
}: {
  label: string;
  rows: KVRow[];
  onChange: (rows: KVRow[]) => void;
  keyPlaceholder: string;
  valuePlaceholder: string;
  numeric?: boolean;
}) {
  const [pasting, setPasting] = useState(false);
  const [paste, setPaste] = useState("");
  const update = (i: number, patch: Partial<KVRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const cell =
    "h-11 min-w-0 rounded-lg border border-border bg-surface-2 px-3 font-mono text-[14px] text-fg placeholder:text-faint focus:border-accent focus:outline-none md:h-9 md:text-[13px]";
  const pastedCount = parseKVText(paste).length;

  return (
    <fieldset>
      <div className="mb-1.5 flex items-center justify-between">
        <legend className="text-[13px] font-medium text-muted">{label}</legend>
        <button type="button" onClick={() => setPasting((p) => !p)} className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs text-faint hover:text-fg">
          <ClipboardPaste className="size-3.5" /> Paste lines
        </button>
      </div>
      {pasting && (
        <div className="mb-2 space-y-2">
          <Textarea
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            rows={4}
            placeholder={"lr=3e-4\n--batch_size 64\nseed: 42"}
            className="font-mono text-[13px]"
            aria-label={`Paste ${label} as lines`}
          />
          <Button
            size="sm"
            disabled={!pastedCount}
            onClick={() => {
              const parsed = parseKVText(paste);
              const kept = rows.filter((r) => r.key.trim() || r.value.trim());
              onChange([...kept.filter((r) => !parsed.some((p) => p.key === r.key)), ...parsed]);
              setPaste("");
              setPasting(false);
            }}
          >
            Add {pastedCount || ""} rows
          </Button>
        </div>
      )}
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2">
            <input
              aria-label={`${label} key ${i + 1}`}
              value={r.key}
              onChange={(e) => update(i, { key: e.target.value })}
              placeholder={keyPlaceholder}
              className={cell}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
            <input
              aria-label={`${label} value ${i + 1}`}
              value={r.value}
              onChange={(e) => update(i, { value: e.target.value })}
              placeholder={valuePlaceholder}
              inputMode={numeric ? "decimal" : undefined}
              className={cell}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
            <IconButton label={`Remove ${r.key || "row"}`} onClick={() => onChange(rows.filter((_, j) => j !== i))}>
              <X className="size-4" />
            </IconButton>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => onChange([...rows, { key: "", value: "" }])}
        className="mt-2 inline-flex h-10 items-center gap-1.5 rounded-lg px-2 text-sm text-accent hover:bg-accent-soft md:h-8"
      >
        <Plus className="size-4" /> Add row
      </button>
    </fieldset>
  );
}
