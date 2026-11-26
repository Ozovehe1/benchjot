// The agent, the pure parts: the one assistant in a note (Send, typed or spoken, always comes here).
// It answers questions in words, and does work in the note with tools, one model call per step: it
// adds a code cell, changes one, runs it, reads what the run gave in the next step, fixes what went
// wrong, writes into the note's text when asked, and goes on until the request is done (or
// AGENT_LIMITS.steps). It knows how cells run (each on its own, in a fresh process), so it never
// leans on another cell's variables, and it never fakes a result: no placeholders, no swallowed
// errors, no invented numbers. The model answers each step in JSON with the calls it makes (the
// same models and JSON mode as Fix). Everything it changes can be undone in one tap; it never
// touches cell notes or the outcome.
//
// No network or React here: the loop (runAgent) is given the note's cells and the step request as
// functions, so it is tested with fakes and shared by the Assistant panel.
import { z } from "zod";
import { AGENT_LIMITS, ASSISTANT_LIMITS } from "../../config/app";
import { DEFAULT_LANGUAGE, isLanguageId, languageConfig, type LanguageId } from "../code/languages";
import type { Cell } from "../notes/schemas";
import { firstObject, readJsonReply } from "./fix";
import { codeHash } from "../run/last-run";
import type { ChatMessage } from "../server/llm-types";
import { type AgentChanges } from "./assistant";
import { DATA_RULE, noteGraph, earlierBlock, salvageAssistantAnswer, headCut, assistantCells, assistantHistorySchema, historySize, NO_HISTORY, noteBlock, noteContext, placeNoteText, removeNoteText, tailBlock, wrongLanguage, type AssistantCell, type AssistantHistory } from "./assistant";
import { FriendlyError } from "../ui/user-message";
import { DEVICE_PYTHON, serverOnlyImports } from "../run/python-imports";
import { toSee } from "../run/outputs";
export { DEVICE_PYTHON, serverOnlyImports };
export { AGENT_LIMITS };

// ------------------------------------------------------------------ tools

const cellNumber = z.number().int().min(1).max(10_000);
const code = z.string().max(AGENT_LIMITS.maxCodeChars);

const noteText = z.string().max(AGENT_LIMITS.maxCodeChars);
/** Where run_cell runs a cell: on this device (the browser, or the phone), or on Benchjot's server. Anything else reads as left out. */
const runWhere = z.enum(["device", "server"]).optional().catch(undefined);
export type RunWhere = "device" | "server";

/** One tool call. Cells are numbered from 1 in the note's order, as the note shows them ("[Cell 3]"). */
/** Another note, as find_notes named it ("N1", "N2", …). */
const noteRef = z.string().trim().regex(/^n\d{1,2}$/i).transform((r) => r.toUpperCase());
const dataCalls = [
  z.object({ tool: z.literal("list_data") }),
  z.object({ tool: z.literal("save_data"), url: z.string().trim().min(1).max(2048), name: z.string().trim().max(120).default("") }),
  z.object({ tool: z.literal("find_datasets"), query: z.string().trim().min(1).max(200) }),
] as const;
const notesCalls = [
  z.object({ tool: z.literal("find_notes"), query: z.string().max(200).default("") }),
  z.object({ tool: z.literal("read_note"), note: noteRef }),
  z.object({ tool: z.literal("ask_note"), note: noteRef, question: z.string().trim().min(1).max(1000) }),
  z.object({ tool: z.literal("propose_change"), note: noteRef, after: z.string().max(400).default(""), text: z.string().trim().min(1).max(4000) }),
] as const;
const agentCall = z.discriminatedUnion("tool", [
  ...notesCalls,
  ...dataCalls,
  z.object({ tool: z.literal("add_cell"), language: z.string().max(40), code }),
  z.object({ tool: z.literal("edit_cell"), cell: cellNumber, code }),
  z.object({ tool: z.literal("run_cell"), cell: cellNumber, where: runWhere }),
  z.object({ tool: z.literal("delete_cell"), cell: cellNumber }),
  z.object({ tool: z.literal("write_note"), after: z.string().max(400).default(""), text: noteText }),
  z.object({ tool: z.literal("replace_note"), find: z.string().min(1).max(AGENT_LIMITS.maxCodeChars), replace: noteText.default("") }),
]);
export type AgentCall = z.infer<typeof agentCall>;



// ------------------------------------------------------------------ one step

/** A step already taken, as the browser sends it back: what the agent said, its calls, and what each gave. */
const agentStep = z.object({
  message: z.string().max(AGENT_LIMITS.maxMessageChars),
  calls: z
    .array(
      z.discriminatedUnion("tool", [
        ...notesCalls,
        ...dataCalls,
        z.object({ tool: z.literal("add_cell"), language: z.string().max(40), code: z.string().max(AGENT_LIMITS.maxHistoryCodeChars) }),
        z.object({ tool: z.literal("edit_cell"), cell: cellNumber, code: z.string().max(AGENT_LIMITS.maxHistoryCodeChars) }),
        z.object({ tool: z.literal("run_cell"), cell: cellNumber, where: runWhere }),
        z.object({ tool: z.literal("delete_cell"), cell: cellNumber }),
        z.object({ tool: z.literal("write_note"), after: z.string().max(400), text: z.string().max(AGENT_LIMITS.maxHistoryCodeChars) }),
        z.object({ tool: z.literal("replace_note"), find: z.string().max(AGENT_LIMITS.maxHistoryCodeChars), replace: z.string().max(AGENT_LIMITS.maxHistoryCodeChars) }),
      ]),
    )
    .max(AGENT_LIMITS.callsPerStep),
  results: z.array(z.string().max(AGENT_LIMITS.maxResultChars)).max(AGENT_LIMITS.callsPerStep + 4),
  /** The plan it gave in this step, if any (it reads its own plan back). */
  plan: z.array(z.string().max(200)).max(6).optional(),
});
type AgentStep = z.infer<typeof agentStep>;

/** The characters the earlier steps add to the request; the note gets the rest of maxContextChars. */
export function stepsSize(steps: readonly AgentStep[]): number {
  return steps.reduce((n, s) => n + s.message.length + s.calls.reduce((m, c) => m + callChars(c) + 40, 0) + s.results.reduce((m, r) => m + r.length, 0), 0);
}

const callChars = (c: AgentStep["calls"][number]) =>
  "code" in c ? c.code.length : "text" in c ? c.text.length + c.after.length : "find" in c ? c.find.length + c.replace.length : "question" in c ? c.question.length : "query" in c ? c.query.length : "url" in c ? c.url.length + c.name.length : 0;

/** A call as it goes back to the model: what it wrote cut short (the whole of it is in the note). */
function sentCall(c: AgentCall): AgentStep["calls"][number] {
  const cut = (t: string) => headCut(t, AGENT_LIMITS.maxHistoryCodeChars);
  if ("code" in c) return { ...c, code: cut(c.code) };
  if (c.tool === "write_note") return { tool: c.tool, after: headCut(c.after, 400), text: cut(c.text) };
  if (c.tool === "replace_note") return { tool: c.tool, find: cut(c.find), replace: cut(c.replace) };
  return c;
}

/** A step as it goes back to the model: code it wrote cut short (the whole code is in the note), results cut to their budget. */
export function sentStep(step: { message: string; calls: readonly AgentCall[]; results: readonly string[]; plan?: readonly string[] }): AgentStep {
  return {
    ...(step.plan ? { plan: step.plan.slice(0, 6).map((p) => headCut(p, 200)) } : {}),
    message: headCut(step.message, AGENT_LIMITS.maxMessageChars),
    calls: step.calls.slice(0, AGENT_LIMITS.callsPerStep).map(sentCall),
    results: step.results.slice(0, AGENT_LIMITS.callsPerStep + 4).map((r) => headCut(r, AGENT_LIMITS.maxResultChars)),
  };
}

const TOO_LONG = "This note is too long for the agent";

/**
 * The live conversation's bounds: how many turns it may hold, how long one call's result may be,
 * and its whole size as sent (characters of JSON). Past maxChars the browser goes on in the older
 * way (rebuilt from the last steps), so nothing fails.
 */
export const LIVE = { maxMessages: 200, maxResultChars: 8_000, maxChars: 1_500_000, maxKeptChars: 1_000_000 } as const;

/** One message of the live conversation, as Claude takes it (blocks are kept as they came; Claude checks them). */
const liveMessage = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.array(z.record(z.string(), z.unknown()).refine((b) => typeof b.type === "string", "A block needs a type")).min(1).max(40),
});
export type LiveMessage = z.infer<typeof liveMessage>;

/**
 * The user turn that answers the agent's last turn in the live conversation: a tool_result for every
 * tool call it made (what the call gave, by its id; set_plan and finish are acknowledged; a call that
 * wasn't made says so), then the notes (problems, checks, nudges) as text.
 */
export function liveAnswer(last: LiveMessage | undefined, results: readonly { id: string; text: string }[], notes: readonly string[]): LiveMessage | null {
  const byId = new Map(results.map((r) => [r.id, r.text]));
  const content: Record<string, unknown>[] = [];
  if (last?.role === "assistant")
    for (const b of last.content) {
      if (b.type !== "tool_use" || typeof b.id !== "string") continue;
      const text = byId.get(b.id) ?? (b.name === "set_plan" ? "Plan updated." : b.name === "finish" ? "Noted." : "This call wasn't made: see the note below.");
      content.push({ type: "tool_result", tool_use_id: b.id, content: text || "No output." });
    }
  const extra = [...results.filter((r) => !content.some((c) => c.tool_use_id === r.id)).map((r) => r.text), ...notes].filter((t) => t.trim());
  if (extra.length) content.push({ type: "text", text: extra.join("\n\n") });
  return content.length ? { role: "user", content } : null;
}

/** What the browser sends for each step: the request, the conversation so far, the note as it is now, and the steps so far. */
export const agentRequest = z
  .object({
    request: z.string().trim().min(1, "Say or type what to do first").max(ASSISTANT_LIMITS.maxRequestChars, `Keep it under ${ASSISTANT_LIMITS.maxRequestChars.toLocaleString("en")} characters`),
    language: z.string().min(1).max(40),
    title: z.string().max(200),
    note: z.string().max(ASSISTANT_LIMITS.maxContextChars, TOO_LONG),
    steps: z.array(agentStep).max(AGENT_LIMITS.steps),
    /** The conversation before this request (the Assistant's history): so "insert it" or "undo that" read in its light. Old apps leave it out. */
    history: assistantHistorySchema.default(NO_HISTORY),
    /**
     * The live conversation (LIVE): the browser keeps Claude's own turns, block by block, and sends
     * them back unchanged with what its last calls gave, instead of rebuilding the request from
     * `steps`. Old apps leave these out and send `steps`.
     */
    live: z.boolean().optional(),
    transcript: z.array(liveMessage).max(LIVE.maxMessages).optional(),
    results: z.array(z.object({ id: z.string().max(100), text: z.string().max(LIVE.maxResultChars) })).max(AGENT_LIMITS.callsPerStep * 2).optional(),
    notes: z.array(z.string().max(LIVE.maxResultChars)).max(12).optional(),
  })
  .refine((r) => r.note.length + stepsSize(r.steps) + historySize(r.history) <= ASSISTANT_LIMITS.maxContextChars, { message: TOO_LONG, path: ["note"] });
export type AgentRequest = z.input<typeof agentRequest>;

// ------------------------------------------------------------------ prompts

/**
 * How cells run, as the agent must know it to write code that works (public/workers/python.js:
 * each run gets a fresh namespace; server runs are a process each).
 */
export const RUNTIME_RULE =
  "How cells run: each code cell is its own program and runs in a fresh process. Variables, functions, models and data made in another cell do not exist in it, even if that cell ran before. So a cell that needs another cell's results either recomputes them itself (copy the code it needs), or uses the numbers that cell printed, which you can read in the note, and says where they came from.";

/**
 * The web, and getting data in (user-reported 2026-11-26: the agent once couldn't download a dataset).
 * Server runs reach the dataset sites (DATASET_HOSTS) by themselves; any other site needs the cell's
 * own # network: line. The phone and the browser can't download most files: data goes through the server.
 */
