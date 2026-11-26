// Where the app touches its providers. Screens and routes go through a few modules, so moving to
// another database, auth, sandbox or model provider means rewriting those modules, not the app:
//   database + auth (Supabase)  lib/data/*, lib/account/auth.ts, lib/server/{account,session}.ts,
//                               lib/run/output-store.ts (Storage), middleware.ts (session refresh)
//   server runs (Modal)         lib/server/modal.ts, reached only through lib/server/sandbox.ts
//   language model              lib/server/llm.ts (Claude, through the Anthropic SDK)
import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const grep = (pattern: string) =>
  execSync(`grep -rlE '${pattern}' src || true`, { cwd: new URL("..", import.meta.url).pathname, encoding: "utf8" }).trim().split("\n").filter(Boolean).sort();

describe("provider boundaries", () => {
  it("only the data, account and session modules use the Supabase SDK or clients", () => {
    expect(grep(`@supabase/|supabase/(client|server)"`)).toEqual([
      "src/lib/account/auth.ts",
      "src/lib/data/datasets.ts", // the Data library: the user's files in Storage
      "src/lib/data/experiments.ts", // experiment tracking: the runs that logged values
      "src/lib/data/figures.ts", // the Figures page: the latest runs' visuals
      "src/lib/data/index.ts",
      "src/lib/data/shares.ts", // a note's share link, read and changed by its owner
      "src/lib/data/supabase/client.ts",
      "src/lib/data/supabase/server.ts",
      "src/lib/run/output-store.ts",
      "src/lib/server/account.ts",
      "src/lib/server/session.ts",
      "src/lib/server/shared-note.ts", // a shared note's page, read with the link's token (no user)
      "src/middleware.ts",
    ]);
  });

  it("screens never call the provider (no supabase(), .auth. or .rpc( in components or pages)", () => {
    expect(grep(`supabase\\(\\)|\\.auth\\.|\\.rpc\\(`).filter((f) => f.startsWith("src/components/") || (f.startsWith("src/app/") && !f.startsWith("src/app/api/")))).toEqual([]);
  });

  it("only sandbox.ts reaches Modal, only llm.ts the AI (Claude), and no other model provider", () => {
    expect(grep(`from "modal"`)).toEqual(["src/lib/server/modal.ts"]); // the Modal SDK
    expect(grep(`from "(\\./|@/lib/server/)modal"`)).toEqual(["src/lib/server/sandbox.ts"]);
    expect(grep(`from "@anthropic-ai/sdk"`)).toEqual(["src/lib/server/llm.ts"]);
    expect(grep(`openrouter\\.ai|groq\\.com|api\\.openai\\.com`)).toEqual([]);
  });

  it("a notebook host that was dropped appears nowhere: app, pages, workers, database, scripts, docs", () => {
    const name = ["kag", "gle"].join(""); // spelled from parts, so this file doesn't name it either
    const hits = execSync(`git grep -il '${name}' -- . ':!package-lock.json' || true`, { cwd: new URL("..", import.meta.url).pathname, encoding: "utf8" }).trim();
    expect(hits).toBe("");
  });
});
