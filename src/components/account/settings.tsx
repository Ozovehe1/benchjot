"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { signOut as endSession } from "@/lib/account/auth";
import { Column, Segmented, TextLink, TopBar } from "../ui";
import Link from "next/link";
import { DatasetKeys } from "./dataset-keys";
import { ConnectAi } from "./connect-ai";
import { Usage } from "./usage";

const THEMES = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
] as const;

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-14 items-center justify-between gap-6 border-b border-line py-2">
      <span className="text-muted">{label}</span>
      <div className="flex min-w-0 items-center gap-5">{children}</div>
    </div>
  );
}

/** A labelled group of settings: a card of rows, the last without a rule under it. */
function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={`s-${title}`} className="mt-10">
      <h2 id={`s-${title}`} className="eyebrow">
        {title}
      </h2>
      {hint && <p className="mt-1.5 text-sm text-muted">{hint}</p>}
      <div className="card mt-3 px-5 [&>*:last-child]:border-b-0">
        {children}
      </div>
    </section>
  );
}

export function Settings({
  email,
  username,
}: {
  email: string;
  username: string;
}) {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  async function signOut() {
    await endSession();
    router.replace("/login");
    router.refresh();
  }

  return (
    <Column>
      <TopBar left={<TextLink href="/">All notes</TextLink>} />
      <h1 className="mt-4 font-display text-[34px] leading-tight tracking-tight">
        Settings
      </h1>

      <Section title="Account">
        <div className="-mx-5 flex items-center gap-4 rounded-[inherit] px-5 py-5">
          <span
            aria-hidden
            className="grid size-12 shrink-0 place-items-center rounded-full border border-line bg-bg font-display text-xl"
          >
            {username.slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[17px] font-medium">@{username}</p>
            <p className="truncate text-sm text-muted">{email}</p>
          </div>
        </div>
      </Section>

      <Section
        title="Connections"
        hint="Your own free accounts. Benchjot never pays for them and never asks for a card."
      >
        <ConnectAi next="/settings" compact />
        <DatasetKeys />
      </Section>



      <Section title="Usage">
        <div className="py-4">
          <Usage />
        </div>
      </Section>

      <Section title="Appearance">
        <Row label="Theme">
          <Segmented
            label="Theme"
            options={THEMES.map((t) => ({
              value: t.id as string,
              label: t.label,
            }))}
            value={mounted ? theme : undefined}
            onChange={setTheme}
          />
        </Row>
      </Section>

      <div className="mt-10 mb-16 flex flex-wrap items-center justify-between gap-2">
        <Link
          href="/security"
          className="inline-flex min-h-12 items-center text-sm text-muted underline-offset-4 hover:text-fg hover:underline"
        >
          How your keys are kept
        </Link>
        <button
          type="button"
          onClick={signOut}
          className="inline-flex min-h-11 items-center rounded-full border border-line px-4 text-sm text-fail transition-[background-color,border-color] hover:border-fail/40 hover:bg-fail/5"
        >
          Sign out
        </button>
      </div>
    </Column>
  );
}

