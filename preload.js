// Preload 스크립트
// contextBridge를 사용하여 렌더러와 메인 프로세스 간 안전한 통신

const { contextBridge, ipcRenderer } = require('electron');

// 렌더러 프로세스에서 사용할 API 노출
contextBridge.exposeInMainWorld('enrollAPI', {
  submit: (data) => ipcRenderer.invoke('enroll:submit', data),
  skip: () => ipcRenderer.send('enroll:skip'),
  complete: () => ipcRenderer.send('enroll:complete')
});

