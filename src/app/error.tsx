"use client";
// A crash inside the app: a calm screen with Try again, never the error's text.
import { useEffect } from "react";
import { ErrorScreen } from "@/components/error-screen";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => console.error("[benchjot] page crashed", error), [error]);
  return <ErrorScreen kind="crash" onRetry={reset} />;
}
