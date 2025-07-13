const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

let mainWindow;

function createWindow() {
  // 메인 윈도우 생성
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    },
    icon: path.join(__dirname, 'assets', 'icon.png'),
    title: '시럽조제기 연결 관리자',
    show: false,
    autoHideMenuBar: true,
    menuBarVisible: false
  });

  // 윈도우가 준비되면 표시하고 최대화
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.maximize(); // 앱 시작 시 최대화
  });

  // HTML 파일 로드
  mainWindow.loadFile('index.html');

  // 개발 모드에서 DevTools 열기
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  // 윈도우가 닫힐 때 앱 종료
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// 앱이 준비되면 윈도우 생성
app.whenReady().then(() => {
  // 메뉴바 완전 제거
  Menu.setApplicationMenu(null);
  createWindow();
});

// 모든 윈도우가 닫히면 앱 종료
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// IPC 핸들러들
ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  return result.filePaths[0];
});

ipcMain.handle('get-network-info', async () => {
  try {
    const interfaces = os.networkInterfaces();
    for (const [name, nets] of Object.entries(interfaces)) {
      for (const net of nets) {
        // IPv4이고 로컬호스트가 아닌 인터페이스 찾기
        if (net.family === 'IPv4' && !net.internal) {
          const ipParts = net.address.split('.');
          const prefix = ipParts.slice(0, 3).join('.') + '.';
          return {
            interface: name,
            address: net.address,
            prefix: prefix,
            netmask: net.netmask
          };
        }
      }
    }
    return null;
  } catch (error) {
    console.error('네트워크 정보 가져오기 실패:', error);
    return null;
  }
});

ipcMain.handle('show-message', async (event, options) => {
  const { type, title, message } = options;
  const dialogOptions = {
    type: type || 'info',
    title: title || '알림',
    message: message || '',
    buttons: ['확인']
  };
  
  const result = await dialog.showMessageBox(mainWindow, dialogOptions);
  return result.response;
});

ipcMain.handle('show-error', async (event, message) => {
  const result = await dialog.showErrorBox('오류', message);
  return result;
}); 