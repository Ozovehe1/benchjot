"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { z } from "zod";
import { supabase } from "@/lib/supabase/client";
import { Button, Input, Label } from "@/components/ui";
import { Logo } from "@/components/logo";
import { cn } from "@/lib/format";

const credentials = z.object({
  email: z.email("Enter a valid email"),
  password: z.string().min(8, "Password needs at least 8 characters"),
});

function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = credentials.safeParse({ email: email.trim(), password });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Check your details");
    setLoading(true);
    const auth = supabase().auth;
    const { data, error } =
      mode === "signin" ? await auth.signInWithPassword(parsed.data) : await auth.signUp(parsed.data);
    if (error) {
      setLoading(false);
      return setError(error.message === "Invalid login credentials" ? "Wrong email or password." : error.message);
    }
    if (!data.session) {
      setLoading(false);
      return setError("Check your inbox to confirm your email, then sign in.");
    }
    router.replace(safeNext(params.get("next")));
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="w-full space-y-4" noValidate>
      <div role="tablist" aria-label="Account" className="grid grid-cols-2 rounded-xl bg-surface-2 p-1">
        {(["signin", "signup"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => {
              setMode(m);
              setError(null);
            }}
            className={cn(
              "h-10 rounded-lg text-sm font-medium transition-colors",
              mode === m ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg",
            )}
          >
            {m === "signin" ? "Sign in" : "Create account"}
          </button>
        ))}
      </div>
      <div>
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </div>
      <div>
        <Label htmlFor="password" hint={mode === "signup" ? "8+ characters" : undefined}>
          Password
        </Label>
        <Input
          id="password"
          type="password"
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>
      {error && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <Button type="submit" variant="primary" className="w-full" loading={loading}>
        {mode === "signin" ? "Sign in" : "Create account"}
      </Button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-5 py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 h-80 w-[40rem] -translate-x-1/2 rounded-full bg-accent/10 blur-3xl"
      />
      <div className="relative w-full max-w-sm">
        <Logo className="text-lg" />
        <h1 className="mt-8 text-[28px] font-semibold leading-tight tracking-tight">Your experiments, with the code that ran them.</h1>
        <p className="mt-2 text-[15px] text-muted">Snippets, versions, runs and results in one notebook.</p>
        <div className="mt-8">
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>
      </div>
    </main>
  );
}
