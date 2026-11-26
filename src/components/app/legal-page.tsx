import { IconChevron, Logo, TextLink } from "../ui";
import { SiteFooter } from "./site-footer";

// The reading pages (Free plan, Guide, Security, Privacy, Terms), organised for scanning
// (eyetracking research: people read the top and the left edge, then skip): a one-line answer
// first, the key facts as a row of cards, then every topic as a closed folder — its name and a
// one-line summary always visible, its full text a tap away. Folders are <details>: no script.

/** A reading page: title, one-line answer, then its facts and folders. */
export function LegalPage({ title, updated, lead, path, children }: { title: string; updated: string; lead?: React.ReactNode; /** This page's address, marked in the footer. */ path?: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[680px] px-5">
      <header className="flex h-16 items-center justify-between">
        <Logo />
        <TextLink href="/login" strong>Sign in</TextLink>
      </header>
      <main>
        <h1 className="mt-6 text-[40px] font-normal leading-tight tracking-[-0.02em]">{title}</h1>
        {lead && <p className="mt-4 text-[17px] leading-relaxed text-fg/90">{lead}</p>}
        <p className="mt-3 text-xs text-faint">Updated {updated}</p>
        <div className="mt-10 space-y-10">{children}</div>
      </main>
      <div className="mt-20">
        <SiteFooter current={path} />
      </div>
    </div>
  );
}

/** The key facts, each a big value with its label: what most visitors came for, without opening anything. */
export function Glance({ items }: { items: readonly { value: string; label: string }[] }) {
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map((it) => (
        <div key={it.label} className="card px-4 py-4">
          <dt className="sr-only">{it.label}</dt>
          <dd>
            <span className="block text-[24px] font-medium leading-none tracking-[-0.01em] text-fg">{it.value}</span>
            <span className="mt-2 block text-[13px] leading-snug text-muted">{it.label}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** A group of folders under a small heading. */
export function Folders({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section aria-label={title}>
      {title && <h2 className="eyebrow mb-3">{title}</h2>}
      <div className="card divide-y divide-line overflow-hidden">{children}</div>
    </section>
  );
}

/** One topic: closed, its icon, its name and one line on it; open, the whole text. Each icon names its topic, so the column of icons is itself a way to find one. */
export function Folder({ title, summary, icon: Icon, open, children }: { title: string; summary: string; icon: React.ComponentType<{ className?: string }>; open?: boolean; children: React.ReactNode }) {
  return (
    <details open={open} className="group">
      <summary className="flex min-h-16 cursor-pointer list-none items-center gap-4 px-4 py-3.5 transition-colors hover:bg-tint/50 sm:px-5 [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-lg bg-tint text-muted transition-colors group-open:text-fg">
          <Icon className="size-[18px]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-medium text-fg">{title}</span>
          <span className="mt-0.5 block text-[13px] leading-snug text-muted">{summary}</span>
        </span>
        <IconChevron className="size-4 shrink-0 rotate-90 text-faint transition-transform group-open:-rotate-90" />
      </summary>
      <div className="space-y-3 pb-5 pl-[68px] pr-4 text-[15px] leading-relaxed text-fg/90 sm:pl-[72px] sm:pr-5 [&_a]:underline [&_a]:underline-offset-4 [&_li]:mt-1.5 [&_ul]:list-disc [&_ul]:pl-5">{children}</div>
    </details>
  );
}
