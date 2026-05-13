import { app, BrowserWindow, Menu, clipboard, dialog, ipcMain, nativeTheme } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSessionService } from "./sessionService.js";
import { AppCache } from "./store/cache.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.env.RESUME_DEV === "1";
const appIconPath = app.isPackaged
  ? path.join(process.resourcesPath, "app-icon.png")
  : path.join(__dirname, "../../../app-icon.png");
let mainWindow: BrowserWindow | undefined;
let service: ReturnType<typeof createSessionService>;
let prefsCache: AppCache;

app.setName("Resume");

if (process.platform === "darwin") {
  app.whenReady().then(() => {
    app.dock?.setIcon(appIconPath);
    const appName = "Resume";
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: appName,
          submenu: [
            { role: "about" },
            { type: "separator" },
            { role: "services" },
            { type: "separator" },
            { role: "hide", label: `Hide ${appName}` },
            { role: "hideOthers" },
            { role: "unhide" },
            { type: "separator" },
            { role: "quit", label: `Quit ${appName}` }
          ]
        },
        { role: "editMenu" },
        { role: "viewMenu" },
        { role: "windowMenu" }
      ])
    );
  });
}

async function createWindow(): Promise<void> {
  const userData = app.getPath("userData");
  service = createSessionService(userData);
  prefsCache = new AppCache(path.join(userData, "cache"));
  await service.initialize();

  mainWindow = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 980,
    minHeight: 620,
    title: "Resume",
    icon: appIconPath,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#151411" : "#f4f1ea",
    trafficLightPosition: { x: 14, y: 14 },
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (isDev) {
    await mainWindow.loadURL("http://127.0.0.1:5173");
  } else {
    await mainWindow.loadFile(path.join(__dirname, "../../renderer/index.html"));
  }
}

ipcMain.handle("sessions:getSnapshot", () => service.getSnapshot());
ipcMain.handle("sessions:refresh", (_event, source?: string) => service.refresh(source));
ipcMain.handle("sessions:search", (_event, query: string, filters = {}, options = {}) => service.search(query, filters, options));
ipcMain.handle("sessions:get", (_event, id: string) => service.getSession(id));
ipcMain.handle("clipboard:copyResumeCommand", (_event, command: string) => {
  clipboard.writeText(command);
});
ipcMain.handle("paths:choose", async () => {
  const target = mainWindow ?? BrowserWindow.getFocusedWindow();
  const result = target
    ? await dialog.showOpenDialog(target, { properties: ["openDirectory"] })
    : await dialog.showOpenDialog({ properties: ["openDirectory"] });
  if (result.canceled || result.filePaths.length === 0) return undefined;
  return result.filePaths[0];
});
ipcMain.handle("paths:getPreferences", () => prefsCache.readPathPreferences());
ipcMain.handle("paths:savePreferences", async (_event, prefs) => {
  await prefsCache.writePathPreferences(prefs);
  service.applySettings(prefs);
  return service.refresh();
});
ipcMain.handle("window:hide", () => {
  const target = mainWindow ?? BrowserWindow.getFocusedWindow();
  target?.hide();
});

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  const windows = BrowserWindow.getAllWindows();
  if (windows.length === 0) {
    void createWindow();
    return;
  }
  const target = mainWindow ?? windows[0];
  if (!target.isVisible()) target.show();
  target.focus();
});
