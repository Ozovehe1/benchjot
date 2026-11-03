"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { z } from "zod";
import { APP_NAME } from "@/config/app";
import { supabase } from "@/lib/supabase/client";
import { Column, TextButton } from "@/components/ui";

const credentials = z.object({
  email: z.email("Enter a valid email."),
  password: z.string().min(8, "Password needs at least 8 characters."),
});

function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

const field = "block h-12 w-full border-b border-line outline-none focus:border-faint";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const signin = mode === "signin";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = credentials.safeParse({ email: email.trim(), password });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Check your details.");
    setLoading(true);
    const auth = supabase().auth;
    const { data, error } = signin ? await auth.signInWithPassword(parsed.data) : await auth.signUp(parsed.data);
    if (error || !data.session) {
      setLoading(false);
      if (error) return setError(error.message === "Invalid login credentials" ? "Wrong email or password." : error.message);
      return setError("Confirm your email, then sign in.");
    }
    router.replace(safeNext(params.get("next")));
    router.refresh();
  }

  return (
    <form onSubmit={submit} noValidate className="mt-10">
      <input aria-label="Email" placeholder="Email" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} className={field} />
      <input
        aria-label="Password"
        placeholder={signin ? "Password" : "Password (8+ characters)"}
        type="password"
        autoComplete={signin ? "current-password" : "new-password"}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className={field}
      />
      {error && (
        <p role="alert" className="mt-4 text-sm">
          {error}
        </p>
      )}
      <button type="submit" disabled={loading} className="mt-8 h-11 w-full rounded-[3px] bg-fg text-sm text-bg disabled:opacity-60">
        {signin ? "Sign in" : "Create account"}
      </button>
      <TextButton
        onClick={() => {
          setMode(signin ? "signup" : "signin");
          setError(null);
        }}
        className="mt-2"
      >
        {signin ? "Create an account" : "I have an account"}
      </TextButton>
    </form>
  );
}

export default function LoginPage() {
  return (
    <Column className="max-w-[400px] pt-[18vh]">
      <h1 className="font-medium">{APP_NAME}</h1>
      <Suspense>
        <LoginForm />
      </Suspense>
    </Column>
  );
}
