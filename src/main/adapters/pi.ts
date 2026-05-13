import { Adapter, AdapterScanResult, buildIndexedText, buildPreview, fileMtimeIso, getArray, getDates, getIsoDate, getObject, getString, listFiles, pathExists, piResume, readJsonl, stableId, textFromUnknown } from "./common.js";
import type { ParsedEntry } from "./common.js";
import type { SessionRecord } from "../../shared/types.js";

export const piAdapter: Adapter = {
  source: "pi",
  async scan(roots = []): Promise<AdapterScanResult> {
    const statuses = await Promise.all(roots.map(pathExists));
    const files = (await Promise.all(roots.map((root) => listFiles(root, [".jsonl"])))).flat();
    const records: SessionRecord[] = [];
    let warningCount = 0;

    for (const filePath of files) {
      const { objects, warnings } = await readJsonl(filePath);
      const entries = objects.map(parsePiEntry).filter((entry) => entry.text || entry.tool || entry.files?.length);
      const meta = getPiMeta(objects);
      const fileDate = await fileMtimeIso(filePath);
      const dates = getDates(entries, fileDate);
      const id = stableId("pi", filePath, meta.id);
      const cwd = meta.cwd ?? "";
      const title = meta.title ?? entries.find((entry) => entry.role === "user" && entry.text)?.text?.slice(0, 80) ?? "Untitled Pi session";
      warningCount += warnings.length;
      records.push({
        id,
        source: "pi",
        title,
        cwd,
        createdAt: meta.createdAt ?? dates.createdAt,
        updatedAt: meta.updatedAt ?? dates.updatedAt,
        messageCount: entries.filter((entry) => entry.role === "user" || entry.role === "assistant").length,
        filePath,
        resumeCommand: piResume(cwd, filePath),
        preview: buildPreview(entries, warnings),
        indexedText: buildIndexedText([title, cwd, id, filePath, meta.branchSummary], entries),
        hasParseWarnings: warnings.length > 0
      });
    }

    return {
      source: "pi",
      records,
      warningCount,
      pathCount: files.length,
      missingPath: statuses.every((status) => status === "missing"),
      permissionDenied: statuses.some((status) => status === "permission")
    };
  }
};

function parsePiEntry(value: unknown): ParsedEntry {
  const object = getObject(value);
  if (!object) return {};
  const type = getString(object.type);
  const payload = getObject(object.payload) ?? getObject(object.data) ?? object;
  const message = getObject(payload.message) ?? payload;
  const role = getString(payload.role) ?? (type === "message" ? "user" : type);
  const tool = getString(message.toolName) ?? getString(message.tool_name) ?? getString(message.name) ?? getString(payload.toolName) ?? getString(payload.tool_name);
  return {
    role: type === "compaction" || type === "branch_summary" ? "system" : tool ? "tool" : role,
    text: textFromUnknown(message.content ?? message.text ?? payload.content ?? payload.text ?? payload.summary ?? payload.name ?? object.summary),
    tool,
    files: getArray(payload.files).map((item) => getString(item)).filter(Boolean) as string[],
    createdAt: getIsoDate(object.timestamp) ?? getIsoDate(payload.timestamp) ?? getIsoDate(payload.createdAt)
  };
}

function getPiMeta(objects: unknown[]): { id?: string; title?: string; cwd?: string; createdAt?: string; updatedAt?: string; branchSummary?: string } {
  const meta: ReturnType<typeof getPiMeta> = {};
  for (const value of objects) {
    const object = getObject(value);
    if (!object) continue;
    const payload = getObject(object.payload) ?? getObject(object.data) ?? object;
    const type = getString(object.type);
    meta.id ??= getString(payload.sessionId) ?? getString(payload.session_id) ?? getString(object.sessionId) ?? getString(object.id);
    meta.cwd ??= getString(payload.cwd) ?? getString(payload.workingDirectory) ?? getString(object.cwd);
    if (type === "session_info") {
      meta.title = getString(payload.name) ?? meta.title;
    }
    if (type === "label") {
      meta.title ??= getString(payload.name) ?? getString(payload.label);
    }
    if (type === "branch_summary") {
      meta.branchSummary = textFromUnknown(payload.summary ?? payload.text);
    }
    meta.createdAt ??= getString(object.timestamp) ?? getString(payload.createdAt);
    meta.updatedAt = getString(object.timestamp) ?? getString(payload.updatedAt) ?? meta.updatedAt;
  }
  return meta;
}