export const WEB_RULE =
  "The web: use web_search to find facts, documentation, papers or where a dataset can be downloaded, and web_fetch to read a page (its address must come from the user or a search result). Say where a fact came from. Data: the user's Data library holds their datasets; call list_data to see them. A cell opens a library file by its plain name in quotes (pd.read_csv(\"iris.csv\")): the app puts it in the run's working folder first, on the device and on the server alike, so never write a path or a download for it. Finding data: call find_datasets with words to search Hugging Face, Zenodo, OpenML, Harvard Dataverse and figshare at once, then call it again with a result's ref to list its files' addresses, and save_data the one you want; or call save_data with a file's address straight away. Either way it is then in the library for every cell and every later note. When the file needs a sign-in, an API or a library to fetch (Hugging Face datasets, torchvision, a site's own API), download it in a cell that runs on the server (\"where\": \"server\"): the server reaches Hugging Face, OpenML, UCI, Zenodo, GitHub, Google Drive, figshare, Amazon S3 and the PyTorch / TensorFlow dataset hosts by itself; for any other site, put a line at the very top of the cell: # network: example.org (or # network: on for any site). Files a cell writes are gone after it ends, so a cell that downloads, unpacks or builds data that later cells need calls save_data(\"name.ext\") on that file (a built-in in every cell, like log(); the name in plain quotes): it goes into the library and later cells open it by name. Save the data file itself (one table or array file pulled out of an archive or a package), never a whole archive or package that every cell must unpack again, and never a web page or README: read those with web_fetch. When web_fetch can't read a download page (a page built by JavaScript), look for the files where the project publishes its code or paper (its GitHub repository and releases, the paper's data statement, Zenodo or figshare), or fetch the page's HTML in a server cell and read its links.";

/** Where a cell runs, as the agent chooses it (run_cell "where"). */
export const WHERE_RULE =
  "Where a cell runs: on the device (the user's browser, or their phone in the Android app) or on Benchjot's server. The device is the default: free, starts at once, no time limit. It has Python with numpy, pandas, scipy, scikit-learn, matplotlib, seaborn, Pillow, Plotly, Altair and Bokeh. Set \"where\": \"server\" when the cell needs any other library (PyTorch, TensorFlow, JAX, XGBoost, transformers, statsmodels and the rest of the lists below), a GPU, or is heavy work a phone or laptop would take many minutes over (training on a large dataset, a big simulation, a long parameter sweep). R, Julia, Octave, C, C++ and Fortran go to the server by themselves. The server has a GPU when the code uses one (10 GPU runs a day), and a Python run there can last up to an hour. Never send small, quick work to the server. If a device run fails with \"No module named …\", run it again with \"where\": \"server\".";

/**
 * Which library to reach for, by kind of task, in each language: only what is installed (the
 * device's set, python-image.json and server-images.json), so the code runs without installing.
 */
export const LIBRARIES: Record<string, string> = {
  python: [
    "Which Python library for which task (all installed on the server; the device has the first group):",
    "- Arrays, maths, data, plots (device): numpy, scipy (optimize, integrate, stats, signal, sparse), pandas, matplotlib, seaborn; interactive charts: plotly, altair, bokeh; images: Pillow.",
    "- Classic machine learning (device): scikit-learn for models, pipelines, cross-validation and metrics.",
    "- Gradient boosting: xgboost, lightgbm, catboost. Imbalanced data: imbalanced-learn. Encoding: category-encoders. Tuning: optuna, hyperopt. Explaining models: shap, lime. Model plots: yellowbrick, mlxtend.",
    "- Deep learning: PyTorch (torch, torchvision, torchaudio) by default; TensorFlow/Keras or JAX when the user asks or the note already uses them. Pretrained models and datasets: transformers, datasets (Hugging Face).",
    "- Statistics: statsmodels (regression, GLM, ANOVA, tests), pingouin (quick tests and effect sizes), lifelines (survival). Bayesian: pymc with arviz, emcee for MCMC. Curve fitting: lmfit or scipy.optimize.curve_fit.",
    "- Time series: statsmodels (ARIMA, SARIMAX), pmdarima (auto ARIMA), statsforecast, prophet, sktime, tslearn.",
    "- Clustering and embeddings: scikit-learn, umap-learn, hdbscan.",
    "- Text: spacy, nltk, gensim, textblob, wordcloud; transformers for modern models.",
    "- Images and vision: scikit-image, opencv-python-headless (import cv2), torchvision.",
    "- Simulation: numpy for vectorised models, simpy (discrete events), mesa (agent-based), gymnasium (reinforcement learning), numba to speed up loops; symbolic maths: sympy; graphs and networks: networkx.",
    "- Big tables: polars, duckdb (SQL on data frames), pyarrow, dask; files: h5py, openpyxl. Maps: geopandas, folium. Grammar-of-graphics plots: plotnine. Progress bars: tqdm.",
    "Prefer the simplest library that does the job well, and the device group when it is enough.",
  ].join("\n"),
  r: "Which R packages (installed on the server; in the browser they load when named): base R and stats for models and tests; tidyverse (dplyr, tidyr, readr, purrr) for data; ggplot2 for plots; data.table for big tables; MASS; lme4 for mixed models; survival; randomForest, caret, glmnet and e1071 (SVM) for machine learning; forecast for time series. Draw with ggplot2 and print() the plot.",
  julia: "Which Julia packages (installed): Plots for figures, DataFrames and CSV for data, Distributions and StatsBase for statistics; LinearAlgebra, Statistics and Random from the standard library. Other packages need Pkg.add first, which is slow: avoid it unless the user asks.",
  matlab: "This runs MATLAB code in GNU Octave, with the statistics, signal, optim and control packages (load them with pkg load statistics, and so on). Plot with figure and plot; toolboxes beyond those aren't there.",
  c: "C17 with the standard library and math (-lm). No outside libraries: write what's needed. Print results with printf.",
  cpp: "C++20 with the standard library (vector, algorithm, numeric, random, chrono). No outside libraries such as Eigen or Boost: write what's needed.",
  fortran: "Fortran 2008 (gfortran) with its intrinsics (matmul, dot_product, random_number). No outside libraries such as LAPACK.",
};
export const libraryGuide = (language: string): string => LIBRARIES[language] ?? "";

/**
 * Where the agent's run goes, decided by the app, not the model: a Python cell that imports a
 * library only the server has goes to the server (on the phone it would fail; in the browser it
 * would load, fail and move); otherwise where the model asked, or the device.
 */
export function runPlace(cell: { language: string; content: string }, asked: RunWhere | undefined): RunWhere | undefined {
  if (cell.language === "python" && serverOnlyImports(cell.content).length) return "server";
  return asked;
}

/** How results show in Benchjot, so the agent's code shows them (public/workers/bj_capture.py). */
export const OUTPUT_RULE =
  "How results show: print() for text. A matplotlib figure shows when you call plt.show(), or when it is still open at the end. A DataFrame shows as a table with display(df) or as the cell's last line; Plotly, Altair and Bokeh charts show interactive the same way. A matplotlib animation (FuncAnimation, ArtistAnimation) becomes a GIF by itself: keep it in a variable until the end and don't close its figure; no anim.save, HTML or writer needed. Experiment tracking: when a cell measures results (accuracy, loss, a score) or tries settings (learning rate, epochs, seed), end it with log(name=value, …), e.g. log(accuracy=acc, lr=lr, epochs=20), with the real computed values only; every run that logs joins the note's Runs table, side by side with the others. log(), save_data() and display() are built in: never import from IPython, and never use HTML(), Image(), to_jshtml(), to_html5_video() or widgets, which only print an object's name here.";

/** The user's other notes: how the agent finds them, reads them and asks them. */
export const NOTES_RULE =
  "The user's other notes are their other experiments. When the request needs one (an earlier attempt, a result to compare with, a method used before, a note this one links to), call find_notes (with words to search for, or empty for the notes linked to this one, its parent and children, and the most recent), then read_note to read a note's graph (free), and ask_note only when its graph doesn't answer the question: that note's own assistant reads it in full and answers (it costs a few AI requests). Say which note a fact came from. You can't change other notes yourself: when one should change (a result to record, a link back to this note), call propose_change, and it is applied only if the user taps Apply.";

/** How the agent reads the note: the graph first, and what "shown" means. */
export const GRAPH_RULE =
  "The note starts with its <graph>: a short card for the note (its question, setup, result and outcome) and one for each cell (what it is for, what was expected, how it last ran, what it showed, what it printed, what was observed). It is built from the note itself: read it first, so you know where whatever you work on sits in the experiment, then read the cells you need in full. Everything listed as \"shown in the note\" is already displayed to the user (figures, tables, charts, images, videos, animations): never change code to make it show again. A cell marked CHANGED since its run has results of older code: run it before you rely on them.";

/** What the agent never does: anything that would pass off a failure as a result. */
export const HONEST_RULE =
  "Never fake anything. No placeholder plots, dummy or made-up data, or numbers the note doesn't show; no try/except or fallback that hides an error so a cell \"never errors\". If a run fails, read the error and fix its cause. If something can't be done here, say so plainly and say what would do it. Real data: when the work names or needs a real dataset (a published dataset, a benchmark, measurements), get the real one before writing code that uses it: list_data first, then find_datasets, web_search and web_fetch to find where it is published, then save_data with the file's address, or a server cell that downloads it. Never stand in synthetic, simulated or \"-like\" data for a real dataset unless the user asks for it; if the real data truly can't be reached, stop and say where it is and what's needed (a sign-in, a request form), instead of inventing it.";

