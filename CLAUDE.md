# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Local-first Electron + React (Mac) utility that indexes past sessions from multiple AI coding assistants (Codex, Claude, Amp, Pi) and lets the user search them and copy a shell command to resume one. Treated as a Spotlight/Raycast-style reference utility — opened with a goal, closed within seconds.

## Commands

- `pnpm dev` — builds the main process (`tsconfig.main.json`), starts Vite on `127.0.0.1:5173`, then launches Electron with `RESUME_DEV=1` pointing at the dev URL.
- `pnpm build` — full production build: main process via `tsc -p tsconfig.main.json` (emits to `dist/`) plus renderer via `vite build` (emits to `dist/renderer`). The preload is a `.cjs` file copied verbatim by `build:main`.
- `pnpm start` — runs Electron against the built `dist/` output.
- `pnpm test` / `pnpm test:watch` — Vitest (jsdom env, globals enabled). Run a single test with `pnpm test -- <pattern>` or `pnpm test -- tests/main/search.test.ts -t "name"`.
- `pnpm lint` — typecheck only; runs `tsc --noEmit` for the renderer config and again for `tsconfig.main.json`. There is no ESLint.

The package manager is pnpm (lockfile committed).

## Architecture

Three TS surfaces with separate tsconfigs:

- **`src/main/`** — Electron main process. `main.ts` wires IPC handlers (`sessions:*`, `clipboard:*`, `paths:*`) to a single `SessionService`. Compiled with `tsconfig.main.json` to NodeNext modules in `dist/`. Note that `src/main/preload.cjs` is hand-written CommonJS and is *copied*, not transpiled — `preload.ts` exists only to export the `ResumeApi` type for the renderer.
- **`src/renderer/`** — React 19 + Vite. Talks to main only through `window.resume` (typed in `global.d.ts` from the preload's exported type). `devApi.ts` provides a fallback when running outside Electron.
- **`src/shared/`** — types and small pure helpers (`shell.ts` for `shellQuote`/`cdPrefix`) imported by both sides. Both tsconfigs include this directory.

### Data flow

1. `SessionService.initialize()` reads a cached `AppSnapshot` and serialized MiniSearch index from `app.getPath("userData")/cache/` (`AppCache`). If the index is missing it's rebuilt from the cached sessions.
2. `refresh(source?)` runs the four adapters (`codex`, `claude`, `amp`, `pi`) in parallel against `defaultRoots()` (overridable per-source). Each adapter returns an `AdapterScanResult` with records + warning/permission/missing-path signals.
3. Results replace the in-memory sessions for that source, are merged into health, sorted by `updatedAt` desc, persisted, and the MiniSearch index is rebuilt.
4. `search(query, filters)` filters by source/dateScope/warningsOnly/pathFilter first, then either returns by-recency (empty query) or runs MiniSearch with `prefix: true, fuzzy: 0.15` and boosts on `title`/`cwd`.

### Adapter contract

Each source has its own parser in `src/main/adapters/<source>.ts` implementing `Adapter` from `common.ts`. Shared utilities in `common.ts` handle: directory walking, JSONL/JSON parsing with per-line warnings, role/text extraction from heterogeneous message shapes (`textFromUnknown`), file-mention regex extraction, preview construction (`buildPreview`), and per-source resume-command builders (`codexResume`, `claudeResume`, `ampResume`, `piResume`). When adding a new source: add an adapter, register it in `adapters/index.ts`, extend `SessionSource` + `defaultRoots()` + the health fallback list in `sessionService.ts`, and add a fixture under `tests/fixtures/<source>/`.

`indexedText` (built by `buildIndexedText`) is the field MiniSearch tokenises — keep it bounded (per-entry `truncateText` to 2400 chars, skip base64-looking blobs via `isIndexableText`) so the serialized index stays small.

### Renderer ↔ main boundary

The renderer never touches the filesystem. All session data, path picking, preferences, and clipboard writes go through the IPC surface declared in `preload.ts` and exposed as `window.resume`. When adding an IPC channel: register `ipcMain.handle` in `main.ts`, add a typed wrapper in `preload.ts`, and the renderer type updates automatically via `ResumeApi`.

## Design constraints

`.impeccable.md` is the source of truth for visual design (Linear-style monochrome + single indigo accent, Geist/Geist Mono, hairline borders, keyboard-first, both light and dark themes first-class, `prefers-reduced-motion` respected). Read it before making UI changes — the aesthetic is opinionated and the anti-references list matters.
