// One visual on Figures: the picture on white, its title, and where it came from. Presentational, so
// the landing's showcase draws the very same card.
import Link from "next/link";

export function FigureCard({ href, src, alt, title, sub }: { href: string; src?: string; alt: string; title: string; sub: string }) {
  return (
    <Link href={href} className="group block">
      <span className="block overflow-hidden rounded-xl bg-white">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {src && <img src={src} alt={alt} loading="lazy" className="aspect-[4/3] w-full object-contain transition-transform group-hover:scale-[1.01]" />}
      </span>
      <span className="mt-2.5 block truncate text-[14px] font-medium text-fg">{title}</span>
      <span className="mt-0.5 block truncate text-xs text-faint">{sub}</span>
    </Link>
  );
}
