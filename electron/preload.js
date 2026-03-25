const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  onUpdateAvailable: (cb) => {
    const listener = (_event, version) => cb(version);
    ipcRenderer.on("update-available", listener);
    return () => ipcRenderer.removeListener("update-available", listener);
  },
  onDownloadProgress: (cb) => {
    const listener = (_event, percent) => cb(percent);
    ipcRenderer.on("download-progress", listener);
    return () => ipcRenderer.removeListener("download-progress", listener);
  },
  onUpdateDownloaded: (cb) => {
    ipcRenderer.on("update-downloaded", cb);
    return () => ipcRenderer.removeListener("update-downloaded", cb);
  },
  onUpdateError: (cb) => {
    const listener = (_event, msg) => cb(msg);
    ipcRenderer.on("update-error", listener);
    return () => ipcRenderer.removeListener("update-error", listener);
  },
  downloadUpdate: () => ipcRenderer.send("download-update"),
  installUpdate: () => ipcRenderer.send("install-update"),

  // Deep-link handler — called when the app is opened via a djclipstudio://
  // URL (e.g. a Supabase password-recovery email link).
  onDeepLink: (cb) => {
    const listener = (_event, url) => cb(url);
    ipcRenderer.on("deep-link", listener);
    return () => ipcRenderer.removeListener("deep-link", listener);
  },
});
