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
import { Button, IconDatabase, IconFolder, IconImage, IconMap, IconNote, IconPlus, Logo, Notice } from "../ui";
import { UpdateBanner } from "./update-banner";
import { SidebarBody } from "./sidebar-body";

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
      <aside aria-label="Workspace" className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-shell px-3 lg:flex">
        <SidebarBody path={path} projects={projects ?? []} projectId={projectId} username={username} onNewNote={() => void newNote()} busy={busy} error={error} onDismissError={() => setError(null)} />
      </aside>
      <UpdateBanner />
      {children}
    </div>
  );
}

