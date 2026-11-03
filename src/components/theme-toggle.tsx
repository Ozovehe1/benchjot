"use client";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { IconButton } from "./ui";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const dark = resolvedTheme !== "light";
  return (
    <IconButton label={dark ? "Switch to light mode" : "Switch to dark mode"} onClick={() => setTheme(dark ? "light" : "dark")}>
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </IconButton>
  );
}
