const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('botApp', {
  getState: () => ipcRenderer.invoke('app:get-state'),
  updateConfig: (patch) => ipcRenderer.invoke('app:update-config', patch),
  onLog: (listener) => {
    ipcRenderer.on('bot-log', (_event, line) => listener(line));
  }
});
