const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('cortioNative', {
  isDesktop: true,
  downloadYoutube: (url) => ipcRenderer.invoke('youtube-download', url),
  onYoutubeProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('youtube-progress', handler);
    return () => ipcRenderer.removeListener('youtube-progress', handler);
  },
  exportStart: (name) => ipcRenderer.invoke('export-start', name),
  exportChunk: (chunk) => ipcRenderer.invoke('export-chunk', chunk),
  exportFinish: (meta) => ipcRenderer.invoke('export-finish', meta),
  exportCancel: () => ipcRenderer.invoke('export-cancel'),
  onExportProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('export-progress', handler);
    return () => ipcRenderer.removeListener('export-progress', handler);
  }
});
