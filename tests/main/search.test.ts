import { describe, expect, it } from "vitest";
import { SessionSearch } from "../../src/main/indexer/search";
import type { SearchFilters, SessionRecord } from "../../src/shared/types";

const filters: SearchFilters = {
  sources: ["codex", "claude", "amp", "pi"],
  dateScope: "all",
  warningsOnly: false
};

function record(partial: Partial<SessionRecord>): SessionRecord {
  return {
    id: "one",
    source: "codex",
    title: "Billing flake",
    cwd: "/repo",
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
    messageCount: 2,
    filePath: "/repo/session.jsonl",
    resumeCommand: "codex resume one",
    preview: { transcript: [], files: ["src/billing.ts"], tools: ["rg"], warnings: [], firstPrompt: "Find flakes" },
    indexedText: "Billing flake /repo Find flakes rg src/billing.ts",
    hasParseWarnings: false,
    ...partial
  };
}

describe("SessionSearch", () => {
  it("finds title, cwd, prompt, tool, and file mentions", () => {
    const index = new SessionSearch([record({})]);
    expect(index.search("Billing", filters).results).toHaveLength(1);
    expect(index.search("/repo", filters).results).toHaveLength(1);
    expect(index.search("flakes", filters).results).toHaveLength(1);
    expect(index.search("rg", filters).results).toHaveLength(1);
    expect(index.search("billing.ts", filters).results).toHaveLength(1);
  });

  it("filters by path and matches descendants", () => {
    const index = new SessionSearch([
      record({ id: "a", cwd: "/Users/me/Code/repo-a", indexedText: "alpha" }),
      record({ id: "b", cwd: "/Users/me/Code/repo-b", indexedText: "beta" }),
      record({ id: "nested", cwd: "/Users/me/Code/repo-a/packages/x", indexedText: "nested" })
    ]);
    expect(index.search("", { ...filters, pathFilter: "/Users/me/Code/repo-a" }).results.map((s) => s.id).sort())
      .toEqual(["a", "nested"]);
    expect(index.search("", { ...filters, pathFilter: "/Users/me/Code" }).results.map((s) => s.id).sort())
      .toEqual(["a", "b", "nested"]);
    expect(index.search("", { ...filters, pathFilter: "/Users/me/Code/repo-a/" }).results.map((s) => s.id).sort())
      .toEqual(["a", "nested"]);
    expect(index.search("", { ...filters, pathFilter: "/nope" }).results).toHaveLength(0);
  });

  it("filters by source and parse warnings", () => {
    const index = new SessionSearch([
      record({ id: "one", source: "codex" }),
      record({ id: "two", source: "pi", title: "Tree", indexedText: "Tree", hasParseWarnings: true })
    ]);
    expect(index.search("", { ...filters, sources: ["pi"] }).results.map((item) => item.id)).toEqual(["two"]);
    expect(index.search("", { ...filters, warningsOnly: true }).results.map((item) => item.id)).toEqual(["two"]);
  });

  it("limits results by default while returning the full total", () => {
    const records = Array.from({ length: 120 }, (_, index) => record({
      id: `session-${index}`,
      title: `Queue run ${index}`,
      indexedText: `queue run ${index}`,
      updatedAt: `2026-05-${String((index % 28) + 1).padStart(2, "0")}T00:00:00.000Z`
    }));
    const index = new SessionSearch(records);
    const response = index.search("queue", filters);
    expect(response.results).toHaveLength(100);
    expect(response.total).toBe(120);
    expect(response.results[0]).not.toHaveProperty("indexedText");
    expect(response.results[0]).not.toHaveProperty("preview");
  });

  it("returns a full record by id", () => {
    const full = record({ id: "lookup" });
    const index = new SessionSearch([full]);
    expect(index.getSession("lookup")).toEqual(full);
    expect(index.getSession("missing")).toBeUndefined();
  });
});
