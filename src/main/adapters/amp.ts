import { Adapter, AdapterScanResult, ampResume, buildIndexedText, buildPreview, fileMtimeIso, getArray, getDates, getIsoDate, getObject, getString, listFiles, pathExists, readJson, readJsonl, stableId, textFromUnknown } from "./common.js";
import type { ParsedEntry } from "./common.js";
import type { SessionRecord } from "../../shared/types.js";

export const ampAdapter: Adapter = {
  source: "amp",
  async scan(roots = []): Promise<AdapterScanResult> {
    const statuses = await Promise.all(roots.map(pathExists));
    const files = (await Promise.all(roots.map((root) => listFiles(root, [".json", ".jsonl"])))).flat();
    const records: SessionRecord[] = [];
    let warningCount = 0;

    for (const filePath of files) {
      const { objects, warnings } = filePath.endsWith(".jsonl")
        ? await readJsonl(filePath)
        : normalizeJson(await readJson(filePath));
      const entries = objects.map(parseAmpEntry).filter((entry) => entry.text || entry.tool || entry.files?.length);
      const meta = getAmpMeta(objects);
      const fileDate = await fileMtimeIso(filePath);
      const dates = getDates(entries, fileDate);
      const id = stableId("amp", filePath, meta.id);
      const cwd = meta.cwd ?? "";
      const title = meta.title ?? entries.find((entry) => entry.role === "user" && entry.text)?.text?.slice(0, 80) ?? "Untitled Amp thread";
      warningCount += warnings.length;
      records.push({
        id,
        source: "amp",
        title,
        cwd,
        createdAt: dates.createdAt,
        updatedAt: dates.updatedAt,
        messageCount: entries.filter((entry) => entry.role === "user" || entry.role === "assistant").length,
        filePath,
        resumeCommand: ampResume(cwd, id),
        preview: buildPreview(entries, warnings),
        indexedText: buildIndexedText([title, cwd, id, filePath], entries),
        hasParseWarnings: warnings.length > 0
      });
    }

    return {
      source: "amp",
      records,
      warningCount,
      pathCount: files.length,
      missingPath: statuses.every((status) => status === "missing"),
      permissionDenied: statuses.some((status) => status === "permission")
    };
  }
};

function normalizeJson(result: Awaited<ReturnType<typeof readJson>>): { objects: unknown[]; warnings: string[] } {
  const object = getObject(result.object);
  if (!object) return { objects: [], warnings: result.warnings };
  const messages = getArray(object.messages).length ? getArray(object.messages) : getArray(object.entries);
  return { objects: [object, ...messages], warnings: result.warnings };
}

function parseAmpEntry(value: unknown): ParsedEntry {
  const object = getObject(value);
  if (!object) return {};
  const role = getString(object.role) ?? getString(object.type);
  const tool = getString(object.tool) ?? getString(object.toolName) ?? getString(object.name);
  return {
    role: tool ? "tool" : role,
    text: textFromUnknown(object.content ?? object.text ?? object.message ?? object.summary),
    tool,
    files: getArray(object.files).map((item) => getString(item)).filter(Boolean) as string[],
    createdAt: getIsoDate(object.createdAt) ?? getIsoDate(object.created_at) ?? getIsoDate(object.timestamp) ?? getIsoDate(object.created)
  };
}

function getAmpMeta(objects: unknown[]): { id?: string; title?: string; cwd?: string } {
  const meta: ReturnType<typeof getAmpMeta> = {};
  for (const value of objects) {
    const object = getObject(value);
    if (!object) continue;
    meta.id ??= getString(object.thread_id) ?? getString(object.threadId) ?? getString(object.id);
    meta.cwd ??= getString(object.cwd) ?? getString(object.workingDirectory) ?? cwdFromAmpEnv(object.env);
    meta.title ??= getString(object.title) ?? getString(object.name);
  }
  return meta;
}

function cwdFromAmpEnv(env: unknown): string | undefined {
  const trees = getArray(getObject(getObject(env)?.initial)?.trees);
  for (const tree of trees) {
    const uri = getString(getObject(tree)?.uri);
    if (!uri) continue;
    if (uri.startsWith("file://")) {
      try {
        return decodeURIComponent(uri.slice("file://".length));
      } catch {
        return uri.slice("file://".length);
      }
    }
    if (uri.startsWith("/")) return uri;
  }
  return undefined;
}
