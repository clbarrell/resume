import { Adapter, AdapterScanResult, buildIndexedText, buildPreview, claudeResume, fileMtimeIso, getArray, getDates, getIsoDate, getObject, getString, listFiles, pathExists, readJsonl, stableId, textFromUnknown } from "./common.js";
import type { ParsedEntry } from "./common.js";
import type { SessionRecord } from "../../shared/types.js";

export const claudeAdapter: Adapter = {
  source: "claude",
  async scan(roots = []): Promise<AdapterScanResult> {
    const statuses = await Promise.all(roots.map(pathExists));
    const files = (await Promise.all(roots.map((root) => listFiles(root, [".jsonl"])))).flat();
    const records: SessionRecord[] = [];
    let warningCount = 0;

    for (const filePath of files) {
      const { objects, warnings } = await readJsonl(filePath);
      const entries = objects.map(parseClaudeEntry).filter((entry) => entry.text || entry.tool || entry.files?.length);
      const meta = getClaudeMeta(objects);
      const fileDate = await fileMtimeIso(filePath);
      const dates = getDates(entries, fileDate);
      const resumeId = stableId("claude", filePath, meta.id);
      const id = `${resumeId}:${filePath}`;
      const cwd = meta.cwd ?? "";
      const title = meta.title ?? entries.find((entry) => entry.role === "user" && entry.text)?.text?.slice(0, 80) ?? "Untitled Claude session";
      warningCount += warnings.length;
      records.push({
        id,
        source: "claude",
        title,
        cwd,
        createdAt: dates.createdAt,
        updatedAt: dates.updatedAt,
        messageCount: entries.filter((entry) => entry.role === "user" || entry.role === "assistant").length,
        filePath,
        resumeCommand: claudeResume(cwd, resumeId),
        preview: buildPreview(entries, warnings),
        indexedText: buildIndexedText([title, cwd, id, filePath], entries),
        hasParseWarnings: warnings.length > 0
      });
    }

    return {
      source: "claude",
      records,
      warningCount,
      pathCount: files.length,
      missingPath: statuses.every((status) => status === "missing"),
      permissionDenied: statuses.some((status) => status === "permission")
    };
  }
};

function parseClaudeEntry(value: unknown): ParsedEntry {
  const object = getObject(value);
  if (!object) return {};
  const message = getObject(object.message) ?? object;
  const role = getString(message.role) ?? getString(object.type) ?? getString(object.role);
  const content = textFromUnknown(message.content ?? object.content ?? object.summary);
  const toolUse = getArray(message.content).find((item) => getString(getObject(item)?.type) === "tool_use");
  const tool = getString(getObject(toolUse)?.name) ?? getString(object.toolName) ?? getString(object.tool_name);
  return {
    role: tool ? "tool" : role,
    text: content,
    tool,
    files: getArray(object.files).map((item) => getString(item)).filter(Boolean) as string[],
    createdAt: getIsoDate(object.timestamp) ?? getIsoDate(object.created_at)
  };
}

function getClaudeMeta(objects: unknown[]): { id?: string; title?: string; cwd?: string } {
  const meta: ReturnType<typeof getClaudeMeta> = {};
  for (const value of objects) {
    const object = getObject(value);
    if (!object) continue;
    meta.id ??= getString(object.sessionId) ?? getString(object.session_id) ?? getString(object.uuid) ?? getString(object.id);
    meta.cwd ??= getString(object.cwd);
    meta.title ??= getString(object.title) ?? getString(object.summary);
  }
  return meta;
}
