import type { AppSnapshot, SearchFilters, SessionRecord, SessionSearchHit } from "../shared/types";

const demoSession: SessionRecord = {
  id: "demo-codex-session",
  source: "codex",
  title: "Queue insights status model",
  cwd: "/Users/example/Code/prod-feedback",
  createdAt: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),
  updatedAt: new Date(Date.now() - 1000 * 60 * 24).toISOString(),
  messageCount: 18,
  filePath: "/Users/example/.codex/sessions/demo.jsonl",
  resumeCommand: "codex -C '/Users/example/Code/prod-feedback' resume 'demo-codex-session'",
  preview: {
    firstPrompt: "Review the single-queue insights page and make the status hierarchy clearer.",
    lastPrompt: "Keep the final insight takeaway prominent and leave the trend compact.",
    transcript: [
      { role: "user", text: "Review the single-queue insights page and make the status hierarchy clearer." },
      { role: "assistant", text: "The surface should separate agent supply, runnable work, and blocked work before assigning a health label." },
      { role: "tool", text: "docs/queue-status-model.md updated with queue-intent aware terms." },
      { role: "assistant", text: "Added a compact summary table and kept thresholds out of the universal model." }
    ],
    files: ["docs/queue-status-model.md", "docs/queue-insights-glossary.md"],
    tools: ["rg", "sed", "notion-cli"],
    warnings: []
  },
  indexedText: "queue insights status model agent supply runnable work docs/queue-status-model.md",
  hasParseWarnings: false
};

const demoHit: SessionSearchHit = {
  id: demoSession.id,
  source: demoSession.source,
  title: demoSession.title,
  cwd: demoSession.cwd,
  createdAt: demoSession.createdAt,
  updatedAt: demoSession.updatedAt,
  messageCount: demoSession.messageCount,
  hasParseWarnings: demoSession.hasParseWarnings,
  resumeCommand: demoSession.resumeCommand,
  matchSnippet: "The surface should separate agent supply, runnable work, and blocked work before assigning a health label."
};

const snapshot: AppSnapshot = {
  sessions: [demoHit],
  health: [
    { source: "codex", status: "indexed", sessionCount: 1, pathCount: 1, warningCount: 0, lastScanAt: new Date().toISOString() },
    { source: "claude", status: "missing_path", sessionCount: 0, pathCount: 0, warningCount: 0 },
    { source: "amp", status: "parse_warnings", sessionCount: 2, pathCount: 2, warningCount: 1 },
    { source: "pi", status: "missing_path", sessionCount: 0, pathCount: 0, warningCount: 0 }
  ],
  scannedAt: new Date().toISOString()
};

export function installDevApi(): void {
  if (window.resume) return;
  window.resumeDevPreview = true;
  window.resume = {
    getSnapshot: async () => snapshot,
    refresh: async () => snapshot,
    search: async (query: string, filters: Partial<SearchFilters>) => {
      const sourceSet = new Set(filters.sources ?? ["codex", "claude", "amp", "pi"]);
      if (!sourceSet.has(demoSession.source)) return { results: [], total: 0 };
      if (filters.warningsOnly && !demoSession.hasParseWarnings) return { results: [], total: 0 };
      if (!query.trim()) return { results: [demoHit], total: 1 };
      const haystack = `${demoSession.title} ${demoSession.cwd} ${demoSession.indexedText}`.toLowerCase();
      const matches = haystack.includes(query.toLowerCase());
      return { results: matches ? [demoHit] : [], total: matches ? 1 : 0 };
    },
    getSession: async (id: string) => id === demoSession.id ? demoSession : undefined,
    copyResumeCommand: async (command: string) => navigator.clipboard?.writeText(command),
    choosePath: async () => undefined,
    getPathPreferences: async () => ({ pinned: [] }),
    savePathPreferences: async () => snapshot,
    hideWindow: async () => undefined
  };
}
