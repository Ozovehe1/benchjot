import { describe, expect, it } from "vitest";
import { cleanDataName, datasetsIn, validDataName } from "@/lib/run/datasets-match";

describe("datasetsIn: the library files a cell's code uses", () => {
  const names = ["iris.csv", "data_iris.csv", "train.parquet", "x.npy"];
  it("finds names in quotes and paths", () => {
    expect(datasetsIn(`pd.read_csv("iris.csv")`, names)).toEqual(["iris.csv"]);
    expect(datasetsIn(`pd.read_csv('data/train.parquet')\nnp.load("x.npy")`, names).sort()).toEqual(["train.parquet", "x.npy"]);
    expect(datasetsIn(`open('data_iris.csv')`, names)).toEqual(["data_iris.csv"]);
  });
  it("not a name inside another word", () => {
    expect(datasetsIn(`# my_iris.csv_backup`, names)).toEqual([]);
  });
});

describe("data names", () => {
  it("valid: a plain file name with an extension", () => {
    expect(validDataName("iris.csv")).toBe(true);
    expect(validDataName("My data 2024.xlsx")).toBe(true);
    expect(validDataName("../etc/passwd")).toBe(false);
    expect(validDataName("noext")).toBe(false);
  });
  it("cleaned from a path or odd characters", () => {
    expect(cleanDataName("C:\\Users\\a\\wine quality.csv")).toBe("wine quality.csv");
    expect(cleanDataName("weird#name?.csv")).toBe("weird_name_.csv");
  });
});

describe("savesIn: the names a cell saves to the library", () => {
  it("takes the quoted name, or the quoted file's own name", async () => {
    const { savesIn } = await import("@/lib/run/datasets-match");
    expect(savesIn(`save_data("raw/N87_database.h5")\nsave_data('x.bin', name="clean.csv")`)).toEqual(["N87_database.h5", "clean.csv"]);
  });
  it("skips names it can't know before the run, and invalid ones", async () => {
    const { savesIn } = await import("@/lib/run/datasets-match");
    expect(savesIn(`save_data(path)\nsave_data(f"{m}.h5")\nsave_data("no extension")`)).toEqual([]);
  });
});

describe("notData: save_data refuses pages", () => {
  it("refuses READMEs, HTML and GitHub pages, keeps data and raw files", async () => {
    const { notData } = await import("@/lib/ai/agent");
    expect(notData("https://github.com/x/y/blob/main/README.md")).toBe(true);
    expect(notData("https://github.com/x/y")).toBe(true);
    expect(notData("https://example.org/data.html")).toBe(true);
    expect(notData("https://example.org/f", "magnet_README.md")).toBe(true);
    expect(notData("https://raw.githubusercontent.com/x/y/main/data.csv")).toBe(false);
    expect(notData("https://github.com/x/y/releases/download/v1/data.zip")).toBe(false);
    expect(notData("https://zenodo.org/records/1/files/N87.h5?download=1")).toBe(false);
  });
});

describe("dataHosts: Storage reachable for library downloads and saves", () => {
  it("adds the hosts of BJ_DATA and BJ_SAVE", async () => {
    const { dataHosts } = await import("@/lib/server/modal");
    expect(dataHosts({ BJ_DATA: JSON.stringify([{ name: "a.csv", url: "https://s.example.co/a" }]), BJ_SAVE: JSON.stringify([{ name: "b.csv", url: "https://t.example.co/b" }]) }).sort()).toEqual(["s.example.co", "t.example.co"]);
    expect(dataHosts({ BJ_SAVE: "[]" })).toEqual([]);
  });
});
