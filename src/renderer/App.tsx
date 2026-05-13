import { Check, Clipboard, FileWarning, FolderPlus, Pin, PinOff, RefreshCcw, Search, Settings, X } from "lucide-react";
import appIconUrl from "../../app-icon.png";
import { type KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HelpOverlay } from "./components/HelpOverlay";
import { SettingsView } from "./components/SettingsView";
import type {
  AppSnapshot,
  PathPreferences,
  SearchFilters,
  SessionListItem,
  SessionRecord,
  SessionSearchHit,
  SessionSource,
  SourceHealth
} from "../shared/types";

const SOURCES: SessionSource[] = ["codex", "claude", "amp", "pi"];
const SOURCE_LABELS: Record<SessionSource, string> = {
  codex: "Codex",
  claude: "Claude",
  amp: "Amp",
  pi: "Pi"
};

const DEFAULT_FILTERS: SearchFilters = {
  sources: SOURCES,
  dateScope: "7d",
  warningsOnly: false
};

const MAX_RECENT_PATHS = 8;

export function App() {
  const [snapshot, setSnapshot] = useState<AppSnapshot>({ sessions: [], health: [] });
  const [results, setResults] = useState<SessionSearchHit[]>([]);
  const [resultTotal, setResultTotal] = useState(0);
  const [selectedSession, setSelectedSession] = useState<SessionRecord | undefined>();
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<SearchFilters>(DEFAULT_FILTERS);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshTarget, setRefreshTarget] = useState<SessionSource | "all" | undefined>();
  const [copiedId, setCopiedId] = useState<string | undefined>();
  const [pinnedPaths, setPinnedPaths] = useState<string[]>([]);
  const [helpOpen, setHelpOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLElement>(null);
  const searchRequestSeq = useRef(0);
  const hydrateRequestSeq = useRef(0);

  const grouped = useMemo(() => groupByRecency(results), [results]);
  const groupOrder = useMemo(() => Object.keys(grouped), [grouped]);
  const flatResults = useMemo(
    () => groupOrder.flatMap((g) => grouped[g].map((entry) => entry.session)),
    [grouped, groupOrder],
  );
  const selected = flatResults[selectedIndex];
  const queryTerms = useMemo(() => extractTerms(query), [query]);

  const runSearch = useCallback(async (nextQuery = query, nextFilters = filters) => {
    const requestId = ++searchRequestSeq.current;
    const response = await window.resume.search(nextQuery, nextFilters);
    if (requestId !== searchRequestSeq.current) return;
    setResults(response.results);
    setResultTotal(response.total);
    setSelectedIndex((current) => Math.min(current, Math.max(response.results.length - 1, 0)));
  }, [filters, query]);

  const refresh = useCallback(async (source?: SessionSource) => {
    setRefreshTarget(source ?? "all");
    setIsRefreshing(true);
    try {
      const nextSnapshot = await window.resume.refresh(source);
      setSnapshot(nextSnapshot);
      const requestId = ++searchRequestSeq.current;
      const response = await window.resume.search(query, filters);
      if (requestId !== searchRequestSeq.current) return;
      setResults(response.results);
      setResultTotal(response.total);
      setSelectedIndex(0);
    } finally {
      setIsRefreshing(false);
      setRefreshTarget(undefined);
    }
  }, [filters, query]);

  const copyCommand = useCallback(async (session: Pick<SessionSearchHit | SessionRecord, "id" | "resumeCommand">) => {
    await window.resume.copyResumeCommand(session.resumeCommand);
    setCopiedId(session.id);
    window.setTimeout(() => setCopiedId(undefined), 1400);
  }, []);

  useEffect(() => {
    window.resume.getSnapshot().then(async (loaded) => {
      setSnapshot(loaded);
      const initialRequestId = ++searchRequestSeq.current;
      const initialResponse = await window.resume.search("", DEFAULT_FILTERS);
      if (initialRequestId === searchRequestSeq.current) {
        setResults(initialResponse.results);
        setResultTotal(initialResponse.total);
      }
      if (!loaded.scannedAt) {
        setRefreshTarget("all");
        setIsRefreshing(true);
        try {
          const refreshed = await window.resume.refresh();
          setSnapshot(refreshed);
          const refreshedRequestId = ++searchRequestSeq.current;
          const refreshedResponse = await window.resume.search("", DEFAULT_FILTERS);
          if (refreshedRequestId === searchRequestSeq.current) {
            setResults(refreshedResponse.results);
            setResultTotal(refreshedResponse.total);
          }
        } finally {
          setIsRefreshing(false);
          setRefreshTarget(undefined);
        }
      }
    });
    window.resume.getPathPreferences?.().then((prefs) => {
      if (prefs?.pinned) setPinnedPaths(prefs.pinned);
    });
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void runSearch(query, filters), 90);
    return () => window.clearTimeout(timer);
  }, [filters, query, runSearch]);

  useEffect(() => {
    if (!selected) {
      setSelectedSession(undefined);
      return;
    }
    const requestId = ++hydrateRequestSeq.current;
    setSelectedSession(undefined);
    window.resume.getSession(selected.id).then((session) => {
      if (requestId !== hydrateRequestSeq.current) return;
      setSelectedSession(session);
    });
  }, [selected?.id]);

  function updateFilters(nextFilters: SearchFilters) {
    setFilters(nextFilters);
    setSelectedIndex(0);
  }

  function setPathFilter(nextPath: string | undefined) {
    updateFilters({ ...filters, pathFilter: nextPath || undefined });
  }

  const focusRailGroup = useCallback((group: "sources" | "paths" | "date" | "warnings") => {
    const groupEl = railRef.current?.querySelector<HTMLElement>(`[data-rail-group="${group}"]`);
    const target = groupEl?.querySelector<HTMLElement>('[data-rail-item]');
    target?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (helpOpen || settingsOpen) return; // overlays handle their own keys
      const isMeta = event.metaKey || event.ctrlKey;
      const key = event.key;
      const lower = key.toLowerCase();
      const target = event.target as HTMLElement | null;
      const isTextInput = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;

      // Help overlay
      if ((key === "?" && !isMeta) || (isMeta && key === "/")) {
        event.preventDefault();
        setHelpOpen(true);
        return;
      }

      // Settings
      if (isMeta && key === ",") {
        event.preventDefault();
        setSettingsOpen(true);
        return;
      }

      // Focus search
      if (isMeta && lower === "k") {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }

      // Focus rail groups
      if (isMeta && lower === "l") {
        event.preventDefault();
        focusRailGroup("paths");
        return;
      }
      if (isMeta && lower === "f") {
        event.preventDefault();
        focusRailGroup("sources");
        return;
      }

      // Cycle date scope
      if (isMeta && lower === "d") {
        event.preventDefault();
        const order = ["7d", "30d", "90d", "all"] as const;
        const next = order[(order.indexOf(filters.dateScope) + 1) % order.length];
        updateFilters({ ...filters, dateScope: next });
        return;
      }

      // Refresh all
      if (isMeta && lower === "r") {
        event.preventDefault();
        void refresh();
        return;
      }

      // Toggle source by ordinal
      if (isMeta && /^[1-4]$/.test(key)) {
        event.preventDefault();
        const source = SOURCES[Number(key) - 1];
        const active = filters.sources.includes(source);
        const nextSources = active
          ? filters.sources.filter((s) => s !== source)
          : [...filters.sources, source];
        updateFilters({ ...filters, sources: nextSources.length ? nextSources : SOURCES });
        return;
      }

      // Toggle warnings-only
      if (isMeta && key === ".") {
        event.preventDefault();
        updateFilters({ ...filters, warningsOnly: !filters.warningsOnly });
        return;
      }

      // Copy session cwd
      if (isMeta && event.shiftKey && lower === "c" && selected) {
        event.preventDefault();
        void window.resume.copyResumeCommand(selected.cwd ?? "");
        return;
      }

      // Escape cascade
      if (key === "Escape") {
        event.preventDefault();
        if (query) {
          setQuery("");
          searchRef.current?.focus();
        } else if (filters.pathFilter) {
          setPathFilter(undefined);
        } else {
          void window.resume.hideWindow?.();
        }
        return;
      }

      // Results navigation: active when search or list focused
      const inResults =
        document.activeElement === listRef.current ||
        document.activeElement === searchRef.current ||
        target?.classList.contains("result-row");

      if (inResults) {
        if (key === "ArrowDown") {
          event.preventDefault();
          setSelectedIndex((index) => Math.min(index + 1, results.length - 1));
          return;
        }
        if (key === "ArrowUp") {
          event.preventDefault();
          setSelectedIndex((index) => Math.max(index - 1, 0));
          return;
        }
        if (key === "PageDown") {
          event.preventDefault();
          setSelectedIndex((index) => Math.min(index + 10, results.length - 1));
          return;
        }
        if (key === "PageUp") {
          event.preventDefault();
          setSelectedIndex((index) => Math.max(index - 10, 0));
          return;
        }
        if (key === "Home") {
          event.preventDefault();
          setSelectedIndex(0);
          return;
        }
        if (key === "End") {
          event.preventDefault();
          setSelectedIndex(Math.max(results.length - 1, 0));
          return;
        }
        if (isMeta && lower === "c" && selected) {
          event.preventDefault();
          void copyCommand(selected);
          return;
        }
        if (key === "Enter" && selected) {
          event.preventDefault();
          void copyCommand(selected);
          return;
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [copyCommand, filters, focusRailGroup, helpOpen, settingsOpen, query, refresh, results.length, selected]);

  const pathCounts = useMemo(() => buildPathCounts(snapshot.sessions, filters), [snapshot.sessions, filters]);
  const recentPaths = useMemo(
    () => buildRecentPaths(pathCounts, pinnedPaths),
    [pathCounts, pinnedPaths]
  );

  const togglePin = useCallback((targetPath: string) => {
    setPinnedPaths((current) => {
      const next = current.includes(targetPath)
        ? current.filter((entry) => entry !== targetPath)
        : [...current, targetPath];
      void window.resume.savePathPreferences?.({ pinned: next });
      return next;
    });
  }, []);

  const choosePath = useCallback(async () => {
    if (!window.resume.choosePath) return;
    const chosen = await window.resume.choosePath();
    if (chosen) setPathFilter(chosen);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  const hasQuery = query.trim().length > 0;

  return (
    <main className="shell">
      <aside className="rail" ref={railRef}>
        <div className="rail__spacer" />
        <section className="identity">
          <div className="identity__mark" aria-hidden>
            <img src={appIconUrl} alt="" />
            <span className="identity__pulse" />
          </div>
          <div className="identity__meta">
            <h1 className="identity__brand">Resume</h1>
            <div className="identity__count">
              <span className="identity__count-num">{snapshot.sessions.length.toLocaleString()}</span>
              <span className="identity__count-label">indexed</span>
            </div>
          </div>
        </section>
        <FilterPanel
          filters={filters}
          health={snapshot.health}
          isRefreshing={isRefreshing}
          refreshTarget={refreshTarget}
          recentPaths={recentPaths}
          pinnedPaths={pinnedPaths}
          onChange={updateFilters}
          onRefreshSource={(source) => void refresh(source)}
          onTogglePin={togglePin}
          onSelectPath={setPathFilter}
          onBrowsePath={() => void choosePath()}
        />
        <section className="rail__footer">
          <button className="button button--quiet" onClick={() => void refresh()} disabled={isRefreshing}>
            <RefreshCcw className={isRefreshing ? "spin" : undefined} size={15} />
            {isRefreshing ? "Refreshing" : "Refresh all"}
          </button>
          <button
            className="icon-button"
            onClick={() => setSettingsOpen(true)}
            title="Settings (⌘,)"
            aria-label="Settings"
          >
            <Settings size={14} />
          </button>
          <p>{snapshot.scannedAt ? `Last scan ${formatRelative(snapshot.scannedAt)}` : "No scan yet"}</p>
        </section>
      </aside>

      <section className="results-pane">
        {window.resumeDevPreview && (
          <div className="dev-banner">
            Browser preview data. Run the Electron app to scan local sessions.
          </div>
        )}
        <div className="searchbar">
          <Search size={17} />
          <div className="searchbar__field">
            {filters.pathFilter && (
              <button
                className="chip"
                onClick={() => setPathFilter(undefined)}
                title="Clear path filter"
              >
                <span className="chip__label">path:{compactPath(filters.pathFilter)}</span>
                <X size={12} />
              </button>
            )}
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={filters.pathFilter ? "Search within this path" : "Search sessions, folders, files, tools, or prompts"}
              aria-label="Search sessions"
            />
          </div>
          <kbd>⌘K</kbd>
        </div>
        {isRefreshing && (
          <div className="refresh-status" role="status" aria-live="polite">
            <RefreshCcw className="spin" size={14} />
            <span>{refreshTarget && refreshTarget !== "all" ? `Refreshing ${SOURCE_LABELS[refreshTarget]}` : "Refreshing all sources"}</span>
            <span className="refresh-status__hint">Scanning local session files and rebuilding the index</span>
          </div>
        )}
        <div className="result-count">
          {formatResultCount(results.length, resultTotal, hasQuery)}
          {filters.pathFilter && (
            <span className="result-count__path"> in {compactPath(filters.pathFilter)}</span>
          )}
        </div>
        <div className="result-list" ref={listRef} tabIndex={0} aria-label="Session results">
          {results.length === 0 ? (
            <EmptyState hasSessions={snapshot.sessions.length > 0} isRefreshing={isRefreshing} />
          ) : groupOrder.map((group) => {
            const sessions = grouped[group];
            return (
              <section className="result-group" key={group}>
                <h2>
                  <span>{group}</span>
                  <span className="result-group__count">{sessions.length}</span>
                </h2>
                {sessions.map(({ session, index: absoluteIndex }) => {
                  return (
                    <button
                      key={session.id}
                      className={`result-row ${absoluteIndex === selectedIndex ? "is-selected" : ""}`}
                      onClick={(event) => {
                        setSelectedIndex(absoluteIndex);
                        event.currentTarget.blur();
                        listRef.current?.focus({ preventScroll: true });
                      }}
                    >
                      <span className={`source-dot source-dot--${session.source}`} />
                      <span className="result-row__body">
                        <span className="result-row__top">
                          <span className="result-row__title">
                            {renderHighlighted(session.title, queryTerms)}
                          </span>
                          <span className="result-row__stats">
                            {session.messageCount} msgs
                            <span className="result-row__sep">·</span>
                            {formatDuration(session.createdAt, session.updatedAt)}
                            <span className="result-row__sep">·</span>
                            {formatRelative(session.updatedAt)}
                          </span>
                        </span>
                        <span className="result-row__meta">
                          {SOURCE_LABELS[session.source]} · {compactPath(session.cwd)}
                        </span>
                        {session.matchSnippet && (
                          <span className="result-row__snippet">
                            {renderHighlighted(session.matchSnippet, queryTerms)}
                          </span>
                        )}
                      </span>
                      {session.hasParseWarnings && <FileWarning className="warning-icon" size={15} aria-label="Parse warnings" />}
                    </button>
                  );
                })}
              </section>
            );
          })}
        </div>
      </section>

      <PreviewPane
        session={selectedSession}
        isLoading={Boolean(selected && !selectedSession)}
        copied={selected?.id === copiedId}
        onCopy={() => selected && void copyCommand(selected)}
      />
      <HelpOverlay open={helpOpen} onClose={() => setHelpOpen(false)} />
      <SettingsView
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSaved={async (nextSnapshot) => {
          setSnapshot(nextSnapshot);
          const requestId = ++searchRequestSeq.current;
          const response = await window.resume.search(query, filters);
          if (requestId !== searchRequestSeq.current) return;
          setResults(response.results);
          setResultTotal(response.total);
          setSelectedIndex(0);
        }}
      />
    </main>
  );
}

function FilterPanel({
  filters,
  health,
  isRefreshing,
  refreshTarget,
  recentPaths,
  pinnedPaths,
  onChange,
  onRefreshSource,
  onTogglePin,
  onSelectPath,
  onBrowsePath
}: {
  filters: SearchFilters;
  health: SourceHealth[];
  isRefreshing: boolean;
  refreshTarget?: SessionSource | "all";
  recentPaths: { path: string; count: number; pinned: boolean }[];
  pinnedPaths: string[];
  onChange: (filters: SearchFilters) => void;
  onRefreshSource: (source: SessionSource) => void;
  onTogglePin: (path: string) => void;
  onSelectPath: (path: string | undefined) => void;
  onBrowsePath: () => void;
}) {
  function moveRover(event: ReactKeyboardEvent<HTMLElement>, axis: "vertical" | "horizontal") {
    const wantPrev = axis === "vertical" ? event.key === "ArrowUp" : event.key === "ArrowLeft";
    const wantNext = axis === "vertical" ? event.key === "ArrowDown" : event.key === "ArrowRight";
    if (!wantPrev && !wantNext) return;
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("[data-rail-item]"));
    if (!items.length) return;
    const active = document.activeElement as HTMLElement | null;
    const currentIdx = active ? items.indexOf(active) : -1;
    const step = wantNext ? 1 : -1;
    const nextIdx = currentIdx === -1
      ? (wantNext ? 0 : items.length - 1)
      : Math.max(0, Math.min(items.length - 1, currentIdx + step));
    event.preventDefault();
    items[nextIdx]?.focus();
  }

  return (
    <div className="filters">
      <section data-rail-group="sources" onKeyDown={(event) => moveRover(event, "vertical")}>
        <h2>Sources</h2>
        {SOURCES.map((source) => {
          const sourceHealth = health.find((item) => item.source === source);
          const active = filters.sources.includes(source);
          return (
            <div className="source-filter" key={source}>
              <label>
                <input
                  type="checkbox"
                  data-rail-item
                  checked={active}
                  onChange={() => {
                    const sources = active
                      ? filters.sources.filter((candidate) => candidate !== source)
                      : [...filters.sources, source];
                    onChange({ ...filters, sources: sources.length ? sources : SOURCES });
                  }}
                />
                <span className={`source-dot source-dot--${source}`} />
                {SOURCE_LABELS[source]}
              </label>
              <button
                className="icon-button"
                title={`Refresh ${SOURCE_LABELS[source]}`}
                onClick={() => onRefreshSource(source)}
                disabled={isRefreshing}
              >
                <RefreshCcw className={isRefreshing && (refreshTarget === "all" || refreshTarget === source) ? "spin" : undefined} size={13} />
              </button>
              <HealthBadge health={sourceHealth} />
            </div>
          );
        })}
      </section>
      <section
        data-rail-group="paths"
        onKeyDown={(event) => {
          moveRover(event, "vertical");
          if (event.key.toLowerCase() === "p" && !event.metaKey && !event.ctrlKey) {
            const focused = document.activeElement as HTMLElement | null;
            const pathAttr = focused?.dataset?.path;
            if (pathAttr) {
              event.preventDefault();
              onTogglePin(pathAttr);
            }
          }
        }}
      >
        <h2>Paths</h2>
        <div className="paths">
          {recentPaths.length === 0 && (
            <p className="paths__hint">Refresh sources to populate paths.</p>
          )}
          {recentPaths.map((entry) => {
            const isActive = filters.pathFilter === entry.path;
            return (
              <div className={`path-row ${isActive ? "is-active" : ""}`} key={entry.path}>
                <button
                  className="path-row__main"
                  data-rail-item
                  data-path={entry.path}
                  onClick={() => onSelectPath(isActive ? undefined : entry.path)}
                  title={entry.path}
                >
                  <span className="path-row__label">{compactPath(entry.path)}</span>
                  <span className="path-row__count">{entry.count}</span>
                </button>
                <button
                  className="icon-button icon-button--pin"
                  onClick={() => onTogglePin(entry.path)}
                  title={entry.pinned ? "Unpin path" : "Pin path"}
                  aria-pressed={entry.pinned}
                >
                  {entry.pinned ? <Pin size={12} /> : <PinOff size={12} />}
                </button>
              </div>
            );
          })}
          {pinnedPaths
            .filter((pinned) => !recentPaths.some((entry) => entry.path === pinned))
            .map((pinned) => {
              const isActive = filters.pathFilter === pinned;
              return (
                <div className={`path-row ${isActive ? "is-active" : ""}`} key={pinned}>
                  <button
                    className="path-row__main"
                    data-rail-item
                    data-path={pinned}
                    onClick={() => onSelectPath(isActive ? undefined : pinned)}
                    title={pinned}
                  >
                    <span className="path-row__label">{compactPath(pinned)}</span>
                    <span className="path-row__count path-row__count--muted">0</span>
                  </button>
                  <button
                    className="icon-button icon-button--pin"
                    onClick={() => onTogglePin(pinned)}
                    title="Unpin path"
                    aria-pressed
                  >
                    <Pin size={12} />
                  </button>
                </div>
              );
            })}
          <button className="path-row path-row--browse" onClick={onBrowsePath} data-rail-item>
            <FolderPlus size={13} />
            Browse…
          </button>
        </div>
      </section>
      <section data-rail-group="date" onKeyDown={(event) => moveRover(event, "horizontal")}>
        <h2>Date</h2>
        <div className="segmented" role="radiogroup" aria-label="Date scope">
          {(["7d", "30d", "90d", "all"] as const).map((scope) => (
            <button
              key={scope}
              data-rail-item
              role="radio"
              aria-checked={filters.dateScope === scope}
              className={filters.dateScope === scope ? "is-active" : ""}
              onClick={() => onChange({ ...filters, dateScope: scope })}
            >
              {scope === "all" ? "All" : scope}
            </button>
          ))}
        </div>
      </section>
      <section data-rail-group="warnings">
        <label className="toggle">
          <input
            type="checkbox"
            data-rail-item
            checked={filters.warningsOnly}
            onChange={(event) => onChange({ ...filters, warningsOnly: event.target.checked })}
          />
          Parse warnings only
        </label>
      </section>
    </div>
  );
}

function HealthBadge({ health }: { health?: SourceHealth }) {
  const label = health?.status === "indexed"
    ? "Indexed"
    : health?.status === "parse_warnings"
      ? "Warnings"
      : health?.status === "needs_permission"
        ? "Permission"
        : health?.status === "disabled"
          ? "Off"
          : "Missing";
  return <span className={`health health--${health?.status ?? "missing_path"}`}>{label}</span>;
}

function PreviewPane({
  session,
  isLoading,
  copied,
  onCopy
}: {
  session?: SessionRecord;
  isLoading: boolean;
  copied: boolean;
  onCopy: () => void;
}) {
  if (!session) {
    return (
      <aside className="preview preview--empty">
        <div>
          <h2>{isLoading ? "Loading session" : "Select a session"}</h2>
          <p>{isLoading ? "Hydrating the full preview." : "Search or use the arrow keys to inspect recent sessions without leaving this window."}</p>
        </div>
      </aside>
    );
  }
  const hasFirstPrompt = Boolean(session.preview.firstPrompt);
  const hasLastPrompt = Boolean(session.preview.lastPrompt) && session.preview.lastPrompt !== session.preview.firstPrompt;
  return (
    <aside className="preview">
      <div className="preview__meta">
        <span className={`source-dot source-dot--${session.source}`} />
        <span>{SOURCE_LABELS[session.source]}</span>
        <span className="preview__sep">·</span>
        <span title={formatDate(session.updatedAt)}>{formatRelative(session.updatedAt)}</span>
        <span className="preview__sep">·</span>
        <span>{session.messageCount} messages</span>
      </div>
      <h2 className="preview__title">{session.title}</h2>
      <p className="preview__cwd">{compactPath(session.cwd) || "No working directory recorded"}</p>

      {hasFirstPrompt && (
        <section className="prompt-hero">
          <span className="prompt-hero__eyebrow">First prompt</span>
          <blockquote>{session.preview.firstPrompt}</blockquote>
        </section>
      )}

      {hasLastPrompt && (
        <section className="prompt-secondary">
          <span className="prompt-secondary__eyebrow">Last prompt</span>
          <p>{session.preview.lastPrompt}</p>
        </section>
      )}

      <FileTreeSection paths={session.preview.files} />

      {session.preview.tools.length > 0 && (
        <section className="preview-section">
          <h3>Tools</h3>
          <div className="tags">
            {session.preview.tools.map((tool) => <span key={tool}>{tool}</span>)}
          </div>
        </section>
      )}

      {session.preview.warnings.length > 0 && (
        <section className="preview-section">
          <h3>Warnings</h3>
          <div className="tags tags--warning">
            {session.preview.warnings.map((warning) => <span key={warning}>{warning}</span>)}
          </div>
        </section>
      )}

      <section className="preview-section">
        <h3>Transcript</h3>
        <div className="transcript">
          {session.preview.transcript.map((snippet, index) => (
            <article key={`${snippet.role}-${index}`}>
              <span>{snippet.role}</span>
              <p>{snippet.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="resume-strip">
        <button
          type="button"
          className="resume-strip__button"
          onClick={onCopy}
          title="Copy resume command"
        >
          <code>{session.resumeCommand}</code>
          <span className="resume-strip__hint">
            {copied ? <><Check size={13} /> Copied</> : <><Clipboard size={13} /> Copy</>}
          </span>
        </button>
      </section>
    </aside>
  );
}

type FileNode = { name: string; path: string; children: Map<string, FileNode>; isFile: boolean };

function FileTreeSection({ paths }: { paths: string[] }) {
  if (!paths.length) return null;
  const root = buildFileTree(paths);
  return (
    <section className="preview-section">
      <h3>
        Files
        <span className="preview-section__count">{paths.length}</span>
      </h3>
      <ul className="file-tree" role="tree">
        {renderTreeChildren(root, 0)}
      </ul>
    </section>
  );
}

function buildFileTree(paths: string[]): FileNode {
  const root: FileNode = { name: "", path: "", children: new Map(), isFile: false };
  for (const raw of [...new Set(paths)].sort()) {
    const segments = raw.split("/").filter(Boolean);
    if (!segments.length) continue;
    let cursor = root;
    segments.forEach((segment, idx) => {
      const isLast = idx === segments.length - 1;
      const accumulated = segments.slice(0, idx + 1).join("/");
      const existing = cursor.children.get(segment);
      if (existing) {
        if (isLast) existing.isFile = existing.isFile || true;
        cursor = existing;
      } else {
        const node: FileNode = { name: segment, path: accumulated, children: new Map(), isFile: isLast };
        cursor.children.set(segment, node);
        cursor = node;
      }
    });
  }
  return root;
}

function renderTreeChildren(node: FileNode, depth: number) {
  const entries = Array.from(node.children.values()).sort((a, b) => {
    const aDir = a.children.size > 0 ? 0 : 1;
    const bDir = b.children.size > 0 ? 0 : 1;
    if (aDir !== bDir) return aDir - bDir;
    return a.name.localeCompare(b.name);
  });
  return entries.map((entry) => {
    const { displayName, tail } = compactChain(entry);
    const isDir = tail.children.size > 0;
    return (
      <li key={tail.path} role="treeitem" className={isDir ? "file-tree__dir" : "file-tree__file"}>
        <span className="file-tree__row" style={{ paddingLeft: `${depth * 12}px` }}>
          <span className="file-tree__glyph" aria-hidden>{isDir ? "▸" : "·"}</span>
          <span className="file-tree__name">{displayName}{isDir ? "/" : ""}</span>
        </span>
        {isDir && <ul role="group">{renderTreeChildren(tail, depth + 1)}</ul>}
      </li>
    );
  });
}

function compactChain(node: FileNode): { displayName: string; tail: FileNode } {
  const parts: string[] = [node.name];
  let cursor = node;
  while (cursor.children.size === 1) {
    const only = cursor.children.values().next().value as FileNode;
    parts.push(only.name);
    cursor = only;
  }
  return { displayName: parts.join("/"), tail: cursor };
}

function EmptyState({ hasSessions, isRefreshing }: { hasSessions: boolean; isRefreshing: boolean }) {
  if (isRefreshing) {
    return (
      <div className="empty-state">
        <RefreshCcw className="spin" size={20} />
        <h2>Refreshing sessions</h2>
        <p>Scanning local Codex, Claude, Amp, and Pi files.</p>
      </div>
    );
  }

  return (
    <div className="empty-state">
      <h2>{hasSessions ? "No matching sessions" : "No sessions indexed"}</h2>
      <p>{hasSessions ? "Adjust the search or filters." : "Refresh all sources to scan the default local session paths."}</p>
    </div>
  );
}

function buildPathCounts(
  sessions: SessionListItem[],
  filters: SearchFilters
): Map<string, { count: number; latest: string }> {
  const cutoff = dateScopeCutoffClient(filters.dateScope);
  const sourceSet = new Set(filters.sources);
  const counts = new Map<string, { count: number; latest: string }>();
  for (const session of sessions) {
    if (!session.cwd) continue;
    if (!sourceSet.has(session.source)) continue;
    if (cutoff && new Date(session.updatedAt) < cutoff) continue;
    const key = normalizePath(session.cwd);
    const existing = counts.get(key);
    if (!existing) {
      counts.set(key, { count: 1, latest: session.updatedAt });
    } else {
      existing.count += 1;
      if (session.updatedAt > existing.latest) existing.latest = session.updatedAt;
    }
  }
  return counts;
}

function buildRecentPaths(
  counts: Map<string, { count: number; latest: string }>,
  pinned: string[]
): { path: string; count: number; pinned: boolean }[] {
  const pinnedSet = new Set(pinned);
  const entries = Array.from(counts.entries()).map(([path, value]) => ({
    path,
    count: value.count,
    latest: value.latest,
    pinned: pinnedSet.has(path)
  }));
  entries.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.latest.localeCompare(a.latest);
  });
  const pinnedEntries = entries.filter((entry) => entry.pinned);
  const unpinned = entries.filter((entry) => !entry.pinned).slice(0, MAX_RECENT_PATHS - pinnedEntries.length);
  return [...pinnedEntries, ...unpinned].map(({ path, count, pinned }) => ({ path, count, pinned }));
}

type GroupedResult = { session: SessionSearchHit; index: number };

function groupByRecency(results: SessionSearchHit[]): Record<string, GroupedResult[]> {
  const buckets: Record<string, SessionSearchHit[]> = {};
  const order: string[] = [];
  for (const result of results) {
    const label = recencyLabel(result.updatedAt);
    if (!buckets[label]) {
      buckets[label] = [];
      order.push(label);
    }
    buckets[label].push(result);
  }
  const groups: Record<string, GroupedResult[]> = {};
  let renderIndex = 0;
  for (const label of order) {
    groups[label] = buckets[label].map((session) => ({ session, index: renderIndex++ }));
  }
  return groups;
}

function formatResultCount(visible: number, total: number, hasQuery: boolean): string {
  const noun = hasQuery ? "matches" : "sessions";
  if (total > visible) return `${visible.toLocaleString()} of ${total.toLocaleString()} ${noun}`;
  return `${visible.toLocaleString()} ${noun}`;
}

function recencyLabel(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const days = Math.floor((now.getTime() - date.getTime()) / 86_400_000);
  if (days <= 1) return "Today";
  if (days <= 7) return "This week";
  if (days <= 30) return "This month";
  return "Older";
}

function formatRelative(iso?: string): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(iso));
}

function formatDuration(startIso: string, endIso: string): string {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  if (hours < 24) return rem ? `${hours}h ${rem}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

function compactPath(value: string): string {
  if (!value) return "Unknown path";
  return value.replace(/^\/Users\/[^/]+/, "~");
}

function normalizePath(value: string): string {
  return value.replace(/\/+$/, "");
}

function dateScopeCutoffClient(scope: SearchFilters["dateScope"]): Date | undefined {
  if (scope === "all") return undefined;
  const days = scope === "7d" ? 7 : scope === "30d" ? 30 : 90;
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

function extractTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2);
}

function renderHighlighted(text: string, terms: string[]) {
  if (!terms.length || !text) return text;
  const escaped = terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`(${escaped.join("|")})`, "gi");
  const termSet = new Set(terms);
  const parts = text.split(pattern);
  return parts.map((part, index) =>
    part && termSet.has(part.toLowerCase())
      ? <mark key={index} className="match">{part}</mark>
      : <span key={index}>{part}</span>
  );
}
