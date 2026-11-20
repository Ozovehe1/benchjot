"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { setUsername } from "@/lib/account/auth";
import { isValidUsername, normalizeUsername, USERNAME_HINT } from "@/lib/account/username";
import { Button, Logo, FIELD, Notice } from "../ui";
import { userMessage } from "@/lib/ui/user-message";

/** One field: pick a username, then the connect step, then the app. */
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
    const { error } = await setUsername(wanted);
    setSaving(false);
    if (error) return setError(userMessage(error, "username"));
    // Next: the connect step (free AI), then the app.
    router.replace("/welcome/boosts");
    router.refresh();
  }

  return (
    <div className="mx-auto w-full max-w-[440px] px-5">
      <header className="flex h-16 items-center">
        <Logo />
      </header>
      <main className="pt-[8vh]">
        <form onSubmit={save} noValidate className="mt-8">
          <h1 className="mb-2 text-[28px] font-medium leading-tight tracking-tight">Choose a username</h1>
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
            className={FIELD}
          />
          {error && (
            <Notice className="mt-4">
              {error}
            </Notice>
          )}
          <Button type="submit" disabled={saving} className="mt-8 w-full">
            Continue
          </Button>
        </form>
      </main>
    </div>
  );
}
