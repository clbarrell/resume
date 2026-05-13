import { promises as fs } from "node:fs";
import path from "node:path";
import type { AppSnapshot, PathPreferences, SessionRecord, SessionSource, SourceSettings } from "../../shared/types.js";

const EMPTY_SNAPSHOT: AppSnapshot = { sessions: [], health: [] };
const EMPTY_PATH_PREFS: PathPreferences = { pinned: [] };

export class AppCache {
  constructor(private readonly cacheDir: string) {}

  get snapshotPath(): string {
    return path.join(this.cacheDir, "snapshot.json");
  }

  get sessionRecordsPath(): string {
    return path.join(this.cacheDir, "session-records.json");
  }

  get searchIndexPath(): string {
    return path.join(this.cacheDir, "search-index.json");
  }

  async readSnapshot(): Promise<AppSnapshot> {
    try {
      const content = await fs.readFile(this.snapshotPath, "utf8");
      return JSON.parse(content) as AppSnapshot;
    } catch {
      return EMPTY_SNAPSHOT;
    }
  }

  async readSessionRecords(): Promise<SessionRecord[]> {
    try {
      return JSON.parse(await fs.readFile(this.sessionRecordsPath, "utf8")) as SessionRecord[];
    } catch {
      try {
        const legacy = JSON.parse(await fs.readFile(this.snapshotPath, "utf8")) as { sessions?: unknown };
        return Array.isArray(legacy.sessions) && legacy.sessions.every(isSessionRecord)
          ? legacy.sessions
          : [];
      } catch {
        return [];
      }
    }
  }

  async writeSnapshot(snapshot: AppSnapshot): Promise<void> {
    await fs.mkdir(this.cacheDir, { recursive: true });
    await fs.writeFile(this.snapshotPath, JSON.stringify(snapshot), "utf8");
  }

  async writeSessionRecords(records: SessionRecord[]): Promise<void> {
    await fs.mkdir(this.cacheDir, { recursive: true });
    await fs.writeFile(this.sessionRecordsPath, JSON.stringify(records), "utf8");
  }

  async readSearchIndex(): Promise<unknown | undefined> {
    try {
      return JSON.parse(await fs.readFile(this.searchIndexPath, "utf8")) as unknown;
    } catch {
      return undefined;
    }
  }

  async writeSearchIndex(index: unknown): Promise<void> {
    await fs.mkdir(this.cacheDir, { recursive: true });
    await fs.writeFile(this.searchIndexPath, JSON.stringify(index), "utf8");
  }

  get pathPreferencesPath(): string {
    return path.join(this.cacheDir, "path-preferences.json");
  }

  async readPathPreferences(): Promise<PathPreferences> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.pathPreferencesPath, "utf8")) as PathPreferences;
      return {
        pinned: Array.isArray(parsed.pinned) ? parsed.pinned.filter((p): p is string => typeof p === "string") : [],
        sources: coerceSourceSettings(parsed.sources)
      };
    } catch {
      return EMPTY_PATH_PREFS;
    }
  }

  async writePathPreferences(prefs: PathPreferences): Promise<void> {
    await fs.mkdir(this.cacheDir, { recursive: true });
    await fs.writeFile(this.pathPreferencesPath, JSON.stringify(prefs), "utf8");
  }
}

const KNOWN_SOURCES: readonly SessionSource[] = ["codex", "claude", "amp", "pi"];

function coerceSourceSettings(raw: unknown): Partial<Record<SessionSource, SourceSettings>> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const result: Partial<Record<SessionSource, SourceSettings>> = {};
  for (const source of KNOWN_SOURCES) {
    const entry = (raw as Record<string, unknown>)[source];
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as { enabled?: unknown; roots?: unknown };
    const enabled = candidate.enabled !== false;
    const roots = Array.isArray(candidate.roots)
      ? candidate.roots.filter((r): r is string => typeof r === "string" && r.trim().length > 0)
      : undefined;
    result[source] = { enabled, ...(roots && roots.length ? { roots } : {}) };
  }
  return Object.keys(result).length ? result : undefined;
}

function isSessionRecord(value: unknown): value is SessionRecord {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SessionRecord>;
  return typeof candidate.id === "string"
    && typeof candidate.resumeCommand === "string"
    && typeof candidate.indexedText === "string"
    && typeof candidate.preview === "object";
}
