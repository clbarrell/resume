export type SessionSource = "codex" | "claude" | "amp" | "pi";

export type SourceHealthStatus = "indexed" | "missing_path" | "parse_warnings" | "needs_permission" | "disabled";

export interface SessionRecord {
  id: string;
  source: SessionSource;
  title: string;
  cwd: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  filePath: string;
  resumeCommand: string;
  preview: SessionPreview;
  indexedText: string;
  hasParseWarnings: boolean;
}

export type SessionListItem = Pick<
  SessionRecord,
  "id" | "source" | "title" | "cwd" | "createdAt" | "updatedAt" | "messageCount" | "hasParseWarnings"
>;

export interface SessionPreview {
  firstPrompt?: string;
  lastPrompt?: string;
  transcript: PreviewSnippet[];
  files: string[];
  tools: string[];
  warnings: string[];
}

export interface PreviewSnippet {
  role: "user" | "assistant" | "system" | "tool";
  text: string;
  at?: string;
}

export interface SourceHealth {
  source: SessionSource;
  status: SourceHealthStatus;
  sessionCount: number;
  lastScanAt?: string;
  pathCount: number;
  warningCount: number;
  message?: string;
}

export interface SearchFilters {
  sources: SessionSource[];
  dateScope: "90d" | "30d" | "7d" | "all";
  warningsOnly: boolean;
  pathFilter?: string;
}

export interface SourceSettings {
  enabled: boolean;
  roots?: string[];
}

export interface PathPreferences {
  pinned: string[];
  sources?: Partial<Record<SessionSource, SourceSettings>>;
}

export interface SessionSearchHit extends SessionListItem {
  resumeCommand: string;
  score?: number;
  matchSnippet?: string;
}

export type SearchResult = SessionSearchHit;

export interface SearchOptions {
  limit?: number;
  offset?: number;
}

export interface SearchResponse {
  results: SessionSearchHit[];
  total: number;
}

export interface AppSnapshot {
  sessions: SessionListItem[];
  health: SourceHealth[];
  scannedAt?: string;
}

export interface SourceRoots {
  codex: string[];
  claude: string[];
  amp: string[];
  pi: string[];
}
