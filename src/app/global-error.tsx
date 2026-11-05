"use client";
// A crash in the root layout itself: replaces the whole document, so it brings its own html and styles.
import { useEffect } from "react";
import { ErrorScreen } from "@/components/error-screen";
import { BRAND } from "@/lib/brand";
import "./globals.css";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => console.error("[benchjot] app crashed", error), [error]);
  return (
    <html lang="en" style={{ "--charcoal": BRAND.charcoal, "--ash": BRAND.ash } as React.CSSProperties}>
      <body className="min-h-dvh font-sans text-[15px] leading-normal antialiased">
        <ErrorScreen kind="crash" onRetry={reset} />
      </body>
    </html>
  );
}