/** The agent's rules: what it is, its tools, how it works, and what it never does. */
export function agentRules(language: string): string {
  const label = languageConfig(language).label;
  return [
    "You are the assistant inside Benchjot, a research notebook: a sharp research partner who also does the work. The user writes or speaks to you about their note; you answer, and you act in the note with tools.",
    "The note is given between <note> tags: its text, then each code cell, numbered ([Cell 1], [Cell 2], …), with its notes and its last output or error. A cell marked \"you wrote this cell\" is one you added earlier in this conversation; the others are the user's. The conversation so far comes before the request, with what you did in the note each time (and whether the user undid it).",
    "Do what the user most plausibly means, in the light of the conversation: a short follow-up (\"insert it\", \"do that\", \"undo what you wrote\") refers to what was just said or done. Spoken requests may have misheard words: read them charitably. Ask one short question only when you truly can't tell what's wanted; otherwise act.",
    "A question gets an answer: call finish with it. Be direct and specific, with the numbers from the note.",
    "For work that takes more than one step, call set_plan in your first reply with two to five short steps (a few words each; the user sees them as a checklist), and tick it as you go: each time a step is finished, call set_plan with the same steps and done = how many are finished, in the same reply as your other calls. The user watches that checklist to follow the work.",
    "You act only through your tools: add_cell, edit_cell, run_cell, delete_cell, write_note, replace_note, find_notes, read_note, ask_note, propose_change, list_data, save_data, find_datasets, set_plan, finish, and web_search and web_fetch for the web. Cells are numbered from 1 as the note shows them. Never write a tool call, JSON or code meant for a cell in your text.",
    RUNTIME_RULE,
    WHERE_RULE,
    language === "python" ? OUTPUT_RULE : "",
    GRAPH_RULE,
    NOTES_RULE,
    HONEST_RULE,
    WEB_RULE,
    "In code, a line break inside a Python string is written \\\\n in the JSON (it must stay a backslash-n in the cell); never put a real line break inside a string.",
    `Code you write goes into the note and you run it: add the cell and run it in the same step, read what it gave in the next step, fix it until it works, and only then say it's done. Write complete programs in ${label} unless the user asks for another language. Add a new cell for new work; change an existing cell only when the request is about it, or to fix code you wrote.`,
    "After a run, read its output before going on. Don't run a cell again without changing it, unless asked. If the same error comes back twice, stop and say what's wrong.",
    libraryGuide(language),
    "Writing in the note's text: when asked to write, add or fill in something (a result, a summary, a method), use write_note under the line it belongs to, or replace_note to fill a placeholder or change what's there. Never add a second copy of something the note already has: change it instead. To take back text you wrote, use replace_note with an empty replace. Say in message what you changed and where. You never change cell notes or the outcome.",
    `You have up to ${AGENT_LIMITS.callsPerStep} calls a step, and as many steps as the work needs. Make the calls that don't depend on each other in the same step (add a cell and run it; write in the note and run a cell); they are made in order, each done before the next starts.`,
    "Each reply is one short line saying what you're doing, with the tool calls that do it. Never say you will do something without making its call in the same reply: an announced action with no call is a failure. The app lists what you did in the note by itself, so don't list it or write \"Done in the note\".",
    "Only when the request is finished, and every cell you wrote or changed has run cleanly with its current code, call finish with your answer: what you did and what the results show, with the numbers, and plainly what is left undone, if anything. The user can undo everything you changed in one tap.",
    DATA_RULE,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * The tools, as the model is given them (native tool calling; lib/server/llm.ts hands them to
 * Claude as its tools). finish and set_plan aren't note actions:
 * they end the request and tick the checklist.
 */
const str = (description: string) => ({ type: "string", description });
const num = (description: string) => ({ type: "integer", minimum: 1, description });
const tool = (name: string, description: string, properties: Record<string, unknown>, required: string[]) => ({ type: "function", function: { name, description, parameters: { type: "object", properties, required, additionalProperties: false } } });
export const AGENT_TOOLS = [
  tool("add_cell", "Adds a new code cell at the end of the note. Run it in the same reply.", { language: { type: "string", enum: ["python", "r", "julia", "c", "cpp", "fortran", "matlab"], description: "The cell's language" }, code: str("One whole program") }, ["language", "code"]),
  tool("edit_cell", "Replaces a cell's whole code. Run it again in the same reply.", { cell: num("The cell's number"), code: str("The cell's whole new code") }, ["cell", "code"]),
  tool("run_cell", "Runs a cell; its output, figures, tables or error come back. The app runs it on the device or the server as its libraries need.", { cell: num("The cell's number"), where: { type: "string", enum: ["device", "server"], description: "Optional: server for heavy work" } }, ["cell"]),
  tool("delete_cell", "Deletes a cell you added for this request.", { cell: num("The cell's number") }, ["cell"]),
  tool("write_note", "Adds Markdown to the note's text under a line of it.", { after: str("A line of the note's text, copied exactly (such as a heading), or empty for the end"), text: str("The Markdown to add") }, ["after", "text"]),
  tool("replace_note", "Changes or removes part of the note's text.", { find: str("Text that appears exactly once in the note's text"), replace: str("The new text; empty to delete it") }, ["find", "replace"]),
  tool("find_notes", "Finds the user's other notes: by words, or (empty) the ones linked to this note, its parent and children, and the most recent. Each comes back with a reference (N1, N2, …).", { query: str("Words to search for, or empty") }, ["query"]),
  tool("read_note", "Reads another note's graph: its question, setup, result, outcome and a card for each cell. Free.", { note: str("The note's reference from find_notes, such as N2") }, ["note"]),
  tool("ask_note", "Asks another note's own assistant a question about that note; it reads the note in full and answers. Costs a few AI requests: use it when read_note doesn't answer.", { note: str("The note's reference from find_notes, such as N2"), question: str("What to find out from that note") }, ["note", "question"]),
  tool("propose_change", "Proposes adding Markdown to another note's text. Nothing changes until the user taps Apply.", { note: str("The note's reference from find_notes, such as N2"), after: str("A line of that note's text, copied exactly, or empty for the end"), text: str("The Markdown to add") }, ["note", "after", "text"]),
  tool("list_data", "Lists the files in the user's Data library: datasets they uploaded or you saved. Any cell can open one by its name. Free.", {}, []),
  tool("save_data", "Downloads a file from a public https address (from the user or a search result) into the Data library, up to 50 MB, so every cell can open it by name. For files behind a sign-in or a script, download in a server cell instead.", { url: str("The file's https address"), name: str("Optional: the name to keep it under, with its extension, such as iris.csv; empty for the address's own") }, ["url", "name"]),
  tool("find_datasets", "Searches public data platforms at once (Hugging Face, Zenodo, OpenML, Harvard Dataverse, figshare; no sign-in). Give words to list matching datasets, each with a ref such as zenodo:7267888; give a ref to get that dataset's files with the address of each, which you pass to save_data.", { query: str("Words to search for (a dataset's subject or name), or a ref from an earlier search such as hf:scikit-learn/iris") }, ["query"]),
  tool("set_plan", "Sets the plan the user sees as a checklist, or ticks it.", { steps: { type: "array", items: { type: "string" }, description: "Two to five short steps" }, done: { type: "integer", minimum: 0, description: "How many steps are finished" } }, ["steps", "done"]),
  tool("finish", "Ends the request with your answer. Only when everything asked is done and every cell you wrote or changed has run cleanly.", { answer: str("What you did and what the results show, with the numbers; Markdown, no code blocks") }, ["answer"]),
] as const;

/** The results of a step's calls, as the model reads them in the next. */
function resultsText(results: readonly string[]): string {
  return results.length ? `Results of your calls:\n${results.map((r, i) => `${i + 1}. ${r}`).join("\n")}` : "You made no calls.";
}

/** The conversation before this request, as chat turns: each earlier request and what was answered or done. */
function historyTurns(history: AssistantHistory) {
  return history.turns.flatMap((t) => {
    const a = t.answer;
    const { did, text } = a.kind === "code" ? { did: "", text: "" } : splitSummary(a.text);
    const said = a.kind === "code" ? [a.summary, a.code ? `Code proposed:\n${a.code}` : ""].filter(Boolean).join("\n\n") : text;
    const wrote = a.wrote ? `\n\nWrote into the note:\n${a.wrote}` : "";
    // What it did in the note goes back as a field of its own, so the model never copies a "Done in the note" line into its answers.
    return [
      { role: "user" as const, content: t.request },
      { role: "assistant" as const, content: `${said}${wrote}${did ? `\n\n[What I changed in the note then: ${did}]` : ""}` },
    ];
  });
}

/** Chat messages for one step: the rules, the conversation so far, the request, each earlier step and its results, then the note as it is now. */
export function agentMessages({ request, language, title, note, steps, history = NO_HISTORY }: z.output<typeof agentRequest>): ChatMessage[] {
  const now = `${earlierBlock(history.summary)}${noteBlock(title, note)}\n\nCode language for this note: ${languageConfig(language).label}`;
  const out: ChatMessage[] = [{ role: "system", content: agentRules(language) }, ...historyTurns(history), { role: "user", content: `Request: ${request}` }];
  steps.forEach((s, i) => {
    const plan = s.plan ? `\n[Plan: ${s.plan.join("; ")}]` : "";
    if (s.calls.length) {
      const ids = s.calls.map((_, j) => `s${i}c${j}`);
      out.push({ role: "assistant", content: `${s.message}${plan}`, tool_calls: s.calls.map(({ tool: name, ...args }, j) => ({ id: ids[j]!, type: "function" as const, function: { name, arguments: JSON.stringify(args) } })) });
      ids.forEach((id, j) => out.push({ role: "tool", tool_call_id: id, content: s.results[j] ?? "No result." }));
      if (s.results.length > s.calls.length) out.push({ role: "user", content: s.results.slice(s.calls.length).join("\n") });
    } else {
      out.push({ role: "assistant", content: `${s.message || "(no reply)"}${plan}` }, { role: "user", content: resultsText(s.results) });
    }
  });
  const tail = `The note as it is now:\n${now}${steps.length ? `\n\nContinue the request: ${request}` : ""}`;
  const last = out[out.length - 1]!;
  if (last.role === "user") out[out.length - 1] = { ...last, content: `${last.content}\n\n${tail}` };
  else out.push({ role: "user", content: tail });
  return out;
}

// ------------------------------------------------------------------ reading the reply

/** The reply as the browser gets it: what the agent says, the calls to make, and whether it is done. */
export interface AgentReply {
  message: string;
  calls: AgentCall[];
  done: boolean;
  /** The plan's steps (a checklist the panel ticks off), when it sets or changes one. */
  plan?: string[];
  /** How many plan steps are finished. */
  planDone?: number;
  /** The reply was cut off at the length limit before it was whole: its calls are lost, and it is told to write less. */
  cut?: boolean;
  /** It called finish: it says the request is done (the loop still checks its work before ending). */
  finished?: boolean;
  /** Calls that couldn't be made as written (not a tool, the wrong language): told back to it, not thrown. */
  problems?: string[];
  /** The id of each call in `calls` (Claude's tool_use ids), so its result goes back to it. */
  ids?: string[];
  /** Live conversation: the turns to add to it (what was asked this step and Claude's reply). */
  turns?: LiveMessage[];
}

/** Said to the agent when its reply was cut off at the length limit. */
export const CUT_RESULT =
  "Your last reply was cut off at the length limit before it was complete, so none of its calls were made. Keep each reply short: code under about 120 lines (split bigger work across cells or steps), and plain strings in the code.";

const replyShape = z.object({
  message: z.string().default(""),
  calls: z.array(z.unknown()).default([]),
  done: z.boolean().default(false),
  plan: z.array(z.string()).optional().catch(undefined),
  plan_done: z.number().int().min(0).max(20).optional().catch(undefined),
});

/** A plan as shown: two to six short steps, each one line. */
function tidyPlan(plan: readonly string[] | undefined): string[] | undefined {
  const steps = (plan ?? []).map((p) => p.replace(/^\s*(\d+[.)]|[-*•])\s*/, "").replace(/\s+/g, " ").trim()).filter(Boolean).map((p) => headCut(p, 120)).slice(0, 6);
  return steps.length >= 2 ? steps : undefined;
}

const NO_STEP = "The agent didn’t say what to do. Try again.";

/**
 * Reads one step's reply. Calls that don't fit a tool are left out; code in another language than the
 * one asked for is refused in plain words; a reply with no calls is the end (one with calls goes on,
 * whatever its "done" says). More calls than a step
 * allows are cut to the first ones.
 */
export function parseAgentReply(language: string, content: string): AgentReply {
  const read = readJsonReply(content, replyShape);
  // Calls the model wrote into its message instead of "calls" are made, not shown as raw JSON.
  const leak = splitLeakedCalls(read.message);
  const r = { ...read, message: leak.message, calls: read.calls.length ? read.calls : leak.calls };
  const reply = buildReply(language, r.message, r.calls, r.plan, r.plan_done);
  if (!reply.calls.length && !reply.message && !reply.problems) throw new FriendlyError(NO_STEP);
  return reply;
}

/**
 * One step's reply from native tool calls: the calls to make, set_plan as the checklist, finish as
 * the end (with its answer as what's said). A model that wrote its reply as text instead (JSON, or
 * calls in prose) is read from the text.
 */
export function readNativeReply(language: string, content: string, native: readonly { id?: string; type?: string; function: { name: string; arguments: string } }[]): AgentReply {
  const raw: unknown[] = [];
  const problems: string[] = [];
  let finished = false;
  let answer = "";
  let plan: string[] | undefined;
  let planDone: number | undefined;
  for (const c of native) {
    let args: Record<string, unknown>;
    try {
      args = (JSON.parse(c.function.arguments || "{}") ?? {}) as Record<string, unknown>;
    } catch {
      problems.push(`Your ${c.function.name} call's arguments weren't valid JSON, so it wasn't made. Make it again.`);
      continue;
    }
    if (c.function.name === "finish") {
      finished = true;
      answer = typeof args.answer === "string" ? args.answer.trim() : "";
    } else if (c.function.name === "set_plan") {
      plan = Array.isArray(args.steps) ? args.steps.map(String) : undefined;
      planDone = typeof args.done === "number" ? args.done : undefined;
    } else raw.push({ tool: c.function.name, ...args, ...(c.id ? { [CALL_ID]: c.id } : {}) });
  }
  let message = (content ?? "").trim();
  if (!native.length && message) {
    // No tool calls: a model that wrote them as text (a JSON reply, or calls in prose) still acts.
    try {
      const r = readJsonReply(message, replyShape);
      if (r.calls.length || r.message) return { ...buildReply(language, r.message, r.calls, r.plan, r.plan_done), ...(r.done && !r.calls.length ? { finished: true } : {}) };
    } catch {
      // prose: read as prose
    }
    const leak = splitLeakedCalls(message);
    message = leak.message;
    raw.push(...leak.calls);
  }
  const reply = buildReply(language, finished && answer ? answer : message, raw, plan, planDone);
  const all = [...problems, ...(reply.problems ?? [])];
  return { ...reply, ...(finished && !reply.calls.length ? { finished: true } : {}), ...(all.length ? { problems: all } : {}) };
}

/** A reply cut off at the length limit with native tools: what it said, marked cut (its calls are lost). */
export function cutNativeReply(content: string): AgentReply {
  return { message: splitLeakedCalls((content ?? "").trim()).message, calls: [], done: false, cut: true };
}

/** Where a raw call carries its tool_use id through buildReply (the call's own fields are checked without it). */
const CALL_ID = "__id";

/** The calls that fit a tool, tidied; the rest said back as problems. */
function buildReply(language: string, said: string, rawCalls: readonly unknown[], rawPlan?: readonly string[], rawPlanDone?: number): AgentReply {
  const calls: AgentCall[] = [];
  const ids: (string | undefined)[] = [];
  const problems: string[] = [];
  if (rawCalls.length > AGENT_LIMITS.callsPerStep) problems.push(`Only your first ${AGENT_LIMITS.callsPerStep} calls were made; make the rest next.`);
  for (const raw of rawCalls.slice(0, AGENT_LIMITS.callsPerStep)) {
    const id = (raw as Record<string, unknown> | null)?.[CALL_ID];
    const before = calls.length;
    const c = agentCall.safeParse(raw);
    if (!c.success) {
      const name = (raw as { tool?: unknown } | null)?.tool;
      problems.push(`A ${typeof name === "string" ? name : "tool"} call wasn't made: its arguments didn't fit the tool. Check them and make it again.`);
      continue;
    }
    if (c.data.tool === "add_cell") {
      const lang: LanguageId = isLanguageId(c.data.language) && c.data.language !== "text" ? c.data.language : isLanguageId(language) ? language : DEFAULT_LANGUAGE;
      if (!c.data.code.trim()) continue;
      if (wrongLanguage(lang, c.data.code)) {
        problems.push(`add_cell wasn't made: its code isn't ${languageConfig(lang).label}. Write it in ${languageConfig(lang).label}.`);
        continue;
      }
      calls.push({ tool: "add_cell", language: lang, code: tidy(c.data.code) });
    } else if (c.data.tool === "edit_cell") {
      if (c.data.code.trim()) calls.push({ ...c.data, code: tidy(c.data.code) });
    } else if (c.data.tool === "write_note") {
      if (c.data.text.trim()) calls.push({ ...c.data, text: c.data.text.replace(/\r\n/g, "\n").trim() });
    } else if (c.data.tool === "replace_note") {
      calls.push({ ...c.data, find: c.data.find.replace(/\r\n/g, "\n"), replace: c.data.replace.replace(/\r\n/g, "\n") });
    } else if (c.data.tool === "run_cell") calls.push(c.data.where ? c.data : { tool: "run_cell", cell: c.data.cell });
    else calls.push(c.data);
    if (calls.length > before) ids.push(typeof id === "string" ? id : undefined);
  }
  const message = said.trim();
  // A step with calls always goes on, so the agent reads what they gave before it finishes.
  const plan = tidyPlan(rawPlan);
  const planDone = typeof rawPlanDone === "number" && Number.isInteger(rawPlanDone) && rawPlanDone >= 0 ? Math.min(rawPlanDone, 20) : undefined;
  const known = ids.every((i) => i !== undefined) && ids.length > 0;
  return { message, calls, done: calls.length === 0, ...(plan ? { plan } : {}), ...(planDone !== undefined ? { planDone } : {}), ...(problems.length ? { problems } : {}), ...(known ? { ids: ids as string[] } : {}) };
}

const tidy = (c: string) => c.replace(/\r\n/g, "\n").replace(/\n+$/, "");

/** Where tool-call JSON starts inside a message: a call object, a "calls" list, a whole reply object, or a code fence around one. */
const LEAK_START = /```(?:json)?\s*\{|\{\s*"(?:tool|message)"\s*:|"calls"\s*:\s*\[/;

/**
 * A message with tool calls written into it (the reported bug: an answer that ended in raw
 * {"tool": "edit_cell", …} JSON, and the edit was never made): the words before the JSON, and the
 * calls found in it, in order. A stray "{" or "[" left at the end of the words goes too.
 */
export function splitLeakedCalls(message: string): { message: string; calls: unknown[] } {
  const m = LEAK_START.exec(message);
  if (!m) return { message: message.replace(/\s*[{[]\s*$/, "").trim(), calls: [] };
  const tail = message.slice(m.index);
  const calls: unknown[] = [];
  let inner = "";
  for (let at = tail.search(/\{\s*"tool"\s*:/); at >= 0; ) {
    const obj = firstObject(tail.slice(at));
    if (obj === null) break;
    try {
      calls.push(JSON.parse(obj));
    } catch {
      // not a whole call: skipped
    }
    const next = tail.slice(at + obj.length).search(/\{\s*"tool"\s*:/);
    at = next < 0 ? -1 : at + obj.length + next;
  }
  // A whole reply written as the message: its own message is what's said.
  const whole = /\{\s*"message"\s*:/.exec(tail);
  if (whole) {
    const obj = firstObject(tail.slice(whole.index));
    try {
      const v = obj ? (JSON.parse(obj) as { message?: unknown }) : null;
      if (typeof v?.message === "string") inner = v.message.trim();
    } catch {
      // not whole: nothing said in it
    }
  }
  const before = message.slice(0, m.index).replace(/\s*[{[,:]\s*$/, "").replace(/\s*"?message"?\s*$/, "").trim();
  return { message: [before, inner].filter(Boolean).join("\n\n"), calls };
}

// ------------------------------------------------------------------ the note as the agent reads it

/** The cells as the agent reads them: the Assistant's reading, each labelled with its number, and the ones it wrote itself said so. */
export function agentCells(cells: Parameters<typeof assistantCells>[0], mine: ReadonlySet<string> = new Set()): AssistantCell[] {
  return assistantCells(cells).map((c, i) => {
    const id = (cells[i] as { id?: string }).id;
    return { ...c, label: `[Cell ${i + 1}${id && mine.has(id) ? " · you wrote this cell" : ""}]` };
  });
}

/** What Undo needs, as kept with the turn (the note's text itself isn't stored: only what was written or replaced). */
export function keptChanges(undo: AgentUndo): AgentChanges {
  return {
    added: [...undo.added],
    changed: undo.changed.map((c) => ({ id: c.id, code: c.code })),
    note: undo.note.map((e) => ({ wrote: e.wrote, ...(e.replaced !== undefined ? { replaced: e.replaced } : {}) })),
  };
}

/** Undo from what was kept with the turn: text changes are taken back by what was written (the whole text before isn't kept). */
export function undoFromKept(c: AgentChanges): AgentUndo {
  return { added: [...c.added], changed: c.changed.map((x) => ({ ...x })), note: c.note.map((e) => ({ before: "\u0000", after: "\u0000", wrote: e.wrote, replaced: e.replaced })) };
}

export const hasChanges = (c: AgentChanges | undefined) => !!c && c.added.length + c.changed.length + c.note.length > 0;

/** A finished run, as the agent reads it back: how it ended and in how long, then its output, what it made and its error. */
export function runReport(n: number, s: Pick<Cell, "language" | "content" | "last_run" | "note_before" | "note_after">): string {
  const run = s.last_run;
  if (!run) return `Cell ${n} ran, but its result wasn't saved, so there is nothing to read.`;
  const secs = run.ms >= 1000 ? `${(run.ms / 1000).toFixed(1)} s` : `${run.ms} ms`;
  const head = { ok: `Cell ${n} ran without error in ${secs}.`, error: `Cell ${n} failed after ${secs}.`, timeout: `Cell ${n} ran out of time after ${secs}.`, stopped: `Cell ${n} was stopped after ${secs}.` }[run.outcome];
  const cell = assistantCells([s])[0]!;
  const room = AGENT_LIMITS.maxResultChars - head.length - 40;
  const parts = [head];
  if (cell.stdout.trim()) parts.push(tailBlock("Output", cell.stdout, Math.floor(room / 2)));
  if (cell.produced.length) parts.push(`Shown in the note: ${cell.produced.join("; ")}.`);
  if (cell.runNotes?.length) parts.push(`Notes from the run: ${cell.runNotes.join(" ")}`);
  if (run.logged && Object.keys(run.logged).length) parts.push(`Logged: ${Object.entries(run.logged).map(([k, v]) => `${k}=${v}`).join(", ")}.`);
  if (cell.tables.length) parts.push(cell.tables[0]!);
  if (cell.error.trim()) parts.push(tailBlock("Error", cell.error, Math.floor(room / 2)));
  if (run.outcome === "ok" && !cell.stdout.trim() && !cell.produced.length) parts.push("It printed nothing.");
  return headCut(parts.join("\n"), AGENT_LIMITS.maxResultChars);
}

