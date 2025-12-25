const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
    restartServer: () => ipcRenderer.invoke('restart-server'),
    getServerPort: () => ipcRenderer.invoke('get-server-port'),
    openProjectWindow: (projectPath) => ipcRenderer.invoke('open-project-window', projectPath),
    selectFolder: () => ipcRenderer.invoke('select-folder'),
});
