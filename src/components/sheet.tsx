"use client";
// Bottom sheet on phones, centred dialog on desktop (vaul handles both).
import { Drawer } from "vaul";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/format";

function useIsDesktop() {
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const on = () => setDesktop(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return desktop;
}

export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: "md" | "lg";
}) {
  const desktop = useIsDesktop();
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} direction="bottom" handleOnly={desktop} repositionInputs={false}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]" />
        <Drawer.Content
          aria-describedby={undefined}
          className={cn(
            "fixed z-50 flex flex-col border-border bg-surface outline-none",
            "inset-x-0 bottom-0 max-h-[92dvh] rounded-t-3xl border-t",
            "md:inset-x-auto md:bottom-auto md:left-1/2 md:top-[8vh] md:max-h-[84vh] md:w-full md:-translate-x-1/2 md:rounded-2xl md:border",
            size === "lg" ? "md:max-w-3xl" : "md:max-w-lg",
          )}
        >
          <div className="mx-auto mt-2.5 h-1.5 w-10 shrink-0 rounded-full bg-border-strong md:hidden" aria-hidden />
          <div className="flex items-start justify-between gap-3 px-5 pb-2 pt-3 md:pt-5">
            <div className="min-w-0">
              <Drawer.Title className="text-lg font-semibold tracking-tight">{title}</Drawer.Title>
              {description && <Drawer.Description className="mt-0.5 text-sm text-muted">{description}</Drawer.Description>}
            </div>
            <Drawer.Close
              aria-label="Close"
              className="-mr-2 -mt-1 grid size-11 shrink-0 place-items-center rounded-xl text-muted hover:bg-surface-2 hover:text-fg md:size-9"
            >
              <X className="size-5" />
            </Drawer.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5" data-vaul-no-drag>
            {children}
          </div>
          {footer && <div className="border-t border-border px-5 py-3 pb-safe">{footer}</div>}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
