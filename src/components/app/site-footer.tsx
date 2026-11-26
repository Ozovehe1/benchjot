import { TextLink } from "../ui";

/** The public pages' footer (front page and every reading page): the pages that explain Benchjot, linked to each other. */
export const SITE_PAGES = [
  { href: "/guide", label: "Guide" },
  { href: "/free", label: "Free plan" },
  { href: "/security", label: "Security" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
] as const;

export function SiteFooter({ current }: { current?: string }) {
  return (
    <footer className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-line py-6 text-[13px] text-muted">
      <span>benchjot</span>
      <nav aria-label="About Benchjot" className="flex flex-wrap gap-x-5">
        {SITE_PAGES.map((p) => (
          <TextLink key={p.href} href={p.href} aria-current={current === p.href ? "page" : undefined} className={current === p.href ? "text-[13px] text-fg" : "text-[13px]"}>
            {p.label}
          </TextLink>
        ))}
      </nav>
    </footer>
  );
}
