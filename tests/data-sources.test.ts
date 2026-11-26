// Find datasets' platforms (lib/server/data-sources.ts), with each platform's answer as it really
// looks (shapes checked live 2026-11-26), so the adapters are tested without the network.
import { describe, expect, it } from "vitest";
import { DATA_FILE, filesOf, searchAll, titleMatches } from "@/lib/server/data-sources";

const ANSWERS: [RegExp, unknown][] = [
  [/huggingface\.co\/api\/datasets\?search/, [{ id: "scikit-learn/iris", downloads: 13000, likes: 13 }, { id: "Hebrish/Irish-English-Sentences", downloads: 38000, likes: 1 }]],
  [/huggingface\.co\/api\/datasets\/scikit-learn\/iris\/tree/, [{ type: "file", path: "Iris.csv", size: 5107 }, { type: "file", path: "README.md", size: 900 }, { type: "directory", path: "data" }]],
  [/zenodo\.org\/api\/records\?q/, { hits: { hits: [{ id: 7, metadata: { title: "Iris <b>flowers</b>", publication_date: "2023-02-03" }, stats: { downloads: 107 }, links: { self_html: "https://zenodo.org/records/7" } }, { id: 8, metadata: { title: "Water quality" } }] } }],
  [/zenodo\.org\/api\/records\/7$/, { files: [{ key: "iris.csv", size: 4551, links: { self: "https://zenodo.org/api/records/7/files/iris.csv/content" } }, { key: "paper.pdf", size: 9, links: { self: "https://x/p" } }] }],
  [/openml\.org\/api\/v1\/json\/data\/list\/data_name\/iris\//, { data: { dataset: [{ did: 61, name: "iris", version: 1, quality: [{ name: "NumberOfInstances", value: "150.0" }, { name: "NumberOfFeatures", value: "5.0" }] }] } }],
  [/openml\.org\/api\/v1\/json\/data\/61$/, { data_set_description: { name: "iris", file_id: "61" } }],
  [/dataverse\.harvard\.edu\/api\/search/, { data: { items: [{ name: "Human Iris Color Data", global_id: "doi:10.7910/DVN/ABC", url: "https://doi.org/10.7910/DVN/ABC", published_at: "2021-02-05T00:00:00Z", fileCount: 1 }] } }],
  [/dataverse\.harvard\.edu\/api\/datasets/, { data: [{ restricted: false, dataFile: { id: 5, filename: "iris.tab", filesize: 900, originalFileName: "iris.csv", originalFileSize: 4000 } }, { restricted: true, dataFile: { id: 6, filename: "secret.csv" } }] }],
];
const get = async (url: string, init?: RequestInit) => {
  if (/figshare/.test(url)) throw new Error("figshare 503"); // a platform that's down
  if (init?.method === "POST") throw new Error("unexpected POST");
  const hit = ANSWERS.find(([re]) => re.test(url));
  if (!hit) throw new Error(`no answer for ${url}`);
  return hit[1];
};

describe("Find datasets across platforms", () => {
  it("keeps only titles with the words, interleaves the platforms, and names the one that didn't answer", async () => {
    const { results, missed } = await searchAll(get, "iris");
    expect(missed).toEqual(["figshare"]);
    expect(results.map((r) => `${r.source}:${r.id}`)).toEqual(["hf:scikit-learn/iris", "zenodo:7", "openml:61", "dataverse:doi:10.7910/DVN/ABC"]);
    expect(results[1]!.title).toBe("Iris flowers"); // markup removed
    expect(results[2]).toMatchObject({ title: "iris (version 1)", detail: "150 rows · 5 columns", page: "https://www.openml.org/d/61" });
  });
  it("lists only data files, with a public address each", async () => {
    expect(await filesOf(get, "hf", "scikit-learn/iris")).toEqual([{ name: "Iris.csv", size: 5107, url: "https://huggingface.co/datasets/scikit-learn/iris/resolve/main/Iris.csv" }]);
    expect(await filesOf(get, "zenodo", "7")).toEqual([{ name: "iris.csv", size: 4551, url: "https://zenodo.org/api/records/7/files/iris.csv/content" }]);
    expect(await filesOf(get, "openml", "61")).toEqual([{ name: "iris.csv", size: 0, url: "https://www.openml.org/data/get_csv/61/iris.csv" }]);
    expect(await filesOf(get, "dataverse", "doi:10.7910/DVN/ABC")).toEqual([{ name: "iris.csv", size: 4000, url: "https://dataverse.harvard.edu/api/access/datafile/5?format=original" }]); // restricted left out
  });
  it("refuses ids that aren't the platform's shape, before asking it", async () => {
    expect(await filesOf(get, "hf", "../../etc")).toEqual([]);
    expect(await filesOf(get, "zenodo", "7; drop")).toEqual([]);
    expect(await filesOf(get, "dataverse", "https://evil")).toEqual([]);
  });
  it("matches whole words, plurals too", () => {
    expect(titleMatches("Iris flowers", "iris")).toBe(true);
    expect(titleMatches("scikit-learn/iris", "iris")).toBe(true);
    expect(titleMatches("Irish-English-Sentences", "iris")).toBe(false);
    expect(titleMatches("Titanic passengers", "titanic passenger")).toBe(true);
    expect(titleMatches("Air quality, Lecce", "air quality")).toBe(true);
    expect(DATA_FILE.test("paper.pdf")).toBe(false);
  });
});