// ------------------------------------------------------------------ the loop

/** A cell as the loop sees it: its id, and what the agent and the reports read. */
export type AgentCell = Pick<Cell, "id" | "language" | "content" | "last_run" | "note_before" | "note_after">;

/** The note as the loop changes it: given by the page, which owns the cells. */
export interface AgentNote {
  /** The note as saved now (pending edits saved first), its cells in order. */
  read(): Promise<{ title: string; body: string; cells: AgentCell[]; outcome?: "success" | "failed" | null }>;
  /** Adds a code cell at the end; resolves with its id once the page shows it. */
  add(language: LanguageId, code: string): Promise<string>;
  /** Replaces a cell's code (and saves it). */
  setCode(id: string, code: string): Promise<void>;
  /** Runs a cell on the device (moving to the server by itself when it must), or on the server when asked; resolves when its run is saved. */
  run(id: string, where?: RunWhere): Promise<void>;
  /** Deletes a cell (cells the agent added: delete_cell, and Undo). */
  remove(id: string): Promise<void>;
  /** Replaces the note's text (write_note, replace_note, and Undo); saved like typing. */
  setBody(text: string): Promise<void>;
  /**
   * The seer: has a vision model look at the pictures of the cell's last run that it hasn't described
   * yet and keeps what it says with that run. Best effort: resolves either way.
   */
  see?(id: string, signal: AbortSignal): Promise<void>;
  /** The user's other notes (find_notes, read_note, ask_note); absent where they can't be reached. */
  others?: OtherNotes;
  /** The user's Data library (list_data, save_data); absent where it can't be reached. */
  data?: DataLibrary;
}

/** What find_datasets read: datasets across the data platforms (each with a ref, "source:id"), or one dataset's files with the address to save each. */
export type DatasetFind =
  | { kind: "datasets"; results: { ref: string; title: string; source: string; detail: string }[]; missed: string[] }
  | { kind: "files"; ref: string; files: { name: string; url: string; size: number }[] };

/** The user's Data library: files every run can open by name. */
export interface DataLibrary {
  list(): Promise<{ name: string; size: number }[]>;
  /** Downloads a public https file into the library (the app's /api/data/fetch); throws with text for the user. */
  save(url: string, name?: string): Promise<{ name: string; size: number }>;
  /** Searches the public data platforms (find_datasets): words → datasets, a ref ("zenodo:123") → its files. Absent where it can't be reached. */
  find?(query: string): Promise<DatasetFind>;
}

const DATA_FILE_CAP = 50 * 1024 * 1024;

const sizeText = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : b >= 1024 ? `${Math.round(b / 1024)} KB` : `${b} B`);

