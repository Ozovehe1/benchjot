"use client";
// The landing's product tour: real screens of the app (public/showcase/, captured from the app itself
// with a sample account by scripts/capture-showcase.mjs), one per part of the product. A tab shows its
// screen; nothing moves by itself (self-advancing carousels get ignored and take control away). Phones
// see the phone captures.
import Image from "next/image";
import { useState } from "react";
import { cn } from "@/lib/ui/format";

export type TourScreen = { id: string; label: string; title: string; text: string; desktop: string; phone: string };

export function ScreenTour({ screens }: { screens: readonly TourScreen[] }) {
  const [at, setAt] = useState(0);
  const s = screens[at]!;
  return (
    <div>
      <div role="tablist" aria-label="Parts of Benchjot" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
        {screens.map((x, i) => (
          <button
            key={x.id}
            role="tab"
            type="button"
            aria-selected={i === at}
            aria-controls="tour-screen"
            onClick={() => setAt(i)}
            className={cn("shrink-0 rounded-full px-4 py-2 text-[13.5px] transition-colors", i === at ? "bg-fg text-bg" : "bg-tint text-muted hover:text-fg")}
          >
            {x.label}
          </button>
        ))}
      </div>

      <div id="tour-screen" role="tabpanel" aria-label={s.label} className="mt-6 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="relative">
          <div aria-hidden className="pointer-events-none absolute -inset-x-8 -top-16 h-72 bg-[radial-gradient(60%_60%_at_50%_40%,color-mix(in_oklab,var(--fg)_8%,transparent),transparent)]" />
          {/* Desktop screens on wider screens, phone screens on phones. All stay mounted, so changing is a crossfade. */}
          <div className="relative hidden overflow-hidden rounded-2xl border border-line shadow-float sm:block">
            <div className="relative aspect-[16/10]">
              {screens.map((x, i) => (
                <Image key={x.id} src={x.desktop} alt={i === at ? `${x.label}: ${x.title}` : ""} fill priority={i === 0} sizes="(min-width: 1280px) 860px, 90vw" className={cn("object-cover object-top transition-opacity duration-500 motion-reduce:transition-none", i === at ? "opacity-100" : "opacity-0")} />
              ))}
            </div>
          </div>
          <div className="relative mx-auto w-[78%] max-w-[340px] overflow-hidden rounded-[28px] border border-line shadow-float sm:hidden">
            <div className="relative aspect-[1082/2202]">
              {screens.map((x, i) => (
                <Image key={x.id} src={x.phone} alt={i === at ? `${x.label}: ${x.title}` : ""} fill priority={i === 0} sizes="78vw" className={cn("object-cover object-top transition-opacity duration-500 motion-reduce:transition-none", i === at ? "opacity-100" : "opacity-0")} />
              ))}
            </div>
          </div>
        </div>
        <div aria-live="polite" className="lg:pt-6">
          <h3 className="font-display text-[26px] font-normal leading-tight tracking-[-0.01em] lg:text-[30px]">{s.title}</h3>
          <p className="mt-3 text-[15.5px] leading-relaxed text-muted">{s.text}</p>
        </div>
      </div>
    </div>
  );
}
