"use client";
// The signed-in app's frame. Phones: just the page (each page has its own top bar). Desktop
// (lg, 1024px+): a sidebar with New note, the main places, the projects and the account, beside the
// page; pages then hide their own logo and links the sidebar has (`shell-hide`, globals.css).
// A full-screen output page (/n/<id>/out/...) gets no sidebar.
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createNote, useProjects } from "@/lib/data";
import { cn } from "@/lib/ui/format";
import { userMessage } from "@/lib/ui/user-message";
import { Button, IconFolder, IconMap, IconNote, IconPlus, IconSettings, Logo, Notice } from "../ui";
import { UpdateBanner } from "./update-banner";

const item = "flex min-h-10 items-center gap-3 rounded-md px-3 text-sm transition-colors";
const tone = (on: boolean) => (on ? "bg-raise font-medium text-fg" : "text-muted hover:bg-tint/60 hover:text-fg");

function NavLink({ href, on, children }: { href: string; on: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} aria-current={on ? "page" : undefined} className={cn(item, tone(on))}>
      {children}
    </Link>
  );
}

export function AppShell({ children, username }: { children: React.ReactNode; username: string }) {
  const path = usePathname() ?? "/";
  const router = useRouter();
  const { data: projects } = useProjects();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Notes used to be kept in the browser for offline use: forget any such copy (and the old notes folder).
  useEffect(() => {
    try {
      indexedDB?.deleteDatabase("benchjot-offline");
      indexedDB?.deleteDatabase("benchjot-folder");
    } catch {}
  }, []);
  if (/^\/n\/[^/]+\/out\//.test(path)) return <><UpdateBanner />{children}</>;

  const projectId = /^\/p\/([^/]+)/.exec(path)?.[1] ?? null;
  async function newNote() {
    setBusy(true);
    setError(null);
    try {
      const note = await createNote("", projectId);
      router.push(`/n/${note.id}`);
    } catch (e) {
      setError(userMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-shell className="lg:pl-64">
      <aside aria-label="Workspace" className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-line bg-bg px-3 lg:flex">
        <div className="flex h-16 items-center px-2">
          <Logo />
        </div>
        <Button onClick={() => void newNote()} loading={busy} variant="soft" className="mx-1 text-sm">
          {!busy && <IconPlus className="size-4" />}
          New note
        </Button>
        {error && (
          <Notice className="mx-1 mt-3 text-xs" actions={[{ label: "Try again", onClick: () => void newNote() }]} onDismiss={() => setError(null)}>
            {error}
          </Notice>
        )}
        <nav aria-label="Main" className="mt-5 flex flex-col gap-0.5">
          <NavLink href="/" on={path === "/"}><IconNote className="size-4" />All notes</NavLink>
          <NavLink href="/map" on={path.startsWith("/map")}><IconMap className="size-4" />Research map</NavLink>
          <NavLink href="/settings" on={path.startsWith("/settings")}><IconSettings className="size-4" />Settings</NavLink>
        </nav>
        <p className="eyebrow mt-7 px-3 pb-2">Projects</p>
        <nav aria-label="Projects" className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
          {projects?.length ? (
            <div className="flex flex-col gap-0.5">
              {projects.map((p) => (
                <NavLink key={p.id} href={`/p/${p.id}`} on={projectId === p.id}>
                  <IconFolder className="size-4" />
                  <span className="truncate">{p.name}</span>
                </NavLink>
              ))}
            </div>
          ) : (
            <p className="px-3 text-xs leading-relaxed text-faint">None yet. New project is on All notes.</p>
          )}
        </nav>
        <Link href="/settings" className="-mx-1 mb-2 flex items-center gap-3 rounded-xl border-t border-line px-3 py-3 text-xs leading-relaxed transition-colors hover:bg-tint/60">
          <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full border border-line bg-raise font-display text-[15px] text-fg">{username.slice(0, 1).toUpperCase()}</span>
          <span className="min-w-0">
            <span className="block truncate text-[13px] text-fg">@{username}</span>
            <span className="block text-muted">Free · browser and GPU runs</span>
          </span>
        </Link>
      </aside>
      <UpdateBanner />
      {children}
    </div>
  );
}
