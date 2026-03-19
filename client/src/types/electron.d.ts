interface ElectronAPI {
  onUpdateAvailable: (cb: () => void) => () => void;
  onUpdateDownloaded: (cb: () => void) => () => void;
  installUpdate: () => void;
  onDeepLink: (cb: (url: string) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
