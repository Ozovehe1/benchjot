"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { LogOut, Moon, Sun } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { cn } from "@/lib/format";
import { Button, Kbd } from "./ui";
import { PageHeader } from "./page-header";

export function SettingsView() {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const [email, setEmail] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    void supabase()
      .auth.getUser()
      .then(({ data }) => setEmail(data.user?.email ?? null));
  }, []);

  async function signOut() {
    setSigningOut(true);
    await supabase().auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <>
      <PageHeader title="Settings" />
      <main className="mx-auto max-w-2xl space-y-4 px-4 py-6 md:px-6">
        <section className="rounded-2xl border border-border bg-surface p-4">
          <h2 className="text-sm font-medium text-muted">Appearance</h2>
          <div className="mt-3 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Theme">
            {[
              { id: "dark", label: "Dark", icon: Moon },
              { id: "light", label: "Light", icon: Sun },
            ].map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                role="radio"
                aria-checked={resolvedTheme === id}
                onClick={() => setTheme(id)}
                className={cn(
                  "flex h-12 items-center justify-center gap-2 rounded-xl border text-sm font-medium transition-colors",
                  resolvedTheme === id ? "border-accent/60 bg-accent-soft text-fg" : "border-border text-muted hover:text-fg",
                )}
              >
                <Icon className="size-4" />
                {label}
              </button>
            ))}
          </div>
        </section>

        <section className="hidden rounded-2xl border border-border bg-surface p-4 md:block">
          <h2 className="text-sm font-medium text-muted">Keyboard</h2>
          <dl className="mt-3 space-y-2 text-sm">
            {[
              ["Search & commands", "Ctrl K"],
              ["Save now", "Ctrl S"],
              ["Search inside code", "Ctrl F"],
            ].map(([what, keys]) => (
              <div key={what} className="flex items-center justify-between">
                <dt>{what}</dt>
                <dd>
                  <Kbd>{keys}</Kbd>
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="rounded-2xl border border-border bg-surface p-4">
          <h2 className="text-sm font-medium text-muted">Account</h2>
          <p className="mt-2 truncate text-[15px]">{email ?? "…"}</p>
          <Button variant="danger" className="mt-4 w-full" onClick={signOut} loading={signingOut}>
            <LogOut className="size-4" />
            Sign out
          </Button>
        </section>
        <p className="pt-2 text-center text-xs text-faint">Your notes are private to your account.</p>
      </main>
    </>
  );
}
