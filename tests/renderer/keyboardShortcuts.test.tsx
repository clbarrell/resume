import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/renderer/App";
import type { AppSnapshot, SearchResponse, SessionRecord, SessionSearchHit } from "../../src/shared/types";

const sessionA: SessionRecord = {
  id: "session-a",
  source: "codex",
  title: "Alpha session",
  cwd: "/Users/example/Code/alpha",
  createdAt: "2026-05-09T10:00:00.000Z",
  updatedAt: new Date().toISOString(),
  messageCount: 6,
  filePath: "/tmp/a.jsonl",
  resumeCommand: "codex -C '/alpha' resume 'session-a'",
  preview: {
    firstPrompt: "Start alpha",
    transcript: [{ role: "user", text: "Start alpha" }],
    files: [],
    tools: [],
    warnings: []
  },
  indexedText: "Alpha session",
  hasParseWarnings: false
};

const sessionB: SessionRecord = {
  ...sessionA,
  id: "session-b",
  title: "Beta session",
  cwd: "/Users/example/Code/beta",
  resumeCommand: "codex -C '/beta' resume 'session-b'",
  indexedText: "Beta session"
};

function asHit(record: SessionRecord): SessionSearchHit {
  return {
    id: record.id,
    source: record.source,
    title: record.title,
    cwd: record.cwd,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    messageCount: record.messageCount,
    hasParseWarnings: record.hasParseWarnings,
    resumeCommand: record.resumeCommand
  };
}

const hitA = asHit(sessionA);
const hitB = asHit(sessionB);

const snapshot: AppSnapshot = {
  sessions: [hitA, hitB],
  health: [
    { source: "codex", status: "indexed", sessionCount: 2, pathCount: 2, warningCount: 0 },
    { source: "claude", status: "missing_path", sessionCount: 0, pathCount: 0, warningCount: 0 },
    { source: "amp", status: "missing_path", sessionCount: 0, pathCount: 0, warningCount: 0 },
    { source: "pi", status: "missing_path", sessionCount: 0, pathCount: 0, warningCount: 0 }
  ],
  scannedAt: new Date().toISOString()
};

describe("keyboard shortcuts", () => {
  beforeEach(() => {
    window.resume = {
      getSnapshot: vi.fn().mockResolvedValue(snapshot),
      refresh: vi.fn().mockResolvedValue(snapshot),
      search: vi.fn().mockImplementation(async (_q: string, filters: { sources?: string[] }) => {
        const sources = filters.sources ?? ["codex", "claude", "amp", "pi"];
        const results = sources.includes("codex") ? [hitA, hitB] : [];
        return { results, total: results.length } satisfies SearchResponse;
      }),
      getSession: vi.fn().mockImplementation((id: string) =>
        Promise.resolve(id === sessionA.id ? sessionA : sessionB)
      ),
      copyResumeCommand: vi.fn().mockResolvedValue(undefined),
      choosePath: vi.fn().mockResolvedValue(undefined),
      getPathPreferences: vi.fn().mockResolvedValue({ pinned: [] }),
      savePathPreferences: vi.fn().mockResolvedValue(undefined),
      hideWindow: vi.fn().mockResolvedValue(undefined)
    };
  });

  it("Cmd+K focuses search input", async () => {
    render(<App />);
    const search = await screen.findByLabelText("Search sessions");
    (document.body as HTMLElement).focus();
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(document.activeElement).toBe(search);
  });

  it("Escape clears query, then path filter, then hides window", async () => {
    render(<App />);
    const search = await screen.findByLabelText("Search sessions") as HTMLInputElement;
    search.focus();
    fireEvent.change(search, { target: { value: "alpha" } });
    await waitFor(() => expect(search.value).toBe("alpha"));

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect((screen.getByLabelText("Search sessions") as HTMLInputElement).value).toBe(""));
    expect(window.resume.hideWindow).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(window.resume.hideWindow).toHaveBeenCalled());
  });

  it("Cmd+1 toggles Codex source off then on", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getAllByText("Alpha session").length).toBeGreaterThan(0));
    const searchMock = window.resume.search as ReturnType<typeof vi.fn>;
    searchMock.mockClear();

    fireEvent.keyDown(window, { key: "1", metaKey: true });
    await waitFor(() => {
      const lastCall = searchMock.mock.calls.at(-1);
      expect(lastCall?.[1].sources).toEqual(expect.not.arrayContaining(["codex"]));
    });

    fireEvent.keyDown(window, { key: "1", metaKey: true });
    await waitFor(() => {
      const lastCall = searchMock.mock.calls.at(-1);
      expect(lastCall?.[1].sources).toEqual(expect.arrayContaining(["codex"]));
    });
  });

  it("? opens the help overlay and Escape closes it", async () => {
    render(<App />);
    await screen.findByLabelText("Search sessions");
    fireEvent.keyDown(window, { key: "?" });
    expect(await screen.findByRole("dialog", { name: /keyboard shortcuts/i })).toBeInTheDocument();
    const dialog = screen.getByRole("dialog");
    act(() => {
      fireEvent.keyDown(dialog, { key: "Escape" });
    });
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /keyboard shortcuts/i })).not.toBeInTheDocument()
    );
  });

  it("Cmd+D cycles date scope", async () => {
    render(<App />);
    await screen.findByLabelText("Search sessions");
    const searchMock = window.resume.search as ReturnType<typeof vi.fn>;
    searchMock.mockClear();
    fireEvent.keyDown(window, { key: "d", metaKey: true });
    await waitFor(() => {
      const lastCall = searchMock.mock.calls.at(-1);
      expect(lastCall?.[1].dateScope).toBe("30d");
    });
  });
});