/** A web page or a README rather than data (save_data refuses it): by its name, or a GitHub page that isn't a raw file. */
export function notData(url: string, name = ""): boolean {
  const file = (name || url.split(/[?#]/)[0]!.split("/").pop() || "").toLowerCase();
  if (/\.(html?|md|markdown|rst|php|aspx?)$/.test(file) || /^readme(\.|$)/.test(file)) return true;
  try {
    const u = new URL(url);
    return u.hostname === "github.com" && !/\/(raw|releases\/download)\//.test(u.pathname) && !/[?&]raw=(true|1)/.test(u.search);
  } catch {
    return false;
  }
}

/** list_data and save_data. */
async function dataCall(call: Extract<AgentCall, { tool: "list_data" | "save_data" | "find_datasets" }>, data: DataLibrary | undefined): Promise<{ result: string; action: AgentAction }> {
  if (!data) return { result: "The Data library can't be reached here.", action: { text: "Data library not reachable", tone: "fail" } };
  if (call.tool === "list_data") {
    const files = await data.list();
    const lines = files.map((f) => `- ${f.name} (${sizeText(f.size)})`);
    return {
      result: files.length ? `The Data library (a cell that names a file in quotes, like pd.read_csv("${files[0]!.name}"), finds it in its working folder):\n${lines.join("\n")}` : "The Data library is empty.",
      action: { text: `Looked in Data · ${files.length} file${files.length === 1 ? "" : "s"}`, tone: "plain", ...(lines.length ? { detail: { kind: "text" as const, text: lines.join("\n") } } : {}) },
    };
  }
  if (call.tool === "find_datasets") {
    if (!data.find) return { result: "Dataset search can't be reached here. Use web_search to find a dataset, then save_data with the file's address.", action: { text: "Dataset search not reachable", tone: "fail" } };
    try {
      const found = await data.find(call.query);
      if (found.kind === "datasets") {
        const missed = found.missed.length ? ` (${found.missed.join(", ")} didn't answer this time)` : "";
        if (!found.results.length) return { result: `No datasets match "${call.query}" by title on Hugging Face, Zenodo, OpenML, Harvard Dataverse or figshare${missed}. Try fewer or other words, or web_search.`, action: { text: `No datasets for "${call.query}"`, tone: "plain" } };
        const lines = found.results.slice(0, 15).map((r) => `- ${r.ref} — ${r.title} (${r.source}${r.detail ? `; ${r.detail}` : ""})`);
        return { result: `Datasets for "${call.query}"${missed} (call find_datasets again with a ref, such as ${found.results[0]!.ref}, to see its files):\n${lines.join("\n")}`, action: { text: `Found ${found.results.length} dataset${found.results.length === 1 ? "" : "s"}`, tone: "plain", detail: { kind: "text", text: lines.join("\n") } } };
      }
      if (!found.files.length) return { result: `${found.ref} has no data files (tables, arrays or data archives). Pick another dataset, or load it in a server cell.`, action: { text: `No data files in ${found.ref}`, tone: "plain" } };
      const lines = found.files.slice(0, 16).map((f) => `- ${f.name} — ${f.size ? sizeText(f.size) : "size not given"}${f.size > DATA_FILE_CAP ? " (over 50 MB — load it in a server cell instead)" : ` — ${f.url}`}`);
      return { result: `Files in ${found.ref} (pass a file's address to save_data to add it to the library):\n${lines.join("\n")}`, action: { text: `${found.files.length} file${found.files.length === 1 ? "" : "s"} in ${found.ref}`, tone: "plain", detail: { kind: "text", text: lines.join("\n") } } };
    } catch (e) {
      const why = e instanceof Error ? e.message : "The search failed.";
      return { result: `Couldn't search for datasets: ${why}`, action: { text: "Dataset search failed", tone: "fail" } };
    }
  }
  if (notData(call.url, call.name)) return { result: "That's a page, not a data file: the library is for datasets. Read pages and READMEs with web_fetch, and save the data files they point to.", action: { text: "Not a data file", tone: "plain" } };
  try {
    const got = await data.save(call.url, call.name || undefined);
    return { result: `Saved ${got.name} (${sizeText(got.size)}) in the Data library. Open it by that name in any cell, e.g. "${got.name}".`, action: { text: `Saved ${got.name} to Data · ${sizeText(got.size)}`, tone: "plain" } };
  } catch (e) {
    const why = e instanceof Error ? e.message : "It couldn't be saved.";
    return { result: `Couldn't save it: ${why} If the file needs a sign-in or a script to reach, download it in a server cell instead (see the web rules).`, action: { text: "Couldn't save the file to Data", tone: "fail", detail: { kind: "text", text: why } } };
  }
}

/** One of the user's other notes, as find_notes lists it; `why` says how it relates to this note. */
export type NoteSummary = { id: string; title: string; outcome: NoteOutcome; updated_at: string; why?: string };
type NoteOutcome = "success" | "failed" | null;

/** The user's other notes, read only. */
export interface OtherNotes {
  /** Notes matching the words; with none, the linked ones, the parent and children, then the most recent. Never `from` (default: the note the user is in). */
  find(query: string, from?: { id: string; parent_id: string | null; body: string }): Promise<NoteSummary[]>;
  /** Another note as saved, or null when it's gone. */
  open(id: string): Promise<SavedNote | null>;
}

/** A note as another note's agent reads it. */
export type SavedNote = { title: string; body: string; cells: AgentCell[]; outcome?: NoteOutcome; parent_id?: string | null };

/** What a thing done in the note looks like when opened: the code added, the change made, what a run gave, or the text written. */
export type ActionDetail =
  | { kind: "code"; language: string; code: string }
  | { kind: "diff"; before: string; after: string }
  | { kind: "output"; text: string }
  | { kind: "text"; text: string }
  | ({ kind: "proposal"; applied?: boolean } & NoteProposal);

/** One thing done in the note, as the panel shows it: a line, whether it went well, the cell it is about, and what it looks like opened. */
export interface AgentAction {
  text: string;
  tone: "ok" | "fail" | "plain";
  /** The cell it's about, so the panel can go to it. */
  cellId?: string;
  detail?: ActionDetail;
}

/** Details are kept with the turn, so each is cut to this (the whole is in the note). */
const DETAIL_CHARS = 6_000;
const clip = (t: string) => headCut(t, DETAIL_CHARS);

/** What one step did, as the panel shows it. */
export interface AgentDone {
  message: string;
  actions: AgentAction[];
}

/** Working steps without a tick before the agent is reminded of its plan. */
export const PLAN_NUDGE_STEPS = 2;

/** Told to the agent when its checklist hasn't moved for a while: the user watches it to see progress. */
export function planNudge(plan: AgentPlan): string {
  return `Your plan shows ${plan.done} of ${plan.steps.length} steps done (next: "${plan.steps[plan.done] ?? ""}"). The user watches this checklist: when a step is finished, call set_plan with the same steps and done = how many are finished, in the same reply as your other calls.`;
}

/** The agent's plan, as a checklist: its steps, and how many are finished. */
export interface AgentPlan {
  steps: string[];
  done: number;
}

export type AgentState = (
  | { status: "working"; steps: AgentDone[]; doing: string; /** The step it is on, from 1. */ step: number }
  | { status: "done"; steps: AgentDone[] }
  | { status: "stopped"; steps: AgentDone[] }
  | { status: "failed"; steps: AgentDone[]; message: string; offer?: string }
) & { plan?: AgentPlan };

/** A change to the note's text: the text before and after, and what was written or replaced (to take it out again if the user edited around it). */
export interface NoteEdit {
  before: string;
  after: string;
  wrote: string;
  replaced?: string;
}

/** What Undo puts back: the cells the agent added, the code of each cell it changed as it was before, and its changes to the note's text. */
export interface AgentUndo {
  added: string[];
  changed: { id: string; code: string }[];
  note: NoteEdit[];
}

/** One step's request: the body to send to /api/agent, answered by the reply. */
type AskStep = (body: AgentRequest, signal: AbortSignal) => Promise<AgentReply>;

/** An error said in one line: its last line, where Python puts the exception ("NameError: …"), not the traceback's first. */
const shortLine = (s: string) => {
  const line = [...s.split("\n")].reverse().find((l) => l.trim())?.trim() ?? "";
  return line.length > 80 ? `${line.slice(0, 79)}…` : line;
};

/**
 * Carries the request out: asks for a step, makes its calls in order on the note, sends back what
 * each gave, until the agent is done, `signal` stops it, or the steps run out. `onState` hears every
 * change; `undo` gathers what to put back. A failed call (a cell that doesn't exist, one that is
 * already running) is reported to the agent as its result, not thrown.
 */
/** A step's request that failed for a passing reason (slow, overloaded, dropped): waited out and asked again by itself. */
export function passingFailure(e: unknown): boolean {
  const x = e as { code?: unknown; status?: unknown; name?: unknown } | null;
  if (x?.name === "AbortError") return false;
  // The server's own words (the AI isn't set up, its key was refused): final, not a hiccup.
  if (x?.code === "notice") return false;
  if (x?.code === "timeout" || x?.code === "server") return true;
  if (typeof x?.status === "number" && (x.status >= 500 || x.status === 408)) return true;
  return e instanceof TypeError; // the connection dropped
}

/**
 * How a request rides out hiccups by itself, so the user never has to step in: a slow, busy or dropped
 * AI is waited out (the waits grow to a minute, up to maxTries tries, about four minutes; Stop ends it sooner); an AI limit that
 * clears within a minute or two is waited out [limitTries] times; and work that needs more than
 * AGENT_LIMITS.steps steps goes on (the oldest steps drop out of what's sent back) up to [maxSteps].
 */
export const AGENT_PATIENCE = { waitsS: [5, 15, 30, 60], maxTries: 6, limitTries: 2, maxLimitWaitS: 120, maxSteps: 24 } as const;

/** Seconds to wait before asking again, or null when waiting won't help (a refusal, a daily limit, Stop). */
export function retryWait(e: unknown, attempt: number, limitTries: number): number | null {
  const x = e as { status?: unknown; retryAfter?: unknown } | null;
  // A hiccup is waited out, but not forever: after maxTries (about four minutes) the error shows.
  if (passingFailure(e)) return attempt + 1 < AGENT_PATIENCE.maxTries ? AGENT_PATIENCE.waitsS[Math.min(attempt, AGENT_PATIENCE.waitsS.length - 1)]! : null;
  if (x?.status === 429 && limitTries < AGENT_PATIENCE.limitTries) {
    // A per-minute limit clears by itself; a daily one (a long retryAfter) doesn't.
    const after = typeof x.retryAfter === "number" ? x.retryAfter : 60;
    return after <= AGENT_PATIENCE.maxLimitWaitS ? Math.max(after, 5) : null;
  }
  return null;
}

/** Told to the agent after its reply took too long to arrive: a shorter reply gets through. */
export const SLOW_RESULT = "Your last reply took too long to arrive and was lost, so none of its calls were made. Reply again, shorter: one small step, code under about 120 lines.";

/** Told to the agent on its last step: it finishes with what it has instead of being cut off. */
const LAST_STEP_RESULT = "This is your last step: call finish now with what you did, what the results show (with the numbers), and plainly what is left undone, if anything.";

/** The clock the loop waits on (tests make it instant). */
export const agentClock = {
  sleep: (ms: number, signal: AbortSignal) =>
    new Promise<void>((done) => {
      const t = setTimeout(done, ms);
      signal.addEventListener("abort", () => (clearTimeout(t), done()), { once: true });
    }),
};

const offline = () => typeof navigator !== "undefined" && navigator.onLine === false;

export async function runAgent(
  request: string,
  note: AgentNote,
  ask: AskStep,
  onState: (s: AgentState) => void,
  undo: AgentUndo,
  signal: AbortSignal,
  history: AssistantHistory = NO_HISTORY,
  mine: ReadonlySet<string> = new Set(),
  opts: { maxSteps?: number; reach?: Pick<Reach, "budget" | "depth" | "path" | "self">; resume?: AgentCheckpoint; onCheckpoint?: (c: AgentCheckpoint) => void } = {},
): Promise<AgentState> {
  const maxSteps = opts.maxSteps ?? AGENT_PATIENCE.maxSteps;
  // Other notes, reached by reference (N1, N2, …) for this request; a note asked by another shares its budget and chain.
  const reach: Reach | undefined = note.others ? { others: note.others, refs: new Map(), ask, budget: { left: NOTES_REACH.budget }, depth: 0, path: [], from: "", ...opts.reach } : undefined;
  // A request picked up again (the page was left mid-request): it goes on from the step it had reached.
  const from = opts.resume;
  const shown: AgentDone[] = from ? [...from.shown] : [];
  const sent: AgentStep[] = from ? [...from.sent] : [];
  let checks = from?.checks ?? 0;
  let nudges = from?.nudges ?? 0;
  const loops = loopGuard();
  let plan: AgentPlan | undefined = from?.plan;
  /** Working steps since the plan was last set or ticked (planNudge). */
  let untickedSteps = 0;
  // The live conversation (LIVE): Claude's own turns, kept and sent back unchanged; null once it's
  // too big (or a request was picked up without it), and the request goes on rebuilt from `sent`.
  let live: LiveMessage[] | null = from ? (from.live?.transcript ?? null) : [];
  let liveLanguage = from?.live?.language;
  // What the last step's calls gave, to send with the next step.
  let pend: LivePending = from?.live?.pending ?? { results: [], notes: [] };
  const keep = (step: AgentStep, ids?: readonly string[]) => {
    sent.push(step);
    pend = pendingOf(ids, step.calls.length, step.results);
  };
  const report = (s: AgentState) => {
    const withPlan: AgentState = plan ? { ...s, plan: { ...plan } } : s;
    onState(withPlan);
    return withPlan;
  };
  try {
    if (!from) await seeFirst(note, signal, () => report({ status: "working", steps: [], doing: "Looking at the figures…", step: 1 }));
    for (let step = from?.step ?? 0; step < maxSteps; step++) {
      // Where it is, kept before each step, so a request left mid-way can go on from here.
      const keptLive = live && liveLanguage && jsonSize(live) <= LIVE.maxKeptChars ? { live: { transcript: [...live], language: liveLanguage, pending: pend } } : {};
      opts.onCheckpoint?.({ step, sent: [...sent], shown: [...shown], checks, nudges, ...(plan ? { plan: { ...plan } } : {}), ...keptLive });
      report({ status: "working", steps: [...shown], doing: from && step === from.step ? "Picking up where it left off…" : sent.length === 0 ? "Reading the note…" : "Thinking…", step: sent.length + 1 });
      const now = await note.read();
      if (reach) reach.from = now.title;
      const language = assistantLanguageOf(now.cells);
      // As many steps as the work needs: the last ones go back; the note shows all it did.
      const recent = sent.slice(-(AGENT_LIMITS.steps - 1));
      // The note's context graph goes first (built from the note, no AI request), then the note itself.
      const graph = noteGraph(now.title, now.body, now.outcome, now.cells);
      const room = ASSISTANT_LIMITS.maxContextChars - stepsSize(recent) - historySize(history) - SLOW_RESULT.length - 100 - graph.length;
      const own = new Set([...mine, ...undo.added]);
      const last = step === maxSteps - 1;
      // Its last step: it's told to finish, so it ends with an answer rather than a "go on".
      const steps = last ? [...recent.slice(-(AGENT_LIMITS.steps - 2)), sentStep({ message: "", calls: [], results: [LAST_STEP_RESULT] })] : recent;
      const body: AgentRequest = { request, language, title: now.title, note: [graph, noteContext(now.body, agentCells(now.cells, own), room).text].filter(Boolean).join("\n\n"), steps, history };
      if (live) {
        // Live: the system prompt stays the same for the whole request (a cell in another language changes nothing).
        liveLanguage ??= language;
        const started = live.length > 0;
        Object.assign(body, {
          language: liveLanguage,
          steps: [],
          live: true,
          transcript: live,
          results: pend.results,
          notes: [...pend.notes, ...(last ? [LAST_STEP_RESULT] : [])].slice(-12),
          // The note and the history go in once, with the first step; Claude reads its own calls' results after that.
          ...(started ? { note: "", history: NO_HISTORY } : {}),
        });
      }
      let reply: AgentReply | undefined;
      let limitTries = 0;
      for (let attempt = 0; !reply; attempt++) {
        try {
          reply = await ask(body, signal);
        } catch (e) {
          if (signal.aborted) throw e;
          const wait = retryWait(e, attempt, limitTries);
          if (wait === null) throw e;
          if ((e as { status?: unknown } | null)?.status === 429) limitTries++;
          // A reply that took too long is asked for again, shorter.
          if ((e as { code?: unknown } | null)?.code === "timeout") {
            if (body.live) body.notes = [...(body.notes ?? []).filter((n) => n !== SLOW_RESULT), SLOW_RESULT].slice(-12);
            else if (body.steps.at(-1)?.results[0] !== SLOW_RESULT) body.steps = [...steps.slice(-(AGENT_LIMITS.steps - 1)), sentStep({ message: "", calls: [], results: [SLOW_RESULT] })];
          }
          // A hiccup is the agent's business, not the user's: the line stays "Thinking…" while it waits.
          report({ status: "working", steps: [...shown], doing: "Thinking…", step: sent.length + 1 });
          for (let left = wait; left > 0 && !signal.aborted; left--) await agentClock.sleep(1000, signal);
          // No connection: it goes on by itself once the connection is back.
          while (offline() && !signal.aborted) await agentClock.sleep(1000, signal);
          if (signal.aborted) return report({ status: "stopped", steps: [...shown] });
        }
      }
      if (signal.aborted) return report({ status: "stopped", steps: shown });
      if (live) {
        // Claude's turn (and what was asked) join the conversation; past its size the request goes on the older way.
        if (reply.turns?.length) live.push(...reply.turns);
        else live = null;
        if (live && jsonSize(live) > LIVE.maxChars) live = null;
        pend = { results: [], notes: [] };
      }
      if (reply.plan) plan = { steps: reply.plan, done: Math.min(reply.planDone ?? 0, reply.plan.length) };
      else if (plan && reply.planDone !== undefined) plan = { ...plan, done: Math.min(reply.planDone, plan.steps.length) };
      untickedSteps = reply.plan || reply.planDone !== undefined ? 0 : untickedSteps + (reply.calls.length ? 1 : 0);
      if (last) {
        shown.push({ message: reply.message || "It ran out of steps here; what it did is listed above.", actions: [] });
        if (plan) plan = { ...plan, done: Math.max(plan.done, Math.min(reply.planDone ?? plan.done, plan.steps.length)) };
        return report({ status: "done", steps: [...shown] });
      }
      if (reply.cut) {
        // Cut off before its calls were whole: nothing was made; it's told so and writes less. Its half
        // message isn't shown: the user reads the whole one that follows.
        keep(sentStep({ message: reply.message, calls: [], results: [CUT_RESULT] }));
        continue;
      }
      const done: AgentDone = { message: reply.message, actions: [] };
      const problems = reply.problems ?? [];
      if (reply.calls.length === 0) {
        // It stopped without calling finish. A plain answer to a question (nothing changed, nothing
        // wrong) is taken as it is; anything else, above all an announced action with no call (the
        // reported failure: "Running cell 2 again…" and then nothing), is sent back to be done.
        const acted = undo.added.length + undo.changed.length + undo.note.length > 0 || sent.some((x) => x.calls.length > 0);
        if (!reply.finished && (acted || problems.length || !reply.message) && nudges < AGENT_CHECKS.nudges) {
          nudges++;
          keep(sentStep({ message: reply.message, calls: [], results: [...problems, NO_CALL_RESULT] }));
          continue;
        }
        // Done is checked, not taken on its word: a cell it wrote or changed that hasn't run cleanly
        // with its current code sends it back, each time it tries to finish (up to AGENT_CHECKS.checks).
        const open = unfinishedCells((await note.read()).cells, undo);
        if (open && checks < AGENT_CHECKS.checks) {
          checks++;
          // Its "done" isn't shown yet: the work isn't, and the user reads the answer it gives after checking.
          report({ status: "working", steps: [...shown], doing: "Checking its work…", step: sent.length + 1 });
          keep(sentStep({ message: reply.message, calls: [], results: [open] }));
          continue;
        }
        // Still not finished after every check: said plainly with its answer, never passed off as done.
        if (open) done.message = [done.message, `**Not finished:** ${open.replace(/^Not finished: /, "").replace(/ Run and fix.*$/, "")}`].filter(Boolean).join("\n\n");
        shown.push(done);
        if (plan) plan = { ...plan, done: plan.steps.length }; // finished: every step of its plan is done
        return report({ status: "done", steps: [...shown] });
      }
      shown.push(done);
      const loopWhy = loops.before(reply.calls, now.cells);
      const results: string[] = [];
      for (const call of reply.calls) {
        if (signal.aborted) return report({ status: "stopped", steps: [...shown] });
        report({ status: "working", steps: [...shown], doing: doingText(call), step: sent.length + 1 });
        const { result, action } = await makeCall(call, note, undo, signal, reach);
        results.push(result);
        done.actions.push(action);
      }
      // Calls it made that couldn't be made as written go back with the results, so it fixes them.
      results.push(...problems);
      // The checklist the user watches only moves when it's ticked: after a couple of working steps
      // without a tick, it's reminded where the plan stands.
      if (plan && plan.done < plan.steps.length && untickedSteps >= PLAN_NUDGE_STEPS) {
        results.push(planNudge(plan));
        untickedSteps = 0;
      }
      // Going in circles: told once; the second time it stops and asks the user, with what it tried.
      const why = loopWhy ?? loops.after(reply.calls, results);
      if (why) {
        loops.hits++;
        if (loops.hits >= 2) {
          shown.push({ message: stuckMessage(why, shown), actions: [] });
          if (plan) plan = { ...plan };
          return report({ status: "done", steps: [...shown] });
        }
        results.push(loopResult(why));
      }
      keep(sentStep({ message: reply.message, calls: reply.calls, results, ...(reply.plan ? { plan: reply.plan } : {}) }), reply.ids);
    }
    return report({ status: "done", steps: [...shown] });
  } catch (e) {
    if (signal.aborted) return report({ status: "stopped", steps: [...shown] });
    throw Object.assign(e as object, { steps: [...shown], ...(plan ? { plan } : {}) });
  }
}

const assistantLanguageOf = (cells: readonly { language: string }[]): LanguageId => {
  const last = cells.at(-1)?.language;
  return last && last !== "text" && isLanguageId(last) ? last : DEFAULT_LANGUAGE;
};

function doingText(call: AgentCall): string {
  if (call.tool === "find_notes") return "Looking through your notes…";
  if (call.tool === "read_note") return "Reading another note…";
  if (call.tool === "ask_note") return "Asking another note…";
  if (call.tool === "propose_change") return "Proposing a change…";
  if (call.tool === "list_data") return "Looking in your Data library…";
  if (call.tool === "save_data") return "Saving the file to Data…";
  if (call.tool === "find_datasets") return "Searching for datasets…";
  if (call.tool === "add_cell") return `Writing a ${languageConfig(call.language).label} cell…`;
  if (call.tool === "edit_cell") return `Changing cell ${call.cell}…`;
  if (call.tool === "delete_cell") return `Deleting cell ${call.cell}…`;
  if (call.tool === "write_note" || call.tool === "replace_note") return "Writing in the note…";
  return `Running cell ${call.cell}…`;
}

const secs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`);

/**
 * Code that would pass a failure off as a result (the reported bug: a cell that, missing another
 * cell's variables, drew empty "placeholder" figures so it "never errors"). Such code isn't put in
 * the note; the agent is told why and writes the real thing. Null when the code looks honest.
 */
export function fakeSmell(code: string): string | null {
  if (/\b(placeholder|not computed|dummy (data|values|results)|fake (data|results))\b/i.test(code)) return "it draws or prints placeholders instead of real results";
  if (/except\b[^\n]*:\s*(\n\s*)?pass\b/.test(code) || /except\s*(Exception|BaseException)?\s*(as \w+)?\s*:\s*(\n\s*)?(#[^\n]*\n\s*)?(print\([^)]*\)\s*\n\s*)?\w+\s*=\s*None\b/.test(code))
    return "it catches an error and carries on as if nothing failed";
  if (/\b(globals|locals)\(\)\s*\.get\(|\bin\s+(globals|locals)\(\)|\bNameError\b/.test(code)) return "it checks for variables from other cells, which never exist here (each cell runs alone)";
  return null;
}

/** How many times a request is sent back: replies with no call and no finish, and finishes with work open. */
export const AGENT_CHECKS = { nudges: 3, checks: 3 } as const;

/** Said to the agent when it replied without a tool call and without finish. */
export const NO_CALL_RESULT =
  "You replied without a tool call and without calling finish. If you said you would do something (run, change or add a cell, write in the note), make that call now. If the request is truly finished and every cell you wrote or changed has run cleanly, call finish with your answer.";

/** Said to the agent when it tries to finish with a cell it wrote or changed that hasn't run cleanly with its current code. */
export function unfinishedCells(cells: readonly AgentCell[], undo: AgentUndo): string | null {
  const mine = new Set([...undo.added, ...undo.changed.map((c) => c.id)]);
  const bad = cells.flatMap((c, i) => {
    if (!mine.has(c.id)) return [];
    const r = c.last_run;
    if (!r) return [`cell ${i + 1} hasn't been run`];
    // Its last run was of other code: the cell was changed after it (the reported failure).
    if (r.code_hash && r.code_hash !== codeHash(c.content)) return [`cell ${i + 1} was changed after its last run`];
    if (r.outcome !== "ok") return [`cell ${i + 1}'s last run ${r.outcome === "error" ? "failed" : r.outcome === "timeout" ? "ran out of time" : "was stopped"}`];
    return [];
  });
  return bad.length ? `Not finished: ${bad.join("; ")}. Run and fix ${bad.length === 1 ? "it" : "them"}, or if it can't work here, say so plainly and why.` : null;
}

