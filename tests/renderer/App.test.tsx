import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/renderer/App";
import type { AppSnapshot, SearchResponse, SessionRecord, SessionSearchHit } from "../../src/shared/types";

const session: SessionRecord = {
  id: "session-1",
  source: "codex",
  title: "Billing flake",
  cwd: "/Users/example/Code/demo",
  createdAt: "2026-05-10T10:00:00.000Z",
  updatedAt: new Date().toISOString(),
  messageCount: 4,
  filePath: "/tmp/session.jsonl",
  resumeCommand: "codex -C '/demo' resume 'session-1'",
  preview: {
    firstPrompt: "Find the flaky billing test",
    lastPrompt: "Add the regression test",
    transcript: [{ role: "user", text: "Find the flaky billing test" }],
    files: ["src/billing.ts"],
    tools: ["rg"],
    warnings: []
  },
  indexedText: "Billing flake Find the flaky billing test",
  hasParseWarnings: false
};

const result: SessionSearchHit = {
  id: session.id,
  source: session.source,
  title: session.title,
  cwd: session.cwd,
  createdAt: session.createdAt,
  updatedAt: session.updatedAt,
  messageCount: session.messageCount,
  hasParseWarnings: session.hasParseWarnings,
  resumeCommand: session.resumeCommand,
  matchSnippet: "Find the flaky billing test"
};

const snapshot: AppSnapshot = {
  sessions: [result],
  health: [
    { source: "codex", status: "indexed", sessionCount: 1, pathCount: 1, warningCount: 0 },
    { source: "claude", status: "missing_path", sessionCount: 0, pathCount: 0, warningCount: 0 },
    { source: "amp", status: "missing_path", sessionCount: 0, pathCount: 0, warningCount: 0 },
    { source: "pi", status: "missing_path", sessionCount: 0, pathCount: 0, warningCount: 0 }
  ],
  scannedAt: new Date().toISOString()
};

describe("App", () => {
  beforeEach(() => {
    window.resume = {
      getSnapshot: vi.fn().mockResolvedValue(snapshot),
      refresh: vi.fn().mockResolvedValue(snapshot),
      search: vi.fn().mockResolvedValue({ results: [result], total: 1 } satisfies SearchResponse),
      getSession: vi.fn().mockResolvedValue(session),
      copyResumeCommand: vi.fn().mockResolvedValue(undefined),
      choosePath: vi.fn().mockResolvedValue(undefined),
      getPathPreferences: vi.fn().mockResolvedValue({ pinned: [] }),
      savePathPreferences: vi.fn().mockResolvedValue(undefined),
      hideWindow: vi.fn().mockResolvedValue(undefined)
    };
  });

  it("renders source filters, results, preview, and copies command", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getAllByText("Billing flake").length).toBeGreaterThan(0));
    expect(screen.getAllByText("Find the flaky billing test").length).toBeGreaterThan(0);
    fireEvent.click(await screen.findByTitle(/copy resume command/i));
    await waitFor(() => expect(window.resume.copyResumeCommand).toHaveBeenCalledWith("codex -C '/demo' resume 'session-1'"));
  });

  it("focuses search with Cmd+K and updates query", async () => {
    render(<App />);
    const search = await screen.findByLabelText("Search sessions");
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(document.activeElement).toBe(search);
    fireEvent.change(search, { target: { value: "billing" } });
    await waitFor(() => expect(window.resume.search).toHaveBeenCalledWith("billing", expect.any(Object)));
  });

  it("shows a loading state while the initial refresh is running", async () => {
    let resolveRefresh: (value: AppSnapshot) => void = () => undefined;
    const refreshPromise = new Promise<AppSnapshot>((resolve) => {
      resolveRefresh = resolve;
    });
    window.resume = {
      getSnapshot: vi.fn().mockResolvedValue({ sessions: [], health: [] }),
      refresh: vi.fn().mockReturnValue(refreshPromise),
      search: vi.fn().mockResolvedValue({ results: [], total: 0 }),
      getSession: vi.fn().mockResolvedValue(undefined),
      copyResumeCommand: vi.fn().mockResolvedValue(undefined),
      choosePath: vi.fn().mockResolvedValue(undefined),
      getPathPreferences: vi.fn().mockResolvedValue({ pinned: [] }),
      savePathPreferences: vi.fn().mockResolvedValue(undefined),
      hideWindow: vi.fn().mockResolvedValue(undefined)
    };

    render(<App />);

    expect(await screen.findByRole("status")).toHaveTextContent("Refreshing all sources");
    expect(screen.getByText("Refreshing sessions")).toBeInTheDocument();

    resolveRefresh(snapshot);
    await waitFor(() => expect(screen.queryByText("Refreshing sessions")).not.toBeInTheDocument());
  });

  it("shows limited result counts", async () => {
    window.resume.search = vi.fn().mockResolvedValue({ results: [result], total: 603 });
    render(<App />);
    expect(await screen.findByText("1 of 603 sessions")).toBeInTheDocument();
  });

  it("ignores stale search responses", async () => {
    let resolveSlow: (value: SearchResponse) => void = () => undefined;
    const slow = new Promise<SearchResponse>((resolve) => {
      resolveSlow = resolve;
    });
    const freshHit: SessionSearchHit = { ...result, id: "fresh", title: "Fresh result" };
    window.resume.search = vi
      .fn()
      .mockResolvedValueOnce({ results: [result], total: 1 })
      .mockReturnValueOnce(slow)
      .mockResolvedValueOnce({ results: [freshHit], total: 1 });
    window.resume.getSession = vi.fn().mockImplementation((id: string) =>
      Promise.resolve(id === "fresh" ? { ...session, id: "fresh", title: "Fresh result" } : session)
    );

    render(<App />);
    const search = await screen.findByLabelText("Search sessions");
    await waitFor(() => expect(window.resume.search).toHaveBeenCalledTimes(1));
    fireEvent.change(search, { target: { value: "slow" } });
    await new Promise((resolve) => window.setTimeout(resolve, 100));
    fireEvent.change(search, { target: { value: "fresh" } });

    await waitFor(() => expect(screen.getAllByText("Fresh result").length).toBeGreaterThan(0));
    resolveSlow({ results: [{ ...result, id: "slow", title: "Slow result" }], total: 1 });
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(screen.queryByText("Slow result")).not.toBeInTheDocument();
  });
});
