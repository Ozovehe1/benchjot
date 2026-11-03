"use client";
import { useEffect } from "react";
import { ThemeProvider } from "next-themes";
import { SWRConfig } from "swr";
import { SaveStatusProvider } from "@/lib/autosave";

export function Providers({ children }: { children: React.ReactNode }) {
  // Installable PWA: offline shell and cached runtimes (production only, so dev is never stale).
  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js");
  }, []);

  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
      <SWRConfig value={{ revalidateOnFocus: false, errorRetryCount: 2 }}>
        <SaveStatusProvider>{children}</SaveStatusProvider>
      </SWRConfig>
    </ThemeProvider>
  );
}
