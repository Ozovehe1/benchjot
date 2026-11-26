// The app's sidebar contents: the logo, New note, the main places, the projects and the account card.
// Presentational (AppShell supplies the data), so the landing's showcase draws the very same sidebar.
import Link from "next/link";
import { cn } from "@/lib/ui/format";
import { Button, IconDatabase, IconFolder, IconImage, IconMap, IconNote, IconPlus, Logo, Notice } from "../ui";

const item = "flex min-h-10 items-center gap-3 rounded-md px-3 text-sm transition-colors";
// The sidebar recedes: dim until hovered or current, so the note leads (Linear's refresh).
const tone = (on: boolean) => (on ? "bg-raise font-medium text-fg" : "text-faint hover:bg-tint/60 hover:text-fg");

function NavLink({ href, on, children }: { href: string; on: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} aria-current={on ? "page" : undefined} className={cn(item, tone(on))}>
      {children}
    </Link>
  );
}

/** What the sidebar holds: the logo, New note, the main places, the projects and the account card. Drawn here and by the landing's showcase. */
export function SidebarBody({ path, projects, projectId, username, onNewNote, busy = false, error = null, onDismissError }: {
  path: string;
  projects: readonly { id: string; name: string }[];
  projectId: string | null;
  username: string;
  onNewNote: () => void;
  busy?: boolean;
  error?: string | null;
  onDismissError?: () => void;
}) {
  return (
    <>
        <div className="flex h-16 items-center px-2">
          <Logo />
        </div>
        <Button onClick={onNewNote} loading={busy} variant="soft" className="mx-1 text-sm">
          {!busy && <IconPlus className="size-4" />}
          New note
        </Button>
        {error && (
          <Notice className="mx-1 mt-3 text-xs" actions={[{ label: "Try again", onClick: onNewNote }]} onDismiss={onDismissError}>
            {error}
          </Notice>
        )}
        {/* By what things are: the experiments, what they showed, what they used, how they connect. Settings is the account card below. */}
        <nav aria-label="Main" className="mt-5 flex flex-col gap-0.5">
          <NavLink href="/" on={path === "/"}><IconNote className="size-4" />All notes</NavLink>
          <NavLink href="/figures" on={path.startsWith("/figures")}><IconImage className="size-4" />Figures</NavLink>
          <NavLink href="/data" on={path.startsWith("/data")}><IconDatabase className="size-4" />Data</NavLink>
          <NavLink href="/map" on={path.startsWith("/map")}><IconMap className="size-4" />Research map</NavLink>
        </nav>
        <p className="eyebrow mt-7 px-3 pb-2">Projects</p>
        <nav aria-label="Projects" className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
          {projects.length ? (
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
        <Link href="/settings" aria-current={path.startsWith("/settings") ? "page" : undefined} className={cn("-mx-1 mb-2 flex items-center gap-3 rounded-xl border-t border-line px-3 py-3 text-xs leading-relaxed transition-colors hover:bg-tint/60", path.startsWith("/settings") && "bg-tint")}>
          <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full border border-line bg-raise font-display text-[15px] text-fg">{username.slice(0, 1).toUpperCase()}</span>
          <span className="min-w-0">
            <span className="block truncate text-[13px] text-fg">@{username}</span>
            <span className="block text-muted">Settings and usage</span>
          </span>
        </Link>
    </>
  );
}
