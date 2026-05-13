import { useEffect, useMemo, useRef, useState } from "react";
import { FolderPlus, RotateCcw, Save, X } from "lucide-react";
import type { AppSnapshot, PathPreferences, SessionSource, SourceSettings } from "../../shared/types";

const SOURCES: SessionSource[] = ["codex", "claude", "amp", "pi"];
const SOURCE_LABELS: Record<SessionSource, string> = {
  codex: "Codex",
  claude: "Claude",
  amp: "Amp",
  pi: "Pi"
};

const DEFAULT_ROOTS: Record<SessionSource, string[]> = {
  codex: ["~/.codex/session_index.jsonl", "~/.codex/sessions"],
  claude: ["~/.claude/projects", "~/.claude/history.jsonl"],
  amp: ["~/.local/share/amp/threads", "~/.local/share/amp/history.jsonl"],
  pi: ["~/.pi/agent/sessions"]
};

type Draft = Record<SessionSource, SourceSettings>;

function normaliseDraft(prefs: PathPreferences | undefined): Draft {
  const out = {} as Draft;
  for (const source of SOURCES) {
    const entry = prefs?.sources?.[source];
    out[source] = {
      enabled: entry?.enabled !== false,
      roots: entry?.roots && entry.roots.length ? [...entry.roots] : undefined
    };
  }
  return out;
}

function draftsEqual(a: Draft, b: Draft): boolean {
  for (const source of SOURCES) {
    if (a[source].enabled !== b[source].enabled) return false;
    const ar = a[source].roots ?? [];
    const br = b[source].roots ?? [];
    if (ar.length !== br.length) return false;
    for (let i = 0; i < ar.length; i++) if (ar[i] !== br[i]) return false;
  }
  return true;
}

function compact(p: string): string {
  return p.replace(/^\/Users\/[^/]+/, "~");
}

export function SettingsView({
  open,
  onClose,
  onSaved
}: {
  open: boolean;
  onClose: () => void;
  onSaved?: (snapshot: AppSnapshot) => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [loaded, setLoaded] = useState<Draft | undefined>();
  const [draft, setDraft] = useState<Draft | undefined>();
  const [saving, setSaving] = useState(false);
  const [pinned, setPinned] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    void window.resume.getPathPreferences().then((prefs) => {
      const next = normaliseDraft(prefs);
      setLoaded(next);
      setDraft(next);
      setPinned(prefs?.pinned ?? []);
    });
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      previousFocus.current?.focus?.();
    };
  }, [open, onClose]);

  const dirty = useMemo(() => Boolean(draft && loaded && !draftsEqual(draft, loaded)), [draft, loaded]);

  if (!open || !draft) {
    if (!open) return null;
    return (
      <div className="settings-overlay" role="dialog" aria-modal="true" aria-label="Settings" onClick={onClose}>
        <div className="settings-overlay__sheet" onClick={(event) => event.stopPropagation()}>
          <header className="settings-overlay__header">
            <h2>Settings</h2>
            <button ref={closeRef} className="icon-button" onClick={onClose} aria-label="Close settings">
              <X size={13} />
            </button>
          </header>
          <div className="settings-overlay__body">
            <p className="settings-overlay__hint">Loading…</p>
          </div>
        </div>
      </div>
    );
  }

  function updateSource(source: SessionSource, updater: (current: SourceSettings) => SourceSettings) {
    setDraft((prev) => {
      if (!prev) return prev;
      return { ...prev, [source]: updater(prev[source]) };
    });
  }

  async function addRoot(source: SessionSource) {
    const chosen = await window.resume.choosePath();
    if (!chosen) return;
    updateSource(source, (current) => {
      const existing = current.roots ?? [];
      if (existing.includes(chosen)) return current;
      return { ...current, roots: [...existing, chosen] };
    });
  }

  function removeRoot(source: SessionSource, root: string) {
    updateSource(source, (current) => {
      const remaining = (current.roots ?? []).filter((entry) => entry !== root);
      return { ...current, roots: remaining.length ? remaining : undefined };
    });
  }

  function resetSource(source: SessionSource) {
    updateSource(source, (current) => ({ ...current, roots: undefined }));
  }

  function toggleEnabled(source: SessionSource) {
    updateSource(source, (current) => ({ ...current, enabled: !current.enabled }));
  }

  async function save() {
    if (!draft || saving) return;
    setSaving(true);
    try {
      const sources: PathPreferences["sources"] = {};
      for (const source of SOURCES) {
        const entry = draft[source];
        sources![source] = entry.roots && entry.roots.length
          ? { enabled: entry.enabled, roots: entry.roots }
          : { enabled: entry.enabled };
      }
      const snapshot = await window.resume.savePathPreferences({ pinned, sources });
      setLoaded(draft);
      onSaved?.(snapshot as AppSnapshot);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="settings-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
      onClick={onClose}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="settings-overlay__sheet" onClick={(event) => event.stopPropagation()}>
        <header className="settings-overlay__header">
          <h2>Settings</h2>
          <button ref={closeRef} className="icon-button" onClick={onClose} aria-label="Close settings">
            <X size={13} />
          </button>
        </header>
        <div className="settings-overlay__body">
          <p className="settings-overlay__hint">
            Choose which AI coding assistants to index and where their session files live. Paths replace the defaults when set; leave empty to use built-in locations.
          </p>
          <div className="settings-sources">
            {SOURCES.map((source) => {
              const entry = draft[source];
              const overrides = entry.roots && entry.roots.length > 0;
              const display = overrides ? entry.roots! : DEFAULT_ROOTS[source];
              return (
                <section className={`settings-source ${entry.enabled ? "" : "is-disabled"}`} key={source}>
                  <header>
                    <label className="settings-source__toggle">
                      <input
                        type="checkbox"
                        checked={entry.enabled}
                        onChange={() => toggleEnabled(source)}
                      />
                      <span className={`source-dot source-dot--${source}`} />
                      <span className="settings-source__label">{SOURCE_LABELS[source]}</span>
                    </label>
                    <span className="settings-source__status">
                      {overrides ? "Custom paths" : "Default paths"}
                    </span>
                  </header>
                  <ul className="settings-source__roots">
                    {display.map((root) => (
                      <li key={root}>
                        <code>{compact(root)}</code>
                        {overrides && (
                          <button
                            type="button"
                            className="icon-button"
                            onClick={() => removeRoot(source, root)}
                            aria-label={`Remove ${root}`}
                            disabled={!entry.enabled}
                          >
                            <X size={12} />
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                  <div className="settings-source__actions">
                    <button
                      type="button"
                      className="button button--quiet"
                      onClick={() => void addRoot(source)}
                      disabled={!entry.enabled}
                    >
                      <FolderPlus size={13} /> Add path…
                    </button>
                    {overrides && (
                      <button
                        type="button"
                        className="button button--quiet"
                        onClick={() => resetSource(source)}
                        disabled={!entry.enabled}
                      >
                        <RotateCcw size={13} /> Reset to default
                      </button>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
        <footer className="settings-overlay__footer">
          <span className="settings-overlay__dirty">
            {saving ? "Saving and refreshing…" : dirty ? "Unsaved changes" : "No changes"}
          </span>
          <div className="settings-overlay__footer-actions">
            <button type="button" className="button button--quiet" onClick={onClose} disabled={saving}>
              Close
            </button>
            <button
              type="button"
              className="button"
              onClick={() => void save()}
              disabled={!dirty || saving}
            >
              <Save size={13} /> Save and rescan
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
