import MiniSearch, { type Options } from "minisearch";
import type {
  SearchFilters,
  SearchOptions,
  SearchResponse,
  SessionListItem,
  SessionRecord,
  SessionSearchHit,
  SessionSource
} from "../../shared/types.js";

type SearchDocument = {
  id: string;
  title: string;
  cwd: string;
  indexedText: string;
  source: SessionSource;
};

export class SessionSearch {
  private miniSearch: MiniSearch<SearchDocument>;
  private byId = new Map<string, SessionRecord>();

  constructor(private sessions: SessionRecord[] = []) {
    this.miniSearch = createMiniSearch();
    this.rebuild(sessions);
  }

  rebuild(sessions: SessionRecord[]): void {
    this.sessions = sessions;
    this.byId = new Map(sessions.map((session) => [session.id, session]));
    this.miniSearch = createMiniSearch();
    this.miniSearch.addAll(sessions.map((session) => ({
      id: session.id,
      title: session.title,
      cwd: session.cwd,
      indexedText: session.indexedText,
      source: session.source
    })));
  }

  toJSON(): unknown {
    return this.miniSearch.toJSON();
  }

  load(serialized: unknown, sessions: SessionRecord[]): void {
    this.sessions = sessions;
    this.byId = new Map(sessions.map((session) => [session.id, session]));
    this.miniSearch = MiniSearch.loadJSON(JSON.stringify(serialized), createMiniSearchOptions());
  }

  getSession(id: string): SessionRecord | undefined {
    return this.byId.get(id);
  }

  search(query: string, filters: SearchFilters, options: SearchOptions = {}): SearchResponse {
    const limit = Math.max(0, options.limit ?? 100);
    const offset = Math.max(0, options.offset ?? 0);
    const filtered = this.applyFilters(this.sessions, filters);
    if (!query.trim()) {
      const sorted = [...filtered].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return {
        results: sorted
          .slice(offset, offset + limit)
          .map((session) => toSearchHit(session, {
            matchSnippet: session.preview.lastPrompt ?? session.preview.firstPrompt
          })),
        total: sorted.length
      };
    }

    const allowed = new Set(filtered.map((session) => session.id));
    const results: SessionSearchHit[] = [];
    let total = 0;
    for (const result of this.miniSearch.search(query, {
      prefix: true,
      fuzzy: 0.15,
      boost: { title: 4, cwd: 2 }
    })) {
      if (!allowed.has(result.id)) continue;
      total += 1;
      if (total <= offset) continue;
      if (results.length >= limit) continue;
      const session = this.byId.get(result.id);
      if (!session) continue;
      results.push(toSearchHit(session, {
        score: result.score,
        matchSnippet: snippetFor(session, query)
      }));
    }
    return { results, total };
  }

  private applyFilters(sessions: SessionRecord[], filters: SearchFilters): SessionRecord[] {
    const sourceSet = new Set(filters.sources);
    const cutoff = dateScopeCutoff(filters.dateScope);
    const pathFilter = normalizePathFilter(filters.pathFilter);
    return sessions.filter((session) => {
      if (!sourceSet.has(session.source)) return false;
      if (filters.warningsOnly && !session.hasParseWarnings) return false;
      if (cutoff && new Date(session.updatedAt) < cutoff) return false;
      if (pathFilter && !isPathDescendant(session.cwd, pathFilter)) return false;
      return true;
    });
  }
}

export function toListItem(session: SessionRecord): SessionListItem {
  return {
    id: session.id,
    source: session.source,
    title: session.title,
    cwd: session.cwd,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messageCount: session.messageCount,
    hasParseWarnings: session.hasParseWarnings
  };
}

function toSearchHit(
  session: SessionRecord,
  extra: Pick<SessionSearchHit, "score" | "matchSnippet"> = {}
): SessionSearchHit {
  return {
    ...toListItem(session),
    resumeCommand: session.resumeCommand,
    ...extra
  };
}

function createMiniSearch(): MiniSearch<SearchDocument> {
  return new MiniSearch<SearchDocument>(createMiniSearchOptions());
}

function createMiniSearchOptions(): Options<SearchDocument> {
  return {
    fields: ["title", "cwd", "indexedText"],
    storeFields: ["title", "cwd", "source"],
    searchOptions: {
      prefix: true,
      fuzzy: 0.15
    }
  };
}

function normalizePathFilter(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim().replace(/\/+$/, "");
  return trimmed.length ? trimmed : undefined;
}

function isPathDescendant(candidate: string, base: string): boolean {
  if (!candidate) return false;
  const normalized = candidate.replace(/\/+$/, "");
  return normalized === base || normalized.startsWith(`${base}/`);
}

function dateScopeCutoff(scope: SearchFilters["dateScope"]): Date | undefined {
  if (scope === "all") return undefined;
  const days = scope === "7d" ? 7 : scope === "30d" ? 30 : 90;
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

function snippetFor(session: SessionRecord, query: string): string | undefined {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const candidates = [
    session.title,
    session.cwd,
    session.preview.firstPrompt,
    session.preview.lastPrompt,
    ...session.preview.transcript.map((snippet) => snippet.text),
    ...session.preview.files,
    ...session.preview.tools
  ].filter(Boolean) as string[];
  return candidates.find((candidate) => terms.some((term) => candidate.toLowerCase().includes(term))) ?? candidates[0];
}
