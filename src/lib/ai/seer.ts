// The seer: Claude looks at what a run showed (a figure, an image, an animation, a
// chart) and says in a few sentences what it shows, so the agent reads the plot it made, not just
// that one was made. Its words are kept with the run (outputs item `seen`) and read in the context
// graph and the run reports; a new run replaces them, so they are never of older code. Pure: the
// request, the prompt and reading the reply (server: app/api/see; Android: core/Seer.kt).
import { z } from "zod";
import { SEE_MAX_ITEMS, SEEN_MAX } from "../run/outputs";

/** The largest file the seer is sent (a bigger one is skipped). */
export const SEE_MAX_BYTES = 4 * 1024 * 1024;

const fileName = z.string().regex(/^\d{1,3}\.(png|jpg|webp|gif)$/);

/** POST /api/see: a run's folder, the files to look at, and what the cell is about. */
export const seeRequest = z.object({
  /** The run's outputs folder: {user id}/{cell id}/{run id} (the user's own, checked on the server). */
  dir: z.string().regex(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/),
  items: z
    .array(z.object({ index: z.number().int().min(0).max(999), file: fileName, kind: z.enum(["figure", "image", "animation", "chart"]), title: z.string().max(500) }))
    .min(1)
    .max(SEE_MAX_ITEMS),
  /** The note's title, the cell's code (start) and what it printed (end): so it reads the axes in context. */
  title: z.string().max(300),
  code: z.string().max(3000),
  printed: z.string().max(1500),
});
export type SeeRequest = z.output<typeof seeRequest>;

/** What it answers: one description per item, by the item's index in the run's outputs. */
export type SeeReply = { seen: { index: number; text: string }[] };

const KIND_WORDS = { figure: "a figure", image: "an image", animation: "an animation (one frame of it may be all you can see)", chart: "a chart" } as const;
/** An animation sent as its frame strip (a PNG): frames in time order, so the motion can be read. */
const STRIP_WORDS = "an animation, shown as frames in time order (left to right, then the next row): say how it changes from the first frame to the last";

export const SEER_RULES = [
  "You look at what a code cell in a research notebook showed and say what it shows, for a colleague who cannot see it.",
  "For each picture write 1 to 3 plain sentences: what is plotted (axes, labels, legend, panels), the main pattern or trend with the numbers you can read off it (start and end values, peaks, where lines cross), and anything that looks wrong (empty axes, a blank plot, overlapping labels, NaN, a flat line, a diverging curve).",
  "Say only what you can see. Don't guess numbers you can't read; say they aren't readable. Don't explain the code or suggest changes.",
  'Answer with one line per picture, in order, each starting with its number and a colon: "1: …". Nothing else.',
].join("\n");

/** The text that goes with the pictures. */
export function seerPrompt(r: Pick<SeeRequest, "items" | "title" | "code" | "printed">): string {
  const list = r.items.map((it, i) => `${i + 1}: ${it.kind === "animation" && it.file.endsWith(".png") ? STRIP_WORDS : KIND_WORDS[it.kind]}${it.title.trim() ? ` titled "${it.title.trim()}"` : ""}`).join("\n");
  const parts = [`Note: ${r.title || "Untitled"}`, `The cell's code (start):\n\`\`\`\n${r.code}\n\`\`\``];
  if (r.printed.trim()) parts.push(`What it printed (end):\n\`\`\`\n${r.printed}\n\`\`\``);
  parts.push(`The pictures, in order:\n${list}`);
  return parts.join("\n\n");
}

/** Reads "1: …" lines into descriptions by output index; a reply with no numbers is taken for the first picture. */
export function readSeerReply(content: string, items: readonly { index: number }[]): SeeReply {
  const text = content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  const found = new Map<number, string>();
  let at: number | null = null;
  for (const line of text.split("\n")) {
    const m = /^\s*(?:\*\*)?(?:picture\s*)?(\d{1,2})(?:\*\*)?\s*[:.)\-–]\s*(.*)$/i.exec(line);
    if (m && Number(m[1]) >= 1 && Number(m[1]) <= items.length) {
      at = Number(m[1]) - 1;
      found.set(at, m[2]!.trim());
    } else if (at !== null && line.trim()) found.set(at, `${found.get(at)} ${line.trim()}`.trim());
  }
  if (!found.size && text) found.set(0, text);
  const seen = [...found].flatMap(([i, t]) => {
    const clean = t.replace(/\s+/g, " ").replace(/^["“]|["”]$/g, "").trim();
    return clean ? [{ index: items[i]!.index, text: clean.slice(0, SEEN_MAX) }] : [];
  });
  return { seen };
}