/**
 * Notices the agent going in circles (the reported loop: a cell that already worked rewritten again
 * and again to "make it show"): a cell set back to code it had earlier in this request, a cell that
 * had run cleanly rewritten a second time, or the same calls giving the same results again.
 */
export function loopGuard() {
  const codes = new Map<number, Set<string>>();
  const lastResult = new Map<number, string>();
  const sameAgain = new Map<number, number>();
  const steps = new Set<string>();
  /** A run's result without its timing, so the same result reads the same. */
  const plain = (r: string) => r.replace(/ in [\d.]+ m?s\./g, ".").replace(/ after [\d.]+ m?s\./g, ".");
  return {
    hits: 0,
    /** Before a step's calls run: a cell set back to code it already had in this request. */
    before(calls: readonly AgentCall[], _cells?: readonly AgentCell[]): string | null {
      for (const c of calls) {
        if (c.tool !== "edit_cell") continue;
        const hash = codeHash(c.code);
        const seen = codes.get(c.cell) ?? new Set<string>();
        if (seen.has(hash)) return `cell ${c.cell} was set back to code it already had earlier in this request`;
        seen.add(hash);
        codes.set(c.cell, seen);
      }
      return null;
    },
    /**
     * After a step: no progress. The same calls gave the same results as an earlier step, or a cell was
     * changed and run again twice and its result came out exactly as before (the reported loop: a working
     * cell rewritten again and again to "make it show"). A sweep that changes the numbers is progress.
     */
    after(calls: readonly AgentCall[], results: readonly string[]): string | null {
      const key = JSON.stringify([calls.map((c) => ("code" in c ? { ...c, code: codeHash(c.code) } : c)), results]);
      if (steps.has(key)) return "the same calls gave the same results again";
      steps.add(key);
      const edited = new Set(calls.flatMap((c) => (c.tool === "edit_cell" ? [c.cell] : [])));
      let why: string | null = null;
      calls.forEach((c, i) => {
        if (c.tool !== "run_cell" || results[i] === undefined) return;
        const now = plain(results[i]!);
        if (edited.has(c.cell) && lastResult.get(c.cell) === now) {
          const n = (sameAgain.get(c.cell) ?? 0) + 1;
          sameAgain.set(c.cell, n);
          if (n >= 2 && !why) why = `cell ${c.cell} was changed and run again twice and its result came out exactly the same`;
        }
        lastResult.set(c.cell, now);
      });
      return why;
    },
  };
}

