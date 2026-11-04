"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { z } from "zod";
import { supabase } from "@/lib/supabase/client";
import { safeNext } from "@/lib/safe-next";
import { Button, Logo, TextButton } from "@/components/ui";

const credentials = z.object({
  email: z.email("Enter a valid email."),
  password: z.string().min(8, "Password needs at least 8 characters."),
});


const UNCONFIRMED = "Confirm your email first. Open the link we sent you.";

function confirmUrl(next: string | null): string {
  return `${window.location.origin}/auth/confirm?next=${encodeURIComponent(safeNext(next))}`;
}

const field = "block h-12 w-full border-b border-line outline-none focus:border-faint";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [mode, setMode] = useState<"signin" | "signup">(params.get("mode") === "signup" ? "signup" : "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(params.get("error") === "link" ? "That link has expired or was already used. Sign in, or resend it." : null);
  const [sent, setSent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const signin = mode === "signin";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSent(null);
    const parsed = credentials.safeParse({ email: email.trim(), password });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Check your details.");
    setLoading(true);
    const auth = supabase().auth;
    const { data, error } = signin
      ? await auth.signInWithPassword(parsed.data)
      : await auth.signUp({ ...parsed.data, options: { emailRedirectTo: confirmUrl(params.get("next")) } });
    if (error || !data.session) {
      setLoading(false);
      if (error?.code === "email_not_confirmed") return setError(UNCONFIRMED);
      if (error) return setError(error.message === "Invalid login credentials" ? "Wrong email or password." : error.message);
      setMode("signin");
      return setSent(parsed.data.email);
    }
    router.replace(safeNext(params.get("next")));
    router.refresh();
  }

  async function resend() {
    const parsed = credentials.shape.email.safeParse(email.trim());
    if (!parsed.success) return setError("Enter your email first.");
    setLoading(true);
    const { error } = await supabase().auth.resend({ type: "signup", email: parsed.data, options: { emailRedirectTo: confirmUrl(params.get("next")) } });
    setLoading(false);
    if (error) return setError(error.message);
    setError(null);
    setSent(parsed.data);
  }

  const canResend = !!sent || error === UNCONFIRMED || params.get("error") === "link";

  return (
    <form onSubmit={submit} noValidate className="mt-8">
      <h1 className="mb-6 text-[28px] font-semibold leading-tight tracking-tight">{signin ? "Sign in" : "Create account"}</h1>
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
      {sent && (
        <p role="status" className="mt-4 text-sm">
          We sent a link to {sent}. {"Open it to confirm, then you're in. Check spam if it's not there."}
        </p>
      )}
      <Button type="submit" disabled={loading} className="mt-8 w-full">
        {signin ? "Sign in" : "Create account"}
      </Button>
      <TextButton
        onClick={() => {
          setMode(signin ? "signup" : "signin");
          setError(null);
        }}
        className="mt-1 w-full justify-center"
      >
        {signin ? "Create an account" : "I have an account"}
      </TextButton>
      {signin && canResend && (
        <TextButton onClick={resend} disabled={loading} className="w-full justify-center">
          Resend confirmation email
        </TextButton>
      )}
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="mx-auto w-full max-w-[440px] px-5">
      <header className="flex h-16 items-center">
        <Logo />
      </header>
      <main className="pt-[8vh]">
        <Suspense>
          <LoginForm />
        </Suspense>
      </main>
    </div>
  );
}
