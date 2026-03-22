import { app, BrowserWindow, shell, dialog, ipcMain, utilityProcess, Menu } from "electron";
import { autoUpdater } from "electron-updater";
import path from "path";
import * as fs from "fs";
import * as net from "net";

// __dirname is available in the CJS output that esbuild produces from this file
declare const __dirname: string;

const PORT = 5001;
const PROTOCOL = "djclipstudio";

let mainWindow: BrowserWindow | null = null;
let serverProcess: ReturnType<typeof utilityProcess.fork> | null = null;

// ─── Paths ────────────────────────────────────────────────────────────────────

function getClipsDir(): string {
  const dir = path.join(app.getPath("userData"), "clips");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getSqliteDbPath(): string {
  return path.join(app.getPath("userData"), "djclipstudio.db");
}

function getFfmpegDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "ffmpeg")
    : path.join(__dirname, "..", "electron", "ffmpeg");
}

function getServerPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "server-bundle.js")
    : path.join(__dirname, "..", "dist", "electron", "server-bundle.js");
}

function getPublicPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "public")
    : path.join(__dirname, "..", "dist", "electron", "public");
}

// ─── Server ───────────────────────────────────────────────────────────────────

function getLogPath(): string {
  return path.join(app.getPath("userData"), "server.log");
}

function startServer(): void {
  const serverPath = getServerPath();
  const logPath = getLogPath();

  // Clear previous log
  try { fs.writeFileSync(logPath, `=== DJ Clip Studio server log ===\nStarted: ${new Date().toISOString()}\nserverPath: ${serverPath}\npublicPath: ${getPublicPath()}\ndbPath: ${getSqliteDbPath()}\nclipsDir: ${getClipsDir()}\nffmpegDir: ${getFfmpegDir()}\nport: ${PORT}\n\n`); } catch {}

  if (!fs.existsSync(serverPath)) {
    const msg = `Could not find:\n${serverPath}\n\nLog: ${logPath}`;
    dialog.showErrorBox("Server not found", msg);
    app.quit();
    return;
  }

  serverProcess = utilityProcess.fork(serverPath, [], {
    // --experimental-sqlite enables the built-in node:sqlite module on Node.js 22.x.
    // On Node.js 23+ (where sqlite is stable) this flag is silently accepted.
    execArgv: ["--experimental-sqlite"],
    env: {
      ...process.env,
      ELECTRON_APP: "true",
      SQLITE_DB_PATH: getSqliteDbPath(),
      CLIPS_DIR: getClipsDir(),
      FFMPEG_BIN_DIR: getFfmpegDir(),
      ELECTRON_PUBLIC_PATH: getPublicPath(),
      PORT: String(PORT),
      NODE_ENV: "production",
    },
    stdio: "pipe",
  });

  const logStream = fs.createWriteStream(logPath, { flags: "a" });

  serverProcess.stdout?.on("data", (d: Buffer) => {
    const msg = d.toString();
    process.stdout.write("[server] " + msg);
    logStream.write("[stdout] " + msg);
  });
  serverProcess.stderr?.on("data", (d: Buffer) => {
    const msg = d.toString();
    process.stderr.write("[server] " + msg);
    logStream.write("[stderr] " + msg);
  });
  serverProcess.on("exit", (code: number) => {
    const msg = `[server] exited with code ${code}\n`;
    console.log(msg);
    logStream.write(msg);
    logStream.end();
  });
}

function waitForServer(timeout = 30_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeout;
    const attempt = () => {
      const client = net.connect(PORT, "127.0.0.1", () => {
        client.destroy();
        resolve();
      });
      client.on("error", () => {
        client.destroy();
        if (Date.now() > deadline) {
          reject(new Error(`Server did not start within ${timeout / 1000}s`));
          return;
        }
        setTimeout(attempt, 400);
      });
    };
    attempt();
  });
}

