import { Logo } from "../ui";

/** Plain reading page for the privacy policy and terms. */
export function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[640px] px-5 pb-16">
      <header className="flex h-16 items-center">
        <Logo />
      </header>
      <main className="space-y-4 text-[15px] leading-relaxed [&_h2]:mt-10 [&_h2]:font-display [&_h2]:text-[22px] [&_h2]:font-medium [&_h2]:tracking-[-0.01em]">
        <h1 className="text-[40px] font-normal leading-tight tracking-[-0.02em]">{title}</h1>
        <p className="text-sm text-muted">Last updated {updated}</p>
        {children}
      </main>
    </div>
  );
}
