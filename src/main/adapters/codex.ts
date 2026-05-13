import path from "node:path";
import { Adapter, AdapterScanResult, buildIndexedText, buildPreview, codexResume, fileMtimeIso, getArray, getDates, getIsoDate, getObject, getString, listFiles, pathExists, readJsonl, stableId, textFromUnknown } from "./common.js";
import type { ParsedEntry } from "./common.js";
import type { SessionRecord } from "../../shared/types.js";

export const codexAdapter: Adapter = {
  source: "codex",
  async scan(roots = []): Promise<AdapterScanResult> {
    const statuses = await Promise.all(roots.map(pathExists));
    const files = (await Promise.all(roots.map((root) => listFiles(root, [".jsonl"])))).flat();
    const indexFiles = files.filter((filePath) => path.basename(filePath) === "session_index.jsonl");
    const sessionFiles = files.filter((filePath) => path.basename(filePath) !== "session_index.jsonl");
    const index = await readCodexIndex(indexFiles);
    const records: SessionRecord[] = [];
    let warningCount = 0;

    for (const filePath of sessionFiles) {
      const { objects, warnings } = await readJsonl(filePath);
      const entries = objects.map(parseCodexEntry).filter((entry) => entry.text || entry.tool || entry.files?.length);
      const meta = getCodexMeta(objects);
      const indexedMeta = meta.id ? index.get(meta.id) : undefined;
      const fileDate = await fileMtimeIso(filePath);
      const dates = getDates(entries, fileDate);
      const id = stableId("codex", filePath, meta.id);
      const cwd = meta.cwd ?? "";
      const title = indexedMeta?.title ?? meta.title ?? entries.find((entry) => entry.role === "user" && entry.text)?.text?.slice(0, 80) ?? "Untitled Codex session";
      warningCount += warnings.length;
      records.push({
        id,
        source: "codex",
        title,
        cwd,
        createdAt: meta.createdAt ?? dates.createdAt,
        updatedAt: indexedMeta?.updatedAt ?? meta.updatedAt ?? dates.updatedAt,
        messageCount: entries.filter((entry) => entry.role === "user" || entry.role === "assistant").length,
        filePath,
        resumeCommand: codexResume(cwd, id),
        preview: buildPreview(entries, warnings),
        indexedText: buildIndexedText([title, cwd, id, filePath], entries),
        hasParseWarnings: warnings.length > 0
      });
    }

    return {
      source: "codex",
      records,
      warningCount,
      pathCount: sessionFiles.length,
      missingPath: statuses.every((status) => status === "missing"),
      permissionDenied: statuses.some((status) => status === "permission")
    };
  }
};

function parseCodexEntry(value: unknown): ParsedEntry {
  const object = getObject(value);
  if (!object) return {};
  const payload = getObject(object.payload) ?? object;
  const responseItem = getObject(payload.item) ?? payload;
  const message = getObject(responseItem.message) ?? responseItem;
  const content = textFromUnknown(message.content ?? responseItem.content ?? responseItem.text ?? payload.message ?? payload.summary ?? object.summary);
  const role = normalizeCodexRole(getString(message.role) ?? getString(responseItem.role) ?? getString(object.role) ?? roleForCodexType(getString(object.type)), content);
  const tool = getString(message.name) ?? getString(responseItem.name) ?? getString(message.tool_name) ?? getString(responseItem.tool_name) ?? getString(payload.name);
  const files = getArray(object.files).map((item) => getString(item)).filter(Boolean) as string[];
  return {
    role: tool ? "tool" : role,
    text: content,
    tool,
    files,
    createdAt: getIsoDate(object.timestamp) ?? getIsoDate(payload.timestamp) ?? getIsoDate(object.created_at) ?? getIsoDate(object.createdAt)
  };
}

function getCodexMeta(objects: unknown[]): { id?: string; title?: string; cwd?: string; createdAt?: string; updatedAt?: string } {
  const meta: ReturnType<typeof getCodexMeta> = {};
  for (const value of objects) {
    const object = getObject(value);
    if (!object) continue;
    const payload = getObject(object.payload) ?? object;
    meta.id ??= getString(payload.session_id) ?? getString(payload.sessionId) ?? getString(payload.id) ?? getString(object.session_id) ?? getString(object.sessionId) ?? getString(object.id);
    meta.cwd ??= getString(payload.cwd) ?? getString(payload.working_directory) ?? getString(getObject(payload.context)?.cwd) ?? getString(object.cwd);
    meta.title ??= getString(payload.title) ?? getString(payload.thread_name) ?? getString(payload.label) ?? getString(object.title) ?? getString(object.label);
    meta.createdAt ??= getIsoDate(payload.timestamp) ?? getIsoDate(payload.created_at) ?? getIsoDate(payload.createdAt) ?? getIsoDate(object.timestamp);
    meta.updatedAt = getIsoDate(payload.updated_at) ?? getIsoDate(payload.updatedAt) ?? getIsoDate(object.updated_at) ?? getIsoDate(object.updatedAt) ?? meta.updatedAt;
  }
  return meta;
}

async function readCodexIndex(indexFiles: string[]): Promise<Map<string, { title?: string; updatedAt?: string }>> {
  const index = new Map<string, { title?: string; updatedAt?: string }>();
  for (const filePath of indexFiles) {
    const { objects } = await readJsonl(filePath);
    for (const value of objects) {
      const object = getObject(value);
      const id = getString(object?.id);
      if (!id) continue;
      index.set(id, {
        title: getString(object?.thread_name) ?? getString(object?.title),
        updatedAt: getIsoDate(object?.updated_at) ?? getIsoDate(object?.updatedAt)
      });
    }
  }
  return index;
}

function roleForCodexType(type?: string): string | undefined {
  if (type === "event_msg") return "system";
  if (type === "response_item") return undefined;
  return type;
}

function normalizeCodexRole(role: string | undefined, text: string): string | undefined {
  if (role === "developer") return "system";
  if (role === "user" && (/^# AGENTS\.md instructions/.test(text) || /^<environment_context>/.test(text))) {
    return "system";
  }
  return role;
}
