// One connection in Settings (AI, Hugging Face), laid out like a settings row: its name and status
// on the left, the one action on the right, a line on what it's for, and the details folded away
// under "How it works".
export function ConnectionRow({
  id,
  name,
  status,
  action,
  description,
  details,
  message,
}: {
  id: string;
  name: string;
  status: React.ReactNode;
  action: React.ReactNode;
  description: string;
  details: React.ReactNode;
  message?: string;
}) {
  return (
    <section id={id} aria-label={name} className="scroll-mt-20 border-b border-line py-4">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h3 className="font-medium">{name}</h3>
          <p className="truncate text-sm text-muted">{status}</p>
        </div>
        <div className="flex shrink-0 items-center">{action}</div>
      </div>
      <p className="mt-2 text-sm text-faint">{description}</p>
      {message && (
        <p role="status" className="mt-2 text-sm">
          {message}
        </p>
      )}
      <details className="group mt-1 text-sm">
        <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-muted hover:text-fg [&::-webkit-details-marker]:hidden">
          <span aria-hidden className="inline-block transition-transform group-open:rotate-90">›</span>
          How it works
        </summary>
        <div className="space-y-2 pb-1 text-muted">{details}</div>
      </details>
    </section>
  );
}

/** Numbered steps inside "How it works". */
export function Steps({ steps }: { steps: React.ReactNode[] }) {
  return (
    <ol className="space-y-1.5">
      {steps.map((s, i) => (
        <li key={i} className="flex gap-3">
          <span className="font-mono text-[12px] leading-5 text-faint">{i + 1}</span>
          <span>{s}</span>
        </li>
      ))}
    </ol>
  );
}
