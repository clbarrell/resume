import { contextBridge, ipcRenderer } from "electron";
import type { AppSnapshot, PathPreferences, SearchFilters, SearchOptions, SearchResponse, SessionRecord } from "../shared/types.js";

const api = {
  getSnapshot: () => ipcRenderer.invoke("sessions:getSnapshot") as Promise<AppSnapshot>,
  refresh: (source?: string) => ipcRenderer.invoke("sessions:refresh", source) as Promise<AppSnapshot>,
  search: (query: string, filters: Partial<SearchFilters>, options?: SearchOptions) =>
    ipcRenderer.invoke("sessions:search", query, filters, options) as Promise<SearchResponse>,
  getSession: (id: string) => ipcRenderer.invoke("sessions:get", id) as Promise<SessionRecord | undefined>,
  copyResumeCommand: (command: string) => ipcRenderer.invoke("clipboard:copyResumeCommand", command) as Promise<void>,
  choosePath: () => ipcRenderer.invoke("paths:choose") as Promise<string | undefined>,
  getPathPreferences: () => ipcRenderer.invoke("paths:getPreferences") as Promise<PathPreferences>,
  savePathPreferences: (prefs: PathPreferences) => ipcRenderer.invoke("paths:savePreferences", prefs) as Promise<AppSnapshot>,
  hideWindow: () => ipcRenderer.invoke("window:hide") as Promise<void>
};

contextBridge.exposeInMainWorld("resume", api);

export type ResumeApi = typeof api;
