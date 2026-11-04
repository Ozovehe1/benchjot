"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { isValidUsername, normalizeUsername, USERNAME_HINT } from "@/lib/username";
import { Button, Logo } from "./ui";

/** One field: pick a username, then into the app. */
export function ChooseUsername({ suggestion }: { suggestion: string }) {
  const router = useRouter();
  const [name, setName] = useState(suggestion);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const wanted = normalizeUsername(name);
    if (!isValidUsername(wanted)) return setError(USERNAME_HINT);
    setSaving(true);
    setError(null);
    const { error } = await supabase().rpc("set_username", { name: wanted });
    setSaving(false);
    if (error) return setError(error.message);
    router.replace("/");
    router.refresh();
  }

  return (
    <div className="mx-auto w-full max-w-[440px] px-5">
      <header className="flex h-16 items-center">
        <Logo />
      </header>
      <main className="pt-[8vh]">
        <form onSubmit={save} noValidate className="mt-8">
          <h1 className="mb-2 text-[28px] font-semibold leading-tight tracking-tight">Choose a username</h1>
          <p className="mb-6 text-sm text-muted">{USERNAME_HINT} You can sign in with it.</p>
          <input
            aria-label="Username"
            placeholder="Username"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="block h-12 w-full border-b border-line bg-transparent outline-none focus:border-faint"
          />
          {error && (
            <p role="alert" className="mt-4 text-sm">
              {error}
            </p>
          )}
          <Button type="submit" disabled={saving} className="mt-8 w-full">
            Continue
          </Button>
        </form>
      </main>
    </div>
  );
}
