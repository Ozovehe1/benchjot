"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { z } from "zod";
import { supabase } from "@/lib/supabase/client";
import { safeNext } from "@/lib/safe-next";
import { isValidUsername, looksLikeEmail, normalizeUsername, USERNAME_HINT } from "@/lib/username";
import { Button, Logo, TextButton } from "@/components/ui";
import { GoogleButton } from "@/components/google-button";

const email = z.email("Enter a valid email.");
const password = z.string().min(8, "Password needs at least 8 characters.");

const UNCONFIRMED = "Confirm your email first. Open the link we sent you.";
const LANDING_ERRORS: Record<string, string> = {
  link: "That link has expired or was already used. Sign in, or resend it.",
  google: "Google sign-in didn't finish. Try again.",
};
const WRONG = "Wrong email, username or password.";

/** Where email links and Google send the user back to; /auth/confirm finishes the sign-in. */
function returnUrl(next: string | null): string {
  return `${window.location.origin}/auth/confirm?next=${encodeURIComponent(safeNext(next))}`;
}

const field = "block h-12 w-full border-b border-line bg-transparent outline-none focus:border-faint";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next");
  const [mode, setMode] = useState<"signin" | "signup">(params.get("mode") === "signup" ? "signup" : "signin");
  const [identifier, setIdentifier] = useState(""); // email, or username when signing in
  const [username, setUsername] = useState("");
  const [pass, setPass] = useState("");
  const [error, setError] = useState<string | null>(LANDING_ERRORS[params.get("error") ?? ""] ?? null);
  const [sent, setSent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const signin = mode === "signin";

  function fail(message: string) {
    setLoading(false);
    setError(message);
  }

  async function google() {
    setError(null);
    setLoading(true);
    const { error } = await supabase().auth.signInWithOAuth({ provider: "google", options: { redirectTo: returnUrl(next) } });
    if (error) fail(error.message);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSent(null);
    const sb = supabase();
    const pw = password.safeParse(pass);
    if (!pw.success) return setError(pw.error.issues[0]?.message ?? "Check your password.");
    setLoading(true);

    if (signin) {
      const id = identifier.trim();
      let address = id;
      if (!looksLikeEmail(id)) {
        const { data, error } = await sb.rpc("login_email", { username: normalizeUsername(id), password: pass });
        if (error) return fail(error.message);
        if (!data) return fail(WRONG);
        address = data as string;
      }
      const { error } = await sb.auth.signInWithPassword({ email: address, password: pass });
      if (error?.code === "email_not_confirmed") return fail(UNCONFIRMED);
      if (error) return fail(error.message === "Invalid login credentials" ? WRONG : error.message);
    } else {
      const name = normalizeUsername(username);
      if (!isValidUsername(name)) return fail(`Username: ${USERNAME_HINT}`);
      const em = email.safeParse(identifier.trim());
      if (!em.success) return fail(em.error.issues[0]?.message ?? "Enter a valid email.");
      const { data: free, error: checkError } = await sb.rpc("username_available", { name });
      if (checkError) return fail(checkError.message);
      if (!free) return fail("That username is taken.");
      const { data, error } = await sb.auth.signUp({
        email: em.data,
        password: pass,
        options: { emailRedirectTo: returnUrl(next), data: { username: name } },
      });
      if (error) return fail(error.message);
      if (!data.session) {
        setLoading(false);
        setMode("signin");
        return setSent(em.data);
      }
    }
    router.replace(safeNext(next));
    router.refresh();
  }

  async function resend() {
    const em = email.safeParse(identifier.trim());
    if (!em.success) return setError("Enter your email to resend the link.");
    setLoading(true);
    const { error } = await supabase().auth.resend({ type: "signup", email: em.data, options: { emailRedirectTo: returnUrl(next) } });
    if (error) return fail(error.message);
    setLoading(false);
    setError(null);
    setSent(em.data);
  }

  const canResend = !!sent || error === UNCONFIRMED || params.get("error") === "link";

  return (
    <form onSubmit={submit} noValidate className="mt-8">
      <h1 className="mb-6 text-[28px] font-semibold leading-tight tracking-tight">{signin ? "Sign in" : "Create account"}</h1>
      <GoogleButton
        disabled={loading}
        onFallback={google}
        onError={fail}
        onSignedIn={() => {
          router.replace(safeNext(next));
          router.refresh();
        }}
      />
      <p className="mt-6 mb-2 text-center text-xs text-faint">or</p>
      {!signin && (
        <input
          aria-label="Username"
          placeholder="Username"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className={field}
        />
      )}
      <input
        aria-label={signin ? "Email or username" : "Email"}
        placeholder={signin ? "Email or username" : "Email"}
        type={signin ? "text" : "email"}
        autoComplete={signin ? "username" : "email"}
        inputMode="email"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        value={identifier}
        onChange={(e) => setIdentifier(e.target.value)}
        className={field}
      />
      <input
        aria-label="Password"
        placeholder={signin ? "Password" : "Password (8+ characters)"}
        type="password"
        autoComplete={signin ? "current-password" : "new-password"}
        value={pass}
        onChange={(e) => setPass(e.target.value)}
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
