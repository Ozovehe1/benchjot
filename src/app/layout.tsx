import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Newsreader } from "next/font/google";
import { Providers } from "@/components/app/providers";
import { APP_DESCRIPTION, APP_NAME } from "@/config/app";
import { BRAND } from "@/lib/ui/brand";
import "katex/dist/katex.min.css";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: `${APP_NAME} · ${APP_DESCRIPTION}`, template: `%s · ${APP_NAME}` },
  description: APP_DESCRIPTION,
  applicationName: APP_NAME,
  icons: { apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: APP_NAME, statusBarStyle: "black" },
};

// The type: Newsreader (a reading serif with optical sizes) for titles, Inter for the interface,
// JetBrains Mono for code. Served from this site (next/font), the same on every device.
const display = Newsreader({ subsets: ["latin"], variable: "--font-newsreader", display: "swap", style: ["normal", "italic"], axes: ["opsz"] });
const sans = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", display: "swap" });

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: BRAND.charcoal,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${display.variable} ${sans.variable} ${mono.variable}`} style={{ "--charcoal": BRAND.charcoal, "--ash": BRAND.ash } as React.CSSProperties}>
      <body className="min-h-dvh font-sans text-[15px] leading-normal antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