// ─── Window ───────────────────────────────────────────────────────────────────

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    title: "DJ Clip Studio",
    backgroundColor: "#0f0f11",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(`http://localhost:${PORT}`)) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());
  await mainWindow.loadURL(`http://localhost:${PORT}`);
}

// ─── Deep link helper ─────────────────────────────────────────────────────────

function sendDeepLink(url: string): void {
  if (!mainWindow) return;
  if (mainWindow.webContents.isLoading()) {
    mainWindow.webContents.once("did-finish-load", () =>
      mainWindow?.webContents.send("deep-link", url)
    );
  } else {
    mainWindow.webContents.send("deep-link", url);
  }
}

// ─── Auto-updater ────────────────────────────────────────────────────────────

function setupAutoUpdater(): void {
  autoUpdater.setFeedURL({
    provider: "github",
    owner: "joddizgaren",
    repo: "dj-clip-finder",
    private: false,
  });

  // Write all updater events to a dedicated log so errors are visible.
  const updaterLog = path.join(app.getPath("userData"), "updater.log");
  const logUpdater = (msg: string) => {
    try {
      fs.appendFileSync(updaterLog, `[${new Date().toISOString()}] ${msg}\n`);
    } catch {}
  };

  autoUpdater.on("checking-for-update", () => logUpdater("Checking for update…"));
  autoUpdater.on("update-not-available", () => logUpdater("No update available."));
  autoUpdater.on("update-available", (info) => {
    logUpdater(`Update available: ${info.version}`);
    mainWindow?.webContents.send("update-available");
  });
  autoUpdater.on("download-progress", (p) => {
    logUpdater(`Downloading: ${Math.round(p.percent)}%`);
  });
  autoUpdater.on("update-downloaded", (info) => {
    logUpdater(`Update downloaded: ${info.version}`);
    mainWindow?.webContents.send("update-downloaded");
  });
  autoUpdater.on("error", (err: Error) => {
    logUpdater(`ERROR: ${err.message}`);
  });

  setTimeout(
    () => autoUpdater.checkForUpdatesAndNotify().catch((e) => logUpdater(`checkForUpdates threw: ${e}`)),
    10_000
  );
}

ipcMain.on("install-update", () => autoUpdater.quitAndInstall());

// ─── Single-instance lock ─────────────────────────────────────────────────────
// Ensures only one instance of the app runs. If a second instance is started
// (e.g. by clicking a djclipstudio:// link when the app is already open),
// we bring the existing window to the front and pass the deep-link URL to it.

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  // Another instance is already running — hand off and exit.
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    const deepLink = argv.find((arg) => arg.startsWith(`${PROTOCOL}://`));
    if (deepLink) sendDeepLink(deepLink);
  });

  // ─── App lifecycle ──────────────────────────────────────────────────────────

  app.whenReady().then(async () => {
    // Remove the default File/Edit/View/Window/Help menu bar.
    Menu.setApplicationMenu(null);

    // Register the custom URL protocol (belt-and-suspenders alongside the
    // registry entries that electron-builder writes during install).
    app.setAsDefaultProtocolClient(PROTOCOL);

    // If the app was launched cold by clicking a djclipstudio:// link,
    // the URL appears as a command-line argument.
    const coldDeepLink = process.argv.find((arg) =>
      arg.startsWith(`${PROTOCOL}://`)
    );

    startServer();

    try {
      await waitForServer();
    } catch (err) {
      const _lp = path.join(app.getPath("userData"), "server.log");
      dialog.showErrorBox(
        "Startup failed",
        String(err) + "\n\nLog file:\n" + _lp + "\n\nOpen that file to see the exact error."
      );
      app.quit();
      return;
    }

    await createWindow();

    if (coldDeepLink) sendDeepLink(coldDeepLink);

    if (app.isPackaged) setupAutoUpdater();
  });

  app.on("window-all-closed", () => {
    serverProcess?.kill();
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", () => {
    serverProcess?.kill();
  });

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow();
  });
}