/** The most cells the seer looks at before the first step (each is one AI request). */
export const SEE_AT_START = 2;

/**
 * Before the first step: the seer looks at the newest runs whose pictures it hasn't described yet
 * (runs of the code the cells have now; at most SEE_AT_START), so the graph says what they show.
 */
async function seeFirst(note: AgentNote, signal: AbortSignal, onLook: () => void): Promise<void> {
  if (!note.see) return;
  const { cells } = await note.read();
  const unseen = cells
    .filter((c) => c.last_run?.outcome === "ok" && c.last_run.code_hash === codeHash(c.content) && toSee(c.last_run.outputs).length > 0)
    .sort((a, b) => (b.last_run!.ran_at > a.last_run!.ran_at ? 1 : -1))
    .slice(0, SEE_AT_START);
  if (unseen.length) onLook();
  for (const c of unseen) if (!signal.aborted) await note.see(c.id, signal);
}

/** Told to the agent the first time it goes in circles. */
export const loopResult = (why: string) =>
  `You may be going in circles: ${why}. Whatever is listed as "shown in the note" is already displayed. Change your approach, or if the request is done, call finish; if you are stuck, call finish and say plainly what is blocking you.`;

/** What the user reads when it went in circles twice: it stopped, what it tried, and a question. */
export function stuckMessage(why: string, steps: readonly AgentDone[]): string {
  const tried = [...new Set(steps.flatMap((s) => s.actions.map((a) => a.text)))].slice(-6);
  return [`I stopped because I was going in circles: ${why}.`, tried.length ? `What I tried: ${tried.join("; ")}.` : "", "What would you like me to do next?"].filter(Boolean).join("\n\n");
}

// ------------------------------------------------------------------ other notes

/**
 * Where a request is between steps: enough to go on from there when the page was left mid-request
 * (the step it reached, what went back and forth, what the user was shown, the plan, the checks used).
 */
export type AgentCheckpoint = { step: number; sent: AgentStep[]; shown: AgentDone[]; checks: number; nudges: number; plan?: AgentPlan; live?: { transcript: LiveMessage[]; language: string; pending: LivePending } };

/** What a step's calls gave, waiting to go with the next live step: results by call id, and notes as text. */
export type LivePending = { results: { id: string; text: string }[]; notes: string[] };

const jsonSize = (v: unknown) => JSON.stringify(v).length;

/**
 * A step's results as the live conversation takes them: each call's result by its id when every
 * call has one (the rest of `results` are notes: problems, checks); otherwise all of it as text.
 */
export function pendingOf(ids: readonly string[] | undefined, calls: number, results: readonly string[]): LivePending {
  const cut = (t: string) => headCut(t, LIVE.maxResultChars);
  if (calls > 0 && ids?.length === calls) return { results: ids.map((id, i) => ({ id, text: cut(results[i] ?? "No result.") })), notes: results.slice(calls).map(cut) };
  if (!results.length) return { results: [], notes: [] };
  return { results: [], notes: [cut(calls ? resultsText(results) : results.join("\n\n"))] };
}

/** The AI requests asking other notes may use in one request, shared by every note asked (however deep). */
export type AskBudget = { left: number };

/**
 * How the loop reaches other notes in one request: their references, the AI it asks with, the budget
 * asking shares, how deep in a chain of asks this note is, and the notes already in that chain.
 */
export type Reach = { others: OtherNotes; refs: Map<string, NoteSummary>; ask: AskStep; budget: AskBudget; depth: number; path: string[]; from: string; self?: { id: string; parent_id: string | null; body: string } };

/**
 * find: notes per find_notes. askSteps: steps one asked note may take. budget: AI requests all asking
 * may use in one request. depth: how far a question may be passed on (the note asked can ask one more).
 */
export const NOTES_REACH = { find: 8, askSteps: 4, budget: 12, depth: 2 } as const;

const OUTCOME_WORDS = { success: "Successful", failed: "Failed" } as const;

/** Said by a note answering another: it may read, never change. */
export const READ_ONLY_NOTE = "This note is read-only here: you are answering a question from another note. Answer from what it holds, and call finish with your answer.";

/** The request a note's own agent gets when another note asks it something. */
export function askNoteRequest(question: string, from: string): string {
  return `The assistant of another note${from.trim() ? ` ("${headCut(from.trim(), 120)}")` : ""} asks about this note: ${question}\nAnswer from this note only: what it found, with its numbers, and how sure the note is (its outcome, whether its cells ran with their current code). Don't change the note or run its cells; call finish with your answer.`;
}

/** Another note as its own agent works on it when asked: everything readable, nothing writable; it may reach further notes when the chain allows. */
function readOnlyNote(saved: SavedNote, others?: OtherNotes): AgentNote {
  const no = async () => {
    throw new Error(READ_ONLY_NOTE);
  };
  return { read: async () => saved, add: no, setCode: no, run: no, remove: no, setBody: no, ...(others ? { others } : {}) };
}

/** A proposed change to another note, as the user sees it with Apply: Markdown added to its text under one of its lines. */
export type NoteProposal = { noteId: string; title: string; after: string; text: string };

/** find_notes, read_note, ask_note and propose_change. */
async function notesCall(call: Extract<AgentCall, { tool: "find_notes" | "read_note" | "ask_note" | "propose_change" }>, reach: Reach | undefined, signal: AbortSignal): Promise<{ result: string; action: AgentAction }> {
  if (!reach) return { result: "Other notes can't be reached from here; answer from this note.", action: { text: "Other notes aren't available here", tone: "fail" } };
  if (call.tool === "find_notes") {
    const found = (await reach.others.find(call.query.trim(), reach.self)).filter((n) => !reach.path.includes(n.id)).slice(0, NOTES_REACH.find);
    const lines = found.map((n) => {
      const ref = [...reach.refs].find(([, v]) => v.id === n.id)?.[0] ?? `N${reach.refs.size + 1}`;
      reach.refs.set(ref, n);
      const bits = [`${ref} · "${headCut(n.title.trim() || "Untitled", 120)}"`, n.outcome ? OUTCOME_WORDS[n.outcome] : "not marked", `edited ${n.updated_at.slice(0, 10)}`];
      if (n.why) bits.push(n.why);
      return bits.join(" · ");
    });
    const about = call.query.trim() ? ` about "${headCut(call.query.trim(), 60)}"` : "";
    if (!lines.length) return { result: `No other notes${about}.`, action: { text: `Looked for notes${about} · none`, tone: "plain" } };
    return { result: `Your other notes${about} (use the N references with read_note, ask_note or propose_change):\n${lines.join("\n")}`, action: { text: `Looked for notes${about} · ${lines.length} found`, tone: "plain", detail: { kind: "text", text: lines.join("\n") } } };
  }
  const target = reach.refs.get(call.note);
  if (!target) return { result: `There is no note ${call.note}: call find_notes first and use a reference it gives.`, action: { text: `No note ${call.note}`, tone: "fail" } };
  const name = `"${headCut(target.title.trim() || "Untitled", 80)}"`;
  const saved = await reach.others.open(target.id);
  if (!saved) return { result: `Note ${call.note} ${name} is gone.`, action: { text: `Note ${name} is gone`, tone: "fail" } };
  if (call.tool === "read_note") {
    const graph = noteGraph(saved.title, saved.body, saved.outcome, saved.cells) || "It is empty.";
    return { result: headCut(`Note ${call.note} ${name}:\n${graph}`, AGENT_LIMITS.maxResultChars), action: { text: `Read note ${name}`, tone: "plain", detail: { kind: "text", text: clip(graph) } } };
  }
  if (call.tool === "propose_change") {
    if (reach.depth > 0) return { result: "Only the note the user is working in can propose changes; say what should change in your answer instead.", action: { text: `Didn't propose a change to ${name}`, tone: "plain" } };
    if (call.after.trim() && !saved.body.split("\n").some((l) => l.trim() === call.after.trim()))
      return { result: `Note ${call.note} has no line "${headCut(call.after.trim(), 80)}": read_note it and copy a line exactly, or leave after empty for the end.`, action: { text: `Couldn't place a change in ${name}`, tone: "fail" } };
    const proposal: NoteProposal = { noteId: target.id, title: target.title.trim() || "Untitled", after: call.after.trim(), text: call.text.trim() };
    return {
      result: `Proposed adding it to note ${call.note} ${name}. Nothing changes there until the user taps Apply; tell them in your answer what you proposed and why.`,
      action: { text: `Proposed a change to ${name}`, tone: "plain", detail: { kind: "proposal", ...proposal } },
    };
  }
  if (reach.path.includes(target.id)) return { result: `Note ${call.note} ${name} is already part of this question; answer with what you have.`, action: { text: `Didn't ask note ${name} again`, tone: "plain" } };
  if (reach.budget.left < 2) return { result: "The AI requests for asking other notes are used up for this request: answer with what you have.", action: { text: `Didn't ask note ${name}`, tone: "plain" } };
  // That note's own agent: the same loop and AI, on that note, read only. It may ask one note further
  // (NOTES_REACH.depth), never one already in this chain; every ask draws on the one budget.
  const counted: AskStep = async (body, sig) => {
    if (reach.budget.left <= 0) throw Object.assign(new Error("The AI requests for asking other notes are used up."), { code: "budget" });
    reach.budget.left--;
    return reach.ask(body, sig);
  };
  const deeper = reach.depth + 1 < NOTES_REACH.depth;
  const final = await runAgent(askNoteRequest(call.question, reach.from), readOnlyNote(saved, deeper ? reach.others : undefined), counted, () => {}, { added: [], changed: [], note: [] }, signal, NO_HISTORY, new Set(), {
    maxSteps: Math.min(NOTES_REACH.askSteps, reach.budget.left),
    reach: { budget: reach.budget, depth: reach.depth + 1, path: [...reach.path, target.id], self: { id: target.id, parent_id: saved.parent_id ?? null, body: saved.body } },
  }).catch((e: unknown) => ({ status: "failed" as const, steps: [] as AgentDone[], message: e instanceof Error ? e.message : "It couldn't answer." }));
  const said = final.status === "done" ? (final.steps.at(-1)?.message ?? "") : "message" in final ? (final.message ?? "") : "";
  const answer = said.trim() || "It couldn't answer.";
  return { result: headCut(`Note ${call.note} ${name} answers: ${answer}`, AGENT_LIMITS.maxResultChars), action: { text: `Asked note ${name}`, tone: final.status === "done" ? "plain" : "fail", detail: { kind: "text", text: clip(answer) } } };
}

