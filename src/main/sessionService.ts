import path from "node:path";
import type {
  AppSnapshot,
  PathPreferences,
  SearchFilters,
  SearchOptions,
  SearchResponse,
  SessionRecord,
  SessionSource,
  SourceHealth,
  SourceRoots,
  SourceSettings
} from "../shared/types.js";
import { adapters, defaultRoots } from "./adapters/index.js";
import type { AdapterScanResult } from "./adapters/common.js";
import { SessionSearch, toListItem } from "./indexer/search.js";
import { AppCache } from "./store/cache.js";

const KNOWN_SOURCES: readonly SessionSource[] = ["codex", "claude", "amp", "pi"];

const DEFAULT_FILTERS: SearchFilters = {
  sources: ["codex", "claude", "amp", "pi"],
  dateScope: "90d",
  warningsOnly: false
};

export class SessionService {
  private snapshot: AppSnapshot = { sessions: [], health: [] };
  private records: SessionRecord[] = [];
  private searchIndex = new SessionSearch();
  private readonly defaults: SourceRoots;
  private readonly constructorOverrides: Partial<SourceRoots>;
  private sourceSettings: Partial<Record<SessionSource, SourceSettings>> = {};

  constructor(private readonly cache: AppCache, roots?: Partial<SourceRoots>) {
    this.defaults = defaultRoots();
    this.constructorOverrides = roots ?? {};
  }

  async initialize(): Promise<AppSnapshot> {
    const prefs = await this.cache.readPathPreferences();
    this.sourceSettings = prefs.sources ?? {};
    this.snapshot = await this.cache.readSnapshot();
    this.records = await this.cache.readSessionRecords();
    if (this.records.length) {
      this.snapshot = {
        sessions: this.records.map(toListItem),
        health: this.snapshot.health,
        scannedAt: this.snapshot.scannedAt
      };
    }
    const serializedIndex = await this.cache.readSearchIndex();
    if (serializedIndex && this.records.length) {
      this.searchIndex.load(serializedIndex, this.records);
    } else {
      this.searchIndex.rebuild(this.records);
    }
    return this.snapshot;
  }

  applySettings(prefs: PathPreferences): void {
    this.sourceSettings = prefs.sources ?? {};
  }

  async refresh(source?: string): Promise<AppSnapshot> {
    const enabledAdapters = adapters.filter((adapter) => this.isEnabled(adapter.source));
    const selected = source
      ? enabledAdapters.filter((adapter) => adapter.source === source)
      : enabledAdapters;
    const scanResults = await Promise.all(
      selected.map((adapter) => adapter.scan(this.rootsFor(adapter.source)))
    );

    const recordsBySource = new Map<SessionSource, SessionRecord[]>();
    for (const session of this.records) {
      if (!recordsBySource.has(session.source)) recordsBySource.set(session.source, []);
      recordsBySource.get(session.source)!.push(session);
    }
    for (const result of scanResults) {
      recordsBySource.set(result.source, result.records);
    }
    // Drop records belonging to sources that are now disabled.
    for (const src of KNOWN_SOURCES) {
      if (!this.isEnabled(src)) recordsBySource.delete(src);
    }

    const sessions = Array.from(recordsBySource.values())
      .flat()
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const health = this.mergeHealth(this.snapshot.health, scanResults);
    this.records = sessions;
    this.snapshot = {
      sessions: sessions.map(toListItem),
      health,
      scannedAt: new Date().toISOString()
    };
    this.searchIndex.rebuild(sessions);
    await this.cache.writeSnapshot(this.snapshot);
    await this.cache.writeSessionRecords(sessions);
    await this.cache.writeSearchIndex(this.searchIndex.toJSON());
    return this.snapshot;
  }

  search(query: string, filters: Partial<SearchFilters> = {}, options?: SearchOptions): SearchResponse {
    return this.searchIndex.search(query, { ...DEFAULT_FILTERS, ...filters }, options);
  }

  getSession(id: string): SessionRecord | undefined {
    return this.searchIndex.getSession(id);
  }

  getSnapshot(): AppSnapshot {
    return this.snapshot;
  }

  private isEnabled(source: SessionSource): boolean {
    return this.sourceSettings[source]?.enabled !== false;
  }

  private rootsFor(source: SessionSource): string[] {
    const override = this.sourceSettings[source]?.roots;
    if (override && override.length) return override;
    const ctorOverride = this.constructorOverrides[source];
    if (ctorOverride && ctorOverride.length) return ctorOverride;
    return this.defaults[source];
  }

  private mergeHealth(existing: SourceHealth[], results: AdapterScanResult[]): SourceHealth[] {
    const bySource = new Map(existing.map((health) => [health.source, health]));
    for (const result of results) {
      bySource.set(result.source, {
        source: result.source,
        status: result.permissionDenied
          ? "needs_permission"
          : result.missingPath
            ? "missing_path"
            : result.warningCount
              ? "parse_warnings"
              : "indexed",
        sessionCount: result.records.length,
        lastScanAt: new Date().toISOString(),
        pathCount: result.pathCount,
        warningCount: result.warningCount,
        message: result.missingPath ? "Default source path is not present" : undefined
      });
    }
    return KNOWN_SOURCES.map((source) => {
      if (!this.isEnabled(source)) {
        const prior = bySource.get(source);
        return {
          source,
          status: "disabled" as const,
          sessionCount: 0,
          pathCount: prior?.pathCount ?? 0,
          warningCount: 0,
          lastScanAt: prior?.lastScanAt,
          message: "Disabled in settings"
        };
      }
      return bySource.get(source) ?? {
        source,
        status: "missing_path" as const,
        sessionCount: 0,
        pathCount: 0,
        warningCount: 0
      };
    });
  }
}

export function createSessionService(userDataPath: string, roots?: Partial<SourceRoots>): SessionService {
  return new SessionService(new AppCache(path.join(userDataPath, "cache")), roots);
}
