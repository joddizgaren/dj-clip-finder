interface ElectronAPI {
  onUpdateAvailable: (cb: (version: string) => void) => () => void;
  onDownloadProgress: (cb: (percent: number) => void) => () => void;
  onUpdateDownloaded: (cb: () => void) => () => void;
  onUpdateError: (cb: (msg: string) => void) => () => void;
  downloadUpdate: () => void;
  installUpdate: () => void;
  onDeepLink: (cb: (url: string) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