/** Makes one call on the note: what goes back to the agent, and the line the user reads. */
export async function makeCall(call: AgentCall, note: AgentNote, undo: AgentUndo, signal: AbortSignal = new AbortController().signal, reach?: Reach): Promise<{ result: string; action: AgentAction }> {
  try {
    if (call.tool === "find_notes" || call.tool === "read_note" || call.tool === "ask_note" || call.tool === "propose_change") return await notesCall(call, reach, signal);
    if (call.tool === "list_data" || call.tool === "save_data" || call.tool === "find_datasets") return await dataCall(call, note.data);
    if (call.tool === "add_cell" || call.tool === "edit_cell") {
      const smell = fakeSmell(call.code);
      if (smell) return { result: `Not put in the note: ${smell}. Write code that does the real work, or say plainly what can't be done.`, action: { text: "Rejected code that would fake a result", tone: "fail" } };
    }
    if (call.tool === "add_cell") {
      const lang = isLanguageId(call.language) ? call.language : DEFAULT_LANGUAGE;
      const id = await note.add(lang, call.code);
      undo.added.push(id);
      const n = (await note.read()).cells.findIndex((c) => c.id === id) + 1;
      return { result: `Added cell ${n} (${languageConfig(lang).label}).`, action: { text: `Added cell ${n} · ${languageConfig(lang).label}`, tone: "plain", cellId: id, detail: { kind: "code", language: lang, code: clip(call.code) } } };
    }
    if (call.tool === "write_note" || call.tool === "replace_note") return await noteCall(call, note, undo);
    const cells = (await note.read()).cells;
    const cell = cells[call.cell - 1];
    if (!cell) return { result: `There is no cell ${call.cell}; the note has ${cells.length} code cell${cells.length === 1 ? "" : "s"}.`, action: { text: `No cell ${call.cell}`, tone: "fail" } };
    if (call.tool === "edit_cell") {
      if (!undo.added.includes(cell.id) && !undo.changed.some((c) => c.id === cell.id)) undo.changed.push({ id: cell.id, code: cell.content });
      await note.setCode(cell.id, call.code);
      return { result: `Changed cell ${call.cell}.`, action: { text: `Changed cell ${call.cell}`, tone: "plain", cellId: cell.id, detail: { kind: "diff", before: clip(cell.content), after: clip(call.code) } } };
    }
    if (call.tool === "delete_cell") {
      if (!undo.added.includes(cell.id)) return { result: `Cell ${call.cell} isn't one you added for this request, so it stays; the user can delete it (Remove on the cell).`, action: { text: `Left cell ${call.cell} in place`, tone: "plain", cellId: cell.id } };
      await note.remove(cell.id);
      undo.added.splice(undo.added.indexOf(cell.id), 1);
      return { result: `Deleted cell ${call.cell}. The cells after it are numbered one lower now.`, action: { text: `Deleted cell ${call.cell}`, tone: "plain" } };
    }
    let where = runPlace(cell, call.where);
    await note.run(cell.id, where);
    let after = (await note.read()).cells.find((c) => c.id === cell.id);
    // A library the device doesn't have: run again on the server by itself, without the model.
    if (where !== "server" && after?.language === "python" && after.last_run?.outcome === "error" && /ModuleNotFoundError|No module named/.test(after.last_run.error_line ?? after.last_run.stderr)) {
      where = "server";
      await note.run(cell.id, where);
      after = (await note.read()).cells.find((c) => c.id === cell.id);
    }
    // The seer looks at what it showed, so the report says what the figure shows, not only that there is one.
    if (after?.last_run?.outcome === "ok" && note.see && toSee(after.last_run.outputs).length) {
      await note.see(cell.id, signal);
      after = (await note.read()).cells.find((c) => c.id === cell.id) ?? after;
    }
    let result = after ? runReport(call.cell, after) : `Cell ${call.cell} is gone from the note.`;
    const run = after?.last_run;
    // A real line break inside a string: models writing code in JSON often turn \n into one. Said precisely.
    if (run?.outcome === "error" && /unterminated (triple-quoted )?string literal|EOL while scanning string literal/.test(run.error_line ?? run.stderr))
      result += "\nHint: a string in the code has a real line break inside it. In the JSON you send, a newline inside a Python string must be written \\\\n (backslash-backslash-n), or use a triple-quoted string or separate strings joined with +.";
    // Opened, a run shows what the agent read back: its output, what it made, its error.
    const detail: ActionDetail = { kind: "output", text: clip(result.split("\n").slice(1).join("\n").trim() || result) };
    if (!run) return { result, action: { text: `Ran cell ${call.cell} · no result`, tone: "fail", cellId: cell.id, detail } };
    const onServer = run.where === "server" || where === "server" ? " on the server" : "";
    if (run.outcome === "ok") return { result, action: { text: `Ran cell ${call.cell}${onServer} · ${secs(run.ms)}`, tone: "ok", cellId: cell.id, detail } };
    const why = run.outcome === "error" ? `failed${run.error_line ? `: ${shortLine(run.error_line)}` : ""}` : run.outcome === "timeout" ? "ran out of time" : "stopped";
    return { result, action: { text: `Ran cell ${call.cell} · ${why}`, tone: "fail", cellId: cell.id, detail } };
  } catch (e) {
    const why = e instanceof Error && e.message ? e.message : "it didn't work";
    return { result: `That call failed: ${why}`, action: { text: `${doingText(call).replace(/…$/, "")} failed`, tone: "fail" } };
  }
}

/** write_note and replace_note: the note's text changed, with what Undo needs to take it back. */
async function noteCall(call: Extract<AgentCall, { tool: "write_note" | "replace_note" }>, note: AgentNote, undo: AgentUndo): Promise<{ result: string; action: AgentAction }> {
  const before = (await note.read()).body;
  if (call.tool === "write_note") {
    const placed = placeNoteText(before, { text: call.text, after: call.after });
    await note.setBody(placed.body);
    undo.note.push({ before, after: placed.body, wrote: call.text.trim() });
    const where = placed.under ? `under “${headCut(placed.under.replace(/[*_#>`]/g, "").trim(), 60)}”` : "at the end";
    return { result: `Wrote it into the note's text ${where}.`, action: { text: `Wrote in the note ${where}`, tone: "plain", detail: { kind: "text", text: clip(call.text.trim()) } } };
  }
  const count = before.split(call.find).length - 1;
  if (count !== 1) return { result: count === 0 ? "That text isn't in the note's text; copy it exactly as the note has it." : `That text is in the note's text ${count} times; give a longer piece that appears once.`, action: { text: "Couldn’t find that text in the note", tone: "fail" } };
  const after = before.replace(call.find, () => call.replace);
  await note.setBody(after);
  undo.note.push({ before, after, wrote: call.replace, replaced: call.find });
  return { result: call.replace ? "Changed that part of the note's text." : "Removed that part of the note's text.", action: { text: call.replace ? "Changed the note’s text" : "Removed text from the note", tone: "plain", detail: { kind: "diff", before: clip(call.find), after: clip(call.replace) } } };
}

/**
 * Puts the note back as it was before the agent: its cells deleted, the cells it changed given their
 * old code, and its changes to the note's text taken back (newest first): the whole text as it was
 * when nothing was typed since, else just what it wrote taken out (or what it replaced put back).
 */
export async function undoAgent(note: AgentNote, undo: AgentUndo): Promise<void> {
  // Each change is dropped from `undo` as soon as it is put back, so an Undo that fails part way
  // (no connection) and is tapped again carries on where it stopped instead of failing for good.
  while (undo.added.length) {
    await note.remove(undo.added.at(-1)!);
    undo.added.pop();
  }
  const ids = new Set((await note.read()).cells.map((c) => c.id));
  while (undo.changed.length) {
    const c = undo.changed[0]!;
    // A cell the user has deleted since: nothing to put back.
    if (ids.has(c.id)) await note.setCode(c.id, c.code);
    undo.changed.shift();
  }
  while (undo.note.length) {
    const e = undo.note.at(-1)!;
    const now = (await note.read()).body;
    if (now === e.after) await note.setBody(e.before);
    else if (e.replaced === undefined) await note.setBody(removeNoteText(now, e.wrote));
    else if (e.wrote && now.split(e.wrote).length === 2) await note.setBody(now.replace(e.wrote, () => e.replaced!));
    else if (!e.wrote && e.replaced && !now.includes(e.replaced) && e.before !== "\u0000") {
      // Text it deleted: put back where it was, after the text that came before it then.
      const at = e.before.indexOf(e.replaced);
      const lead = e.before.slice(Math.max(0, at - 80), at);
      const k = lead ? now.indexOf(lead) : -1;
      if (k >= 0) await note.setBody(now.slice(0, k + lead.length) + e.replaced + now.slice(k + lead.length));
    }
    undo.note.pop();
  }
}

/** A reply cut off at the length limit: what it was saying, marked cut, so the loop has it write less instead of ending. */
export function salvageAgentReply(content: string): AgentReply {
  const prose = salvageAssistantAnswer(content);
  const message = prose && prose.kind === "prose" ? splitLeakedCalls(prose.text.replace(/…?\n\n\*(The answer stopped here|Its code or note text was too long)[^*]*\*$/, "").trim()).message : "";
  return { message, calls: [], done: false, cut: true };
}

/** What the Assistant's history keeps of a finished request: what was done and what the agent said last. */
export function agentSummary(steps: readonly AgentDone[]): string {
  // Each line once: a cell run five times is "Ran cell 2" once, with its last time.
  const byText = new Map<string, string>();
  for (const a of steps.flatMap((s) => s.actions)) {
    const key = a.text.replace(/ · [\d.]+ m?s$/, "");
    byText.delete(key);
    byText.set(key, a.text);
  }
  const actions = [...byText.values()];
  const lastSaid = [...steps].reverse().find((s) => splitSummary(s.message).text)?.message ?? "";
  const last = splitSummary(lastSaid).text;
  return [actions.length ? `${DONE_PREFIX}${actions.join("; ")}.` : "", last].filter(Boolean).join("\n\n") || "Nothing was changed.";
}

const DONE_PREFIX = "Done in the note: ";

/** A kept answer split into what was done in the note (its "Done in the note: …" lines, all of them) and the rest. */
export function splitSummary(text: string): { did: string; text: string } {
  const did: string[] = [];
  const rest = text
    .split(/\n{2,}/)
    .filter((p) => {
      const t = p.trim();
      if (!t.startsWith(DONE_PREFIX.trim())) return true;
      did.push(t.slice(DONE_PREFIX.trim().length).trim().replace(/\.$/, ""));
      return false;
    })
    .join("\n\n")
    .trim();
  return { did: did.join("; "), text: rest };
}
