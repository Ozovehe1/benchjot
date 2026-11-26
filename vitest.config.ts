import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // tsconfig keeps JSX for Next; tests render components with the automatic runtime.
  oxc: { jsx: { runtime: "automatic" } },
  test: { include: ["tests/**/*.test.{ts,tsx}"], environment: "node" },
});
