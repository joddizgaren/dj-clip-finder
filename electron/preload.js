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
});
