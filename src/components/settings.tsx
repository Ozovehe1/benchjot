"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { supabase } from "@/lib/supabase/client";
import { cn } from "@/lib/format";
import { Column, TextButton, TextLink, TopBar } from "./ui";

const THEMES = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
] as const;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-14 items-center justify-between gap-6 border-b border-line">
      <span className="text-muted">{label}</span>
      <div className="flex min-w-0 items-center gap-5">{children}</div>
    </div>
  );
}

export function Settings() {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [email, setEmail] = useState("");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    void supabase()
      .auth.getUser()
      .then(({ data }) => setEmail(data.user?.email ?? ""));
  }, []);

  async function signOut() {
    await supabase().auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <Column>
      <TopBar left={<TextLink href="/">All notes</TextLink>} />
      <h1 className="mt-6 mb-4 font-semibold">Settings</h1>
      <div className="border-t border-line">
        <Row label="Account">
          <span className="truncate">{email}</span>
        </Row>
        <Row label="Theme">
          <div role="radiogroup" aria-label="Theme" className="flex gap-5">
            {THEMES.map((t) => (
              <TextButton
                key={t.id}
                role="radio"
                aria-checked={mounted && theme === t.id}
                onClick={() => setTheme(t.id)}
                className={cn(mounted && theme === t.id && "text-fg underline underline-offset-4")}
              >
                {t.label}
              </TextButton>
            ))}
          </div>
        </Row>
      </div>
      <TextButton onClick={signOut} className="mt-6">
        Sign out
      </TextButton>
    </Column>
  );
}
