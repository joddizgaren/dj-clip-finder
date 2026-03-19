const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  onUpdateAvailable: (cb) => {
    ipcRenderer.on("update-available", cb);
    return () => ipcRenderer.removeListener("update-available", cb);
  },
  onUpdateDownloaded: (cb) => {
    ipcRenderer.on("update-downloaded", cb);
    return () => ipcRenderer.removeListener("update-downloaded", cb);
  },
  installUpdate: () => ipcRenderer.send("install-update"),

  // Deep-link handler — called when the app is opened via a djclipstudio://
  // URL (e.g. a Supabase password-recovery email link).
  onDeepLink: (cb) => {
    const listener = (_event, url) => cb(url);
    ipcRenderer.on("deep-link", listener);
    return () => ipcRenderer.removeListener("deep-link", listener);
  },
});
