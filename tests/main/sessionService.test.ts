import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionService } from "../../src/main/sessionService";
import { AppCache } from "../../src/main/store/cache";

const fixtures = path.join(process.cwd(), "tests", "fixtures");

describe("SessionService settings", () => {
  let dir: string;
  let cache: AppCache;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "resume-"));
    cache = new AppCache(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("uses fixture roots when set in preferences and skips disabled sources", async () => {
    await cache.writePathPreferences({
      pinned: [],
      sources: {
        codex: { enabled: true, roots: [path.join(fixtures, "codex")] },
        claude: { enabled: true, roots: [path.join(fixtures, "claude")] },
        amp: { enabled: false },
        pi: { enabled: false }
      }
    });

    const service = new SessionService(cache);
    await service.initialize();
    const snapshot = await service.refresh();

    const bySource = new Map(snapshot.health.map((h) => [h.source, h]));
    expect(bySource.get("codex")?.status).toBe("parse_warnings");
    expect(bySource.get("claude")?.status).toBe("indexed");
    expect(bySource.get("amp")?.status).toBe("disabled");
    expect(bySource.get("pi")?.status).toBe("disabled");
    expect(snapshot.sessions.every((s) => s.source === "codex" || s.source === "claude")).toBe(true);
  });

  it("drops records for a source after it is disabled via applySettings", async () => {
    await cache.writePathPreferences({
      pinned: [],
      sources: {
        codex: { enabled: true, roots: [path.join(fixtures, "codex")] },
        claude: { enabled: true, roots: [path.join(fixtures, "claude")] }
      }
    });
    const service = new SessionService(cache);
    await service.initialize();
    let snapshot = await service.refresh();
    expect(snapshot.sessions.some((s) => s.source === "codex")).toBe(true);

    service.applySettings({
      pinned: [],
      sources: {
        codex: { enabled: false },
        claude: { enabled: true, roots: [path.join(fixtures, "claude")] }
      }
    });
    snapshot = await service.refresh();
    expect(snapshot.sessions.some((s) => s.source === "codex")).toBe(false);
    expect(snapshot.health.find((h) => h.source === "codex")?.status).toBe("disabled");
  });
});

describe("AppCache path preferences", () => {
  let dir: string;
  let cache: AppCache;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "resume-cache-"));
    cache = new AppCache(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("round-trips the extended preferences shape", async () => {
    await cache.writePathPreferences({
      pinned: ["/foo"],
      sources: {
        codex: { enabled: false },
        claude: { enabled: true, roots: ["/custom/claude"] }
      }
    });
    const read = await cache.readPathPreferences();
    expect(read.pinned).toEqual(["/foo"]);
    expect(read.sources?.codex).toEqual({ enabled: false });
    expect(read.sources?.claude).toEqual({ enabled: true, roots: ["/custom/claude"] });
  });

  it("returns no sources for legacy files with only pinned", async () => {
    await cache.writePathPreferences({ pinned: ["/legacy"] } as unknown as Parameters<typeof cache.writePathPreferences>[0]);
    const read = await cache.readPathPreferences();
    expect(read.pinned).toEqual(["/legacy"]);
    expect(read.sources).toBeUndefined();
  });
});
