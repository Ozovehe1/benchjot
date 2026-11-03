"use client";
// App frame: sidebar on desktop, bottom nav on phones, global shortcuts.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FlaskConical, FolderTree, Plus, Search, Settings } from "lucide-react";
import { toast } from "sonner";
import { useSaveStatus } from "@/lib/autosave";
import { cn } from "@/lib/format";
import { Logo } from "./logo";
import { Kbd } from "./ui";
import { NewExperimentSheet } from "./new-experiment";
import { CommandPalette } from "./command-palette";
import { ThemeToggle } from "./theme-toggle";

interface Shell {
  openNew: (projectId?: string | null) => void;
  openPalette: () => void;
}
const ShellCtx = createContext<Shell | null>(null);
export function useShell() {
  const ctx = useContext(ShellCtx);
  if (!ctx) throw new Error("useShell must be used inside AppShell");
  return ctx;
}

const NAV = [
  { href: "/", label: "Experiments", icon: FlaskConical, match: (p: string) => p === "/" || p.startsWith("/e/") },
  { href: "/projects", label: "Projects", icon: FolderTree, match: (p: string) => p.startsWith("/projects") },
  { href: "/settings", label: "Settings", icon: Settings, match: (p: string) => p.startsWith("/settings") },
];

export function AppShell({ email, children }: { email: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const { flushAll } = useSaveStatus();
  const [newOpen, setNewOpen] = useState(false);
  const [newProject, setNewProject] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const openNew = useCallback((projectId?: string | null) => {
    setNewProject(projectId ?? null);
    setNewOpen(true);
  }, []);
  const openPalette = useCallback(() => setPaletteOpen(true), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      } else if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void flushAll().then(() => toast.success("Saved", { duration: 1200 }));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flushAll]);

  const shell = useMemo(() => ({ openNew, openPalette }), [openNew, openPalette]);

  return (
    <ShellCtx.Provider value={shell}>
      <div className="md:flex">
        {/* Desktop sidebar */}
        <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-border bg-surface/40 px-3 py-4 md:flex">
          <Link href="/" className="px-2">
            <Logo />
          </Link>
          <button
            onClick={openPalette}
            className="mt-5 flex h-9 items-center gap-2 rounded-xl border border-border bg-surface-2 px-3 text-sm text-faint hover:text-muted"
          >
            <Search className="size-4" />
            <span className="flex-1 text-left">Search…</span>
            <Kbd>Ctrl K</Kbd>
          </button>
          <button
            onClick={() => openNew()}
            className="mt-2 flex h-9 items-center gap-2 rounded-xl bg-accent px-3 text-sm font-semibold text-accent-fg hover:bg-accent-strong"
          >
            <Plus className="size-4" />
            New experiment
          </button>
          <nav className="mt-5 space-y-0.5" aria-label="Main">
            {NAV.map(({ href, label, icon: Icon, match }) => (
              <Link
                key={href}
                href={href}
                aria-current={match(pathname) ? "page" : undefined}
                className={cn(
                  "flex h-9 items-center gap-2.5 rounded-xl px-3 text-sm transition-colors",
                  match(pathname) ? "bg-surface-2 font-medium text-fg" : "text-muted hover:bg-surface-2 hover:text-fg",
                )}
              >
                <Icon className="size-4" />
                {label}
              </Link>
            ))}
          </nav>
          <div className="mt-auto flex items-center justify-between gap-2 px-2">
            <span className="truncate text-xs text-faint" title={email}>
              {email}
            </span>
            <ThemeToggle />
          </div>
        </aside>

        <div className="min-w-0 flex-1 pb-[calc(76px+env(safe-area-inset-bottom))] md:pb-0">{children}</div>
      </div>

      {/* Phone bottom nav */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-bg/90 pb-safe backdrop-blur-lg md:hidden"
      >
        <div className="mx-auto grid h-16 max-w-md grid-cols-5 items-center">
          <BottomItem {...NAV[0]!} active={NAV[0]!.match(pathname)} />
          <BottomItem {...NAV[1]!} active={NAV[1]!.match(pathname)} />
          <div className="flex justify-center">
            <button
              onClick={() => openNew()}
              aria-label="New experiment"
              className="grid size-12 place-items-center rounded-2xl bg-accent text-accent-fg shadow-lg shadow-accent/20 active:scale-95"
            >
              <Plus className="size-6" />
            </button>
          </div>
          <button onClick={openPalette} className="flex h-full flex-col items-center justify-center gap-1 text-faint">
            <Search className="size-5" />
            <span className="text-[11px]">Search</span>
          </button>
          <BottomItem {...NAV[2]!} active={NAV[2]!.match(pathname)} />
        </div>
      </nav>

      <NewExperimentSheet open={newOpen} onOpenChange={setNewOpen} defaultProjectId={newProject} />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </ShellCtx.Provider>
  );
}

function BottomItem({ href, label, icon: Icon, active }: (typeof NAV)[number] & { active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn("flex h-full flex-col items-center justify-center gap-1", active ? "text-accent" : "text-faint")}
    >
      <Icon className="size-5" />
      <span className="text-[11px]">{label}</span>
    </Link>
  );
}
