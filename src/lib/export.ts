// Experiment -> portable Markdown document.
import { fenceTag, languageLabel } from "./languages";
import { formatNumber } from "./compare";
import { STATUS_LABEL, type Experiment, type Run, type Snippet } from "./schemas";

export interface ExportInput {
  experiment: Experiment;
  projectName?: string | null;
  snippets: Snippet[];
  runs: Run[];
}

/** A fence long enough that the code inside can't close it. */
function fenceFor(code: string): string {
  const longest = Math.max(2, ...(code.match(/`{3,}/g) ?? []).map((m) => m.length));
  return "`".repeat(longest + 1);
}

function cell(v: string): string {
  return v.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function table(title: string, record: Record<string, string | number>): string[] {
  const entries = Object.entries(record);
  if (!entries.length) return [];
  return [
    `**${title}**`,
    "",
    "| Key | Value |",
    "| --- | --- |",
    ...entries.map(([k, v]) => `| ${cell(k)} | ${cell(typeof v === "number" ? formatNumber(v) : v)} |`),
    "",
  ];
}

export function experimentToMarkdown({ experiment: e, projectName, snippets, runs }: ExportInput): string {
  const out: string[] = [`# ${e.title}`, ""];
  const meta: string[] = [`- **Status:** ${STATUS_LABEL[e.status]}`];
  if (projectName) meta.push(`- **Project:** ${projectName}`);
  if (e.tags.length) meta.push(`- **Tags:** ${e.tags.map((t) => `\`${t}\``).join(", ")}`);
  if (e.started_on || e.ended_on) meta.push(`- **Dates:** ${e.started_on ?? "?"} → ${e.ended_on ?? "ongoing"}`);
  out.push(...meta, "");

  if (e.hypothesis.trim()) out.push("## Hypothesis", "", e.hypothesis.trim(), "");
  if (e.notes.trim()) out.push("## Notes", "", e.notes.trim(), "");

  if (snippets.length) {
    out.push("## Code", "");
    for (const s of [...snippets].sort((a, b) => a.position - b.position)) {
      const fence = fenceFor(s.content);
      out.push(`### ${s.filename || languageLabel(s.language)}`, "", `${fence}${fenceTag(s.language)}`, s.content, fence, "");
    }
  }

  if (runs.length) {
    out.push("## Runs", "");
    for (const r of runs) {
      out.push(`### ${r.name}`, "", `_${r.ran_at.slice(0, 10)}_`, "");
      out.push(...table("Parameters", r.params), ...table("Metrics", r.metrics), ...table("Environment", r.env));
      if (r.links.length) {
        out.push("**Links**", "", ...r.links.map((l) => `- [${l.label || l.url}](${l.url})`), "");
      }
      if (r.outcome.trim()) out.push("**Outcome**", "", r.outcome.trim(), "");
    }
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

export function exportFilename(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "experiment"}.md`;
}
