const { contextBridge, ipcRenderer } = require("electron");

const api = {
  getSnapshot: () => ipcRenderer.invoke("sessions:getSnapshot"),
  refresh: (source) => ipcRenderer.invoke("sessions:refresh", source),
  search: (query, filters, options) => ipcRenderer.invoke("sessions:search", query, filters, options),
  getSession: (id) => ipcRenderer.invoke("sessions:get", id),
  copyResumeCommand: (command) => ipcRenderer.invoke("clipboard:copyResumeCommand", command),
  choosePath: () => ipcRenderer.invoke("paths:choose"),
  getPathPreferences: () => ipcRenderer.invoke("paths:getPreferences"),
  savePathPreferences: (prefs) => ipcRenderer.invoke("paths:savePreferences", prefs),
  hideWindow: () => ipcRenderer.invoke("window:hide")
};

contextBridge.exposeInMainWorld("resume", api);
