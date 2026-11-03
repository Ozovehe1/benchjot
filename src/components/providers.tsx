"use client";
import { ThemeProvider } from "next-themes";
import { SWRConfig } from "swr";
import { SaveStatusProvider } from "@/lib/autosave";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <SWRConfig value={{ revalidateOnFocus: false, errorRetryCount: 2 }}>
        <SaveStatusProvider>{children}</SaveStatusProvider>
      </SWRConfig>
    </ThemeProvider>
  );
}
