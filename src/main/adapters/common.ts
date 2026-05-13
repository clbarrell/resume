import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import type { PreviewSnippet, SessionPreview, SessionRecord, SessionSource, SourceRoots } from "../../shared/types.js";
import { cdPrefix, shellQuote } from "../../shared/shell.js";

export interface AdapterScanResult {
  source: SessionSource;
  records: SessionRecord[];
  warningCount: number;
  pathCount: number;
  missingPath: boolean;
  permissionDenied: boolean;
}

export interface Adapter {
  source: SessionSource;
  scan(roots?: string[]): Promise<AdapterScanResult>;
}

export interface ParsedEntry {
  role?: string;
  text?: string;
  tool?: string;
  files?: string[];
  createdAt?: string;
}

export function defaultRoots(): SourceRoots {
  const home = homedir();
  return {
    codex: [path.join(home, ".codex", "session_index.jsonl"), path.join(home, ".codex", "sessions")],
    claude: [path.join(home, ".claude", "projects")],
    amp: [path.join(home, ".local", "share", "amp", "threads")],
    pi: [path.join(home, ".pi", "agent", "sessions")]
  };
}

export async function pathExists(target: string): Promise<"ok" | "missing" | "permission"> {
  try {
    await fs.access(target);
    return "ok";
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EACCES" || code === "EPERM") return "permission";
    return "missing";
  }
}

export async function listFiles(root: string, extensions: string[]): Promise<string[]> {
  const status = await pathExists(root);
  if (status !== "ok") return [];
  const stat = await fs.stat(root);
  if (stat.isFile()) {
    return extensions.some((extension) => root.endsWith(extension)) ? [root] : [];
  }

  const results: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    await Promise.all(entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && extensions.some((extension) => fullPath.endsWith(extension))) {
        results.push(fullPath);
      }
    }));
  }
  await walk(root);
  return results.sort();
}

export async function readJsonl(filePath: string): Promise<{ objects: unknown[]; warnings: string[] }> {
  const warnings: string[] = [];
  const content = await fs.readFile(filePath, "utf8");
  const objects = content.split(/\r?\n/).flatMap((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return [];
    try {
      return [JSON.parse(trimmed) as unknown];
    } catch {
      warnings.push(`${path.basename(filePath)}:${index + 1} malformed JSON`);
      return [];
    }
  });
  return { objects, warnings };
}

export async function readJson(filePath: string): Promise<{ object?: unknown; warnings: string[] }> {
  try {
    return { object: JSON.parse(await fs.readFile(filePath, "utf8")) as unknown, warnings: [] };
  } catch {
    return { warnings: [`${path.basename(filePath)} malformed JSON`] };
  }
}

export function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function getIsoDate(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) {
    const millis = value > 10_000_000_000 ? value : value * 1000;
    return new Date(millis).toISOString();
  }
  return undefined;
}

export function getObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

export function getArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function textFromUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(textFromUnknown).filter(Boolean).join("\n");
  const object = getObject(value);
  if (!object) return "";
  if (typeof object.text === "string") return object.text;
  if (typeof object.content === "string") return object.content;
  if (Array.isArray(object.content)) return textFromUnknown(object.content);
  if (typeof object.message === "string") return object.message;
  return "";
}

export function isIndexableText(text: string): boolean {
  if (!text.trim()) return false;
  if (text.length > 16000) return false;
  if (/^[A-Za-z0-9+/=\r\n]{512,}$/.test(text.trim())) return false;
  return true;
}

export function truncateText(text: string, limit = 1200): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit - 1)}…`;
}

export function collectFileMentions(text: string): string[] {
  const matches = text.match(/(?:~?\/|\.{1,2}\/)?[\w.-]+(?:\/[\w.@-]+)+/g) ?? [];
  return unique(
    matches
      .map((match) => match.trim().replace(/[),.;:]+$/, ""))
      .filter((match) => {
        const hasPrefix = /^(?:~?\/|\.{1,2}\/)/.test(match);
        const hasExtension = /\.[A-Za-z0-9]{1,8}$/.test(match);
        if (!hasPrefix && !hasExtension) return false;
        // Reject single-segment names like "jdx/ruby" or "4/4" — require ≥2 path segments after the prefix.
        const tail = match.replace(/^(?:~?\/|\.{1,2}\/)/, "");
        const segments = tail.split("/").filter(Boolean);
        if (segments.length < 2) return false;
        // Reject all-numeric segments (e.g. "4/4 progress").
        if (segments.every((segment) => /^\d+$/.test(segment))) return false;
        return true;
      }),
  ).slice(0, 16);
}

export function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

export function stableId(source: SessionSource, filePath: string, fallback?: string): string {
  if (fallback) return fallback;
  return `${source}-${createHash("sha1").update(filePath).digest("hex").slice(0, 14)}`;
}

export function buildPreview(entries: ParsedEntry[], warnings: string[]): SessionPreview {
  const userEntries = entries.filter((entry) => entry.role === "user" && entry.text);
  const transcript = entries
    .filter((entry) => entry.text && entry.role)
    .slice(0, 4)
    .concat(entries.filter((entry) => entry.text && entry.role).slice(-4))
    .map((entry): PreviewSnippet => ({
      role: normalizeRole(entry.role),
      text: truncateText(entry.text ?? "", 420),
      at: entry.createdAt
    }));
  return {
    firstPrompt: userEntries[0]?.text ? truncateText(userEntries[0].text, 700) : undefined,
    lastPrompt: userEntries.at(-1)?.text ? truncateText(userEntries.at(-1)?.text ?? "", 700) : undefined,
    transcript,
    files: unique(entries.flatMap((entry) => entry.files ?? []).concat(entries.flatMap((entry) => collectFileMentions(entry.text ?? "")))).slice(0, 24),
    tools: unique(entries.map((entry) => entry.tool ?? "")).slice(0, 24),
    warnings
  };
}

export function normalizeRole(role?: string): PreviewSnippet["role"] {
  if (role === "assistant" || role === "system" || role === "tool") return role;
  return "user";
}

export function buildIndexedText(fields: Array<string | undefined>, entries: ParsedEntry[]): string {
  const entryText = entries
    .map((entry) => [entry.role, entry.tool, ...(entry.files ?? []), isIndexableText(entry.text ?? "") ? truncateText(entry.text ?? "", 2400) : ""].join(" "))
    .join("\n");
  return [...fields, entryText].filter(Boolean).join("\n");
}

export function getDates(entries: ParsedEntry[], fallbackDate?: string): { createdAt: string; updatedAt: string } {
  const dates = entries.map((entry) => entry.createdAt).filter(Boolean).sort() as string[];
  const fallback = fallbackDate ?? new Date(0).toISOString();
  return {
    createdAt: dates[0] ?? fallback,
    updatedAt: dates.at(-1) ?? fallback
  };
}

export async function fileMtimeIso(filePath: string): Promise<string> {
  const stat = await fs.stat(filePath);
  return stat.mtime.toISOString();
}

export function codexResume(cwd: string, id: string): string {
  return `codex -C ${shellQuote(cwd)} resume ${shellQuote(id)}`;
}

export function claudeResume(cwd: string, id: string): string {
  return `${cdPrefix(cwd)}claude --resume ${shellQuote(id)}`;
}

export function ampResume(cwd: string, id: string): string {
  return `${cdPrefix(cwd)}amp threads continue ${shellQuote(id)}`;
}

export function piResume(cwd: string, pathOrId: string): string {
  return `${cdPrefix(cwd)}pi --session ${shellQuote(pathOrId)}`;
}
