const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const os = require('os');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

// keytar는 런타임에만 로드 (빌드 오류 방지)
let keytar;
try {
  keytar = require('keytar');
} catch (err) {
  console.warn('⚠️ keytar를 로드할 수 없습니다. 토큰은 파일로 저장됩니다.');
}

const APP_ID = 'kr.pharmcoder.prescription'; // package.json build.appId와 반드시 동일

// ⚠️ Windows 작업표시줄 아이콘/토스트/점프리스트 일관성을 위해 AppID를 가장 먼저 지정
app.setAppUserModelId(APP_ID);

let mainWindow;
let enrollWindow;
const isDev = !app.isPackaged;

// ============================================
// 인증 관련 설정
// ============================================
const SERVICE_NAME = 'AutoSyrupLink';
const ACCOUNT_NAME = 'device-token';
const API_BASE = 'https://autosyrup-backend.onrender.com';
const TOKEN_FILE = path.join(app.getPath('userData'), 'auth-token.txt');
const DEVICE_UID_FILE = path.join(app.getPath('userData'), 'device-uid.txt');
const PHARMACY_STATUS_FILE = path.join(app.getPath('userData'), 'pharmacy-status.txt');

let deviceUid = '';
let authToken = '';

// ============================================
// 인증 관련 함수
// ============================================

// 디바이스 UID 가져오기 또는 생성
async function getOrCreateDeviceUid() {
  if (deviceUid) return deviceUid;

  try {
    if (fs.existsSync(DEVICE_UID_FILE)) {
      deviceUid = fs.readFileSync(DEVICE_UID_FILE, 'utf8').trim();
    } else {
      deviceUid = uuidv4();
      fs.writeFileSync(DEVICE_UID_FILE, deviceUid, 'utf8');
    }
    return deviceUid;
  } catch (error) {
    console.error('디바이스 UID 생성/로드 오류:', error);
    deviceUid = uuidv4();
    return deviceUid;
  }
}

// 토큰 가져오기 (keytar 우선, 실패 시 파일)
async function getToken() {
  if (authToken) return authToken;

  try {
    // keytar 사용 시도
    if (keytar) {
      const token = await keytar.getPassword(SERVICE_NAME, ACCOUNT_NAME);
      if (token) {
        authToken = token;
        return token;
      }
    }
    
    // keytar 실패 시 파일에서 읽기
    if (fs.existsSync(TOKEN_FILE)) {
      authToken = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
      return authToken;
    }
  } catch (error) {
    console.error('토큰 로드 오류:', error);
  }
  
  return null;
}

// 토큰 저장하기 (keytar 우선, 실패 시 파일)
async function saveToken(token) {
  authToken = token;
  
  try {
    // keytar 사용 시도
    if (keytar) {
      await keytar.setPassword(SERVICE_NAME, ACCOUNT_NAME, token);
      console.log('✅ 토큰이 keytar에 안전하게 저장되었습니다.');
    }
  } catch (error) {
    console.warn('⚠️ keytar 저장 실패, 파일로 저장합니다:', error);
  }
  
  // 파일에도 백업 저장
  try {
    fs.writeFileSync(TOKEN_FILE, token, 'utf8');
    console.log('✅ 토큰이 파일에 저장되었습니다.');
  } catch (error) {
    console.error('❌ 토큰 파일 저장 실패:', error);
  }
}

// 토큰 삭제하기
async function deleteToken() {
  authToken = '';
  
  try {
    if (keytar) {
      await keytar.deletePassword(SERVICE_NAME, ACCOUNT_NAME);
    }
  } catch (error) {
    console.warn('keytar 토큰 삭제 실패:', error);
  }
  
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      fs.unlinkSync(TOKEN_FILE);
    }
  } catch (error) {
    console.warn('토큰 파일 삭제 실패:', error);
  }
}

// 약국 등록
async function enrollPharmacy(payload) {
  try {
    const deviceUid = await getOrCreateDeviceUid();
    
    const enrollData = {
      ...payload,
      device: {
        device_uid: deviceUid,
        platform: os.platform(),
        app_version: app.getVersion()
      }
    };

    console.log('📤 약국 등록 요청:', enrollData);

    const response = await axios.post(`${API_BASE}/v1/auth/enroll`, enrollData, {
      timeout: 10000,
      headers: { 'Content-Type': 'application/json' }
    });

    if (response.data && response.data.access_token) {
      await saveToken(response.data.access_token);
      console.log('✅ 약국 등록 완료:', response.data.pharmacy);
      
      // 등록 후 상태 저장 (pending)
      savePharmacyStatus(response.data.pharmacy?.status || 'pending');
      
      return { success: true, data: response.data };
    } else {
      throw new Error('서버 응답에 토큰이 없습니다.');
    }
  } catch (error) {
    console.error('❌ 약국 등록 오류:', error);
    
    let errorMessage = '등록에 실패했습니다.';
    if (error.response) {
      errorMessage = error.response.data?.error || errorMessage;
    } else if (error.code === 'ECONNREFUSED') {
      errorMessage = '서버에 연결할 수 없습니다. 인터넷 연결을 확인해주세요.';
    } else if (error.code === 'ETIMEDOUT') {
      errorMessage = '서버 응답 시간이 초과되었습니다.';
    } else {
      errorMessage = error.message;
    }
    
    return { success: false, error: errorMessage };
  }
}

// 토큰 검증
async function verifyToken() {
  try {
    const token = await getToken();
    if (!token) return false;

    const response = await axios.get(`${API_BASE}/v1/auth/verify`, {
      headers: { 'Authorization': `Bearer ${token}` },
      timeout: 5000
    });

    return response.data && response.data.valid;
  } catch (error) {
    console.error('토큰 검증 실패:', error);
    return false;
  }
}

// 약국 상태 확인
async function checkPharmacyStatus() {
  try {
    const token = await getToken();
    if (!token) return null;

    const response = await axios.get(`${API_BASE}/v1/auth/verify`, {
      headers: { 'Authorization': `Bearer ${token}` },
      timeout: 5000
    });

    return response.data?.pharmacy?.status || null;
  } catch (error) {
    console.error('약국 상태 확인 실패:', error);
    return null;
  }
}

// 이전 약국 상태 저장
function savePharmacyStatus(status) {
  try {
    fs.writeFileSync(PHARMACY_STATUS_FILE, status || '', 'utf8');
  } catch (error) {
    console.error('약국 상태 저장 실패:', error);
  }
}

// 이전 약국 상태 불러오기
function loadPreviousPharmacyStatus() {
  try {
    if (fs.existsSync(PHARMACY_STATUS_FILE)) {
      return fs.readFileSync(PHARMACY_STATUS_FILE, 'utf8').trim();
    }
  } catch (error) {
    console.error('약국 상태 불러오기 실패:', error);
  }
  return null;
}

// 동기식 토큰 가져오기 (전송용)
function getTokenSync() {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      return fs.readFileSync(TOKEN_FILE, 'utf8').trim();
    }
  } catch (error) {
    console.error('토큰 불러오기 실패:', error);
  }
  return null;
}

// 동기식 디바이스 UID 가져오기 (전송용)
function getDeviceUidSync() {
  try {
    if (fs.existsSync(DEVICE_UID_FILE)) {
      return fs.readFileSync(DEVICE_UID_FILE, 'utf8').trim();
    }
  } catch (error) {
    console.error('디바이스 UID 불러오기 실패:', error);
  }
  return null;
}

// 승인 대기 알림 (비차단식)
function showPendingNotification() {
  if (!mainWindow) return;
  
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: '알림',
    message: '약국 승인 대기 중',
    detail: '등록이 완료되었습니다. 관리자 승인 후 파싱 이벤트가 전송됩니다.\n\n프로그램은 정상적으로 사용 가능합니다.',
    buttons: ['확인'],
    noLink: true
  });
}

// 승인 완료 알림
function showApprovalCompletedNotification() {
  if (!mainWindow) return;
  
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: '승인 완료!',
    message: '약국 등록이 승인되었습니다! 🎉',
    detail: '이제 모든 기능을 정상적으로 사용할 수 있습니다.\n파싱 이벤트가 서버로 전송됩니다.',
    buttons: ['확인'],
    noLink: true
  });
}

// 승인 대기 메시지 표시 (구버전 - 호환성 유지)
function showPendingMessage() {
  showPendingNotification();
}

// 거부 메시지 표시
function showRejectedMessage() {
  dialog.showMessageBox(mainWindow, {
    type: 'warning',
    title: '등록 거부',
    message: '약국 등록이 거부되었습니다.',
    detail: '관리자에게 문의하시거나 다시 등록해주세요.',
    buttons: ['다시 등록', '확인']
  }).then((result) => {
    if (result.response === 0) { // 다시 등록
      deleteToken().then(() => {
        createEnrollWindow();
      });
    }
  });
}

// 등록 창 생성
function createEnrollWindow() {
  if (enrollWindow) {
    enrollWindow.focus();
    return;
  }

  enrollWindow = new BrowserWindow({
    width: 560,
    height: 720,
    resizable: false,
    modal: true,
    parent: mainWindow,
    icon: getIconPath(),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    autoHideMenuBar: true,
    title: '약국 등록 - 오토시럽'
  });

  enrollWindow.loadFile('enroll.html');

  enrollWindow.on('closed', () => {
    enrollWindow = null;
  });
}

// 아이콘 절대경로 도우미
function getIconPath() {
  // electron-builder에서 directories.buildResources = "assets" 라면
  // 패키징 후 process.resourcesPath/assets 에 복사됨
  const base = isDev ? __dirname : process.resourcesPath;
  return path.join(base, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
}

// 자동 업데이트 설정
autoUpdater.autoDownload = false; // 자동 다운로드 비활성화 (사용자 선택하게)
autoUpdater.autoInstallOnAppQuit = true; // 앱 종료 시 자동 설치

// 효율적인 업데이트를 위한 설정
autoUpdater.allowDowngrade = false; // 다운그레이드 방지
autoUpdater.allowPrerelease = false; // 프리릴리즈 버전 방지

// 개발 환경에서는 업데이트 확인 안 함
if (!app.isPackaged) {
  autoUpdater.forceDevUpdateConfig = false;
}

// 업데이트 관련 이벤트 핸들러
autoUpdater.on('checking-for-update', () => {
  console.log('업데이트 확인 중...');
});

autoUpdater.on('update-available', (info) => {
  console.log('업데이트 사용 가능:', info.version);
  // 렌더러 프로세스로 업데이트 정보 전달
  if (mainWindow) {
    mainWindow.webContents.send('update-available', {
      version: info.version,
      releaseNotes: info.releaseNotes,
      releaseDate: info.releaseDate
    });
  }
});

autoUpdater.on('update-not-available', (info) => {
  console.log('최신 버전입니다.');
});

autoUpdater.on('error', (err) => {
  console.error('업데이트 오류:', err);
  if (mainWindow) {
    mainWindow.webContents.send('update-error', err.message);
  }
});

autoUpdater.on('download-progress', (progressObj) => {
  console.log(`다운로드 진행: ${progressObj.percent}%`);
  if (mainWindow) {
    mainWindow.webContents.send('update-download-progress', {
      percent: progressObj.percent,
      transferred: progressObj.transferred,
      total: progressObj.total
    });
  }
});

autoUpdater.on('update-downloaded', (info) => {
  console.log('업데이트 다운로드 완료');
  if (mainWindow) {
    mainWindow.webContents.send('update-downloaded', {
      version: info.version
    });
  }
});

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
    // ⬇⬇⬇ 작업표시줄 아이콘은 여기 icon 값으로 결정됨(Windows는 .ico 강력 권장)
    icon: getIconPath(),
    title: '오토시럽',
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

  // 외부 링크는 브라우저로
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

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
app.whenReady().then(async () => {
  // 메뉴바 완전 제거
  Menu.setApplicationMenu(null);
  
  // 디바이스 UID 초기화
  await getOrCreateDeviceUid();
  
  // 토큰 확인
  const token = await getToken();
  
  // 메인 윈도우 생성
  createWindow();
  
  // 토큰이 없으면 등록 창 표시
  if (!token) {
    console.log('⚠️ 토큰이 없습니다. 등록 창을 표시합니다.');
    setTimeout(() => {
      createEnrollWindow();
    }, 1000);
  } else {
    // 토큰 검증
    const isValid = await verifyToken();
    if (!isValid) {
      console.log('⚠️ 토큰이 유효하지 않습니다. 등록 창을 표시합니다.');
      await deleteToken();
      createEnrollWindow();
    } else {
      // 이전 상태 불러오기
      const previousStatus = loadPreviousPharmacyStatus();
      
      // 약국 상태 확인
      const currentStatus = await checkPharmacyStatus();
      console.log('✅ 인증 완료 - 이전 상태:', previousStatus, '현재 상태:', currentStatus);
      
      // 상태에 따른 알림 처리
      if (currentStatus === 'pending') {
        console.log('⚠️ 약국 승인 대기 중입니다.');
        // pending → pending: 알림 안 함 (이미 알고 있음)
        // null → pending: 최초 등록 후, 알림 표시
        // active → pending: 불가능한 경우
        if (previousStatus === null || previousStatus === undefined) {
          // 최초 등록 후
          setTimeout(() => {
            showPendingNotification();
          }, 2000);
        }
      } else if (currentStatus === 'active') {
        console.log('✅ 약국 승인 완료 - 정상 사용 가능');
        // pending → active: 승인 완료 알림!
        if (previousStatus === 'pending') {
          console.log('🎉 약국이 방금 승인되었습니다!');
          setTimeout(() => {
            showApprovalCompletedNotification();
          }, 2000);
        }
      } else if (currentStatus === 'rejected') {
        console.log('⚠️ 약국 등록이 거부되었습니다.');
        setTimeout(() => {
          showRejectedMessage();
        }, 2000);
      }
      
      // 현재 상태 저장
      savePharmacyStatus(currentStatus);
    }
  }
  
  // 앱 시작 5초 후 업데이트 확인 (패키징된 앱에서만)
  if (app.isPackaged) {
    setTimeout(() => {
      autoUpdater.checkForUpdates();
    }, 5000);
  }
  
  // 안전한 파싱 이벤트 시스템 초기화
  await flushOnStart(); // 미전송분 확인 (전송하지 않음)
  startAutoFlush(); // 주기적 전송 비활성화
});

// ============================================
// 안전한 파싱 이벤트 전송 시스템
// ============================================

const { net } = require('electron');
const DATA_FILE = path.join(app.getPath('userData'), 'parse_events.json');

// 1) 안전한 로컬 저장소: 누적/로드/리셋
function readCounter() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const j = JSON.parse(raw);
    return Number.isFinite(j.count) ? j.count : 0;
  } catch {
    return 0;
  }
}

function writeCounter(count) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify({ count }), 'utf8');
}

function incCounter(n = 1) {
  const c = readCounter() + n;
  writeCounter(c);
  console.log(`[COUNTER] Incremented by ${n}, total: ${c}`);
  return c;
}

function resetCounter() {
  writeCounter(0);
  console.log('[COUNTER] Reset to 0');
}

// 2) 전송 함수: electron.net 사용 (CORS 영향 없음, main 전용)
function sendCountToServer(count) {
  return new Promise((resolve, reject) => {
    if (!count || count <= 0) return resolve({ skipped: true });

    const token = getTokenSync();
    if (!token) {
      return reject(new Error('No authentication token'));
    }

    const url = `${API_BASE}/v1/events/parse/batch`;
    const req = net.request({ method: 'POST', url });
    req.setHeader('Content-Type', 'application/json');
    req.setHeader('Authorization', `Bearer ${token}`);

    req.on('response', (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log(`[TRANSMIT] Success: ${res.statusCode}`);
          resolve({ ok: true, status: res.statusCode, body });
        } else {
          console.error(`[TRANSMIT] Failed: ${res.statusCode} - ${body}`);
          reject(new Error(`HTTP ${res.statusCode}: ${body}`));
        }
      });
    });
    req.on('error', (err) => {
      console.error('[TRANSMIT] Network error:', err.message);
      reject(err);
    });

    const payload = {
      events: Array(count).fill().map((_, i) => ({
        source: 'pharmIT3000',
        count: 1,
        idempotency_key: `${getDeviceUidSync()}_batch_${Date.now()}_${i}`,
        ts: new Date().toISOString()
      }))
    };
    
    req.write(JSON.stringify(payload));
    req.end();
  });
}

// 3) 주기적 전송 비활성화 (서버 사용량 절약)
let flushTimer = null;
function startAutoFlush() {
  // 주기적 전송 비활성화 - 종료 시에만 전송
  console.log('[AUTO-FLUSH] Periodic transmission disabled - will only send on app exit');
}

function stopAutoFlush() {
  // 타이머가 없으므로 아무것도 하지 않음
}

// 4) 앱 시작 시 미전송분 재전송 (서버 사용량 절약을 위해 비활성화)
async function flushOnStart() {
  const c = readCounter();
  if (c > 0) {
    console.log(`[STARTUP] Found ${c} pending events - will send on app exit`);
    // 서버 사용량 절약을 위해 시작 시 전송하지 않음
    // 종료 시에만 전송
  }
}

// 5) 종료 시 전송: before-quit에서 붙잡았다가 완료 후 exit
let quitting = false;
app.on('before-quit', (event) => {
  console.log('[APP] before-quit event triggered');
  
  if (quitting) return; // 중복 방지
  
  const c = readCounter();
  if (c <= 0) {
    console.log('[APP] No pending events, exiting immediately');
    return; // 보낼 게 없으면 붙잡지 않음
  }

  event.preventDefault();
  quitting = true;
  console.log(`[APP] Preventing exit, sending ${c} events...`);

  // 주기 타이머 정리
  stopAutoFlush();

  // 전송 시도 후 성공/실패와 무관하게 종료
  sendCountToServer(c)
    .then(() => {
      resetCounter();
      console.log('[APP] Events sent successfully, exiting');
    })
    .catch((err) => {
      console.error('[APP] Failed to send events:', err.message);
    })
    .finally(() => {
      // 중요: app.exit()는 before-quit 등을 다시 발생시키지 않음
      app.exit(0);
    });
});

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

// 사용자 데이터 경로 가져오기
ipcMain.handle('get-user-data-path', async () => {
  return app.getPath('userData');
});

// 업데이트 관련 IPC 핸들러
ipcMain.handle('check-for-updates', async () => {
  if (app.isPackaged) {
    try {
      const result = await autoUpdater.checkForUpdates();
      return { success: true, updateInfo: result.updateInfo };
    } catch (error) {
      console.error('업데이트 확인 오류:', error);
      return { success: false, error: error.message };
    }
  } else {
    return { success: false, error: '개발 모드에서는 업데이트를 확인할 수 없습니다.' };
  }
});

ipcMain.handle('download-update', async () => {
  try {
    await autoUpdater.downloadUpdate();
    return { success: true };
  } catch (error) {
    console.error('업데이트 다운로드 오류:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('install-update', () => {
  // 앱을 종료하고 업데이트 설치
  autoUpdater.quitAndInstall(false, true);
});

ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

// ============================================
// 인증 관련 IPC 핸들러
// ============================================

// 등록 제출
ipcMain.handle('enroll:submit', async (event, formData) => {
  return await enrollPharmacy(formData);
});

// 등록 완료 (창 닫기)
ipcMain.on('enroll:complete', () => {
  if (enrollWindow) {
    enrollWindow.close();
  }
});

// 등록 건너뛰기
ipcMain.on('enroll:skip', () => {
  console.log('⚠️ 사용자가 등록을 건너뛰었습니다.');
  if (enrollWindow) {
    enrollWindow.close();
  }
});

// 토큰 가져오기 (렌더러에서 사용)
ipcMain.handle('auth:get-token', async () => {
  return await getToken();
});

// 등록 상태 확인
ipcMain.handle('auth:is-enrolled', async () => {
  const token = await getToken();
  if (!token) return false;
  return await verifyToken();
});

// 등록 창 열기 (설정에서)
ipcMain.handle('auth:show-enroll', () => {
  createEnrollWindow();
});

// 토큰 삭제 (로그아웃)
ipcMain.handle('auth:logout', async () => {
  await deleteToken();
  console.log('🔓 로그아웃 완료');
  return { success: true };
});

// 파싱 카운터 증가 (렌더러에서 호출)
ipcMain.handle('parse:increment', (event, n = 1) => {
  return incCounter(n);
});

// 배치 파싱 이벤트 전송 (렌더러에서 호출) - 레거시 지원
ipcMain.handle('api:send-batch-parse-events', async (event, eventsArray) => {
  try {
    const count = eventsArray ? eventsArray.length : 0;
    if (count > 0) {
      await sendCountToServer(count);
      resetCounter();
    }
    return { success: true };
  } catch (error) {
    console.error('[LEGACY] Batch send failed:', error.message);
    return { success: false, error: error.message };
  }
});

// 파싱 이벤트 전송 (렌더러에서 호출) - 레거시
ipcMain.handle('api:send-parse-event', async (event, eventData) => {
  try {
    const token = await getToken();
    if (!token) {
      console.log('⚠️ 토큰이 없어 파싱 이벤트를 전송하지 않습니다.');
      return { success: false, error: 'no_token' };
    }

    const response = await axios.post(
      `${API_BASE}/v1/events/parse`,
      eventData,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );

    console.log('✅ 파싱 이벤트 전송 성공:', eventData.idempotency_key);
    return { success: true, data: response.data };
  } catch (error) {
    console.error('❌ 파싱 이벤트 전송 실패:', error);
    
    // 에러가 발생해도 앱 사용은 계속 가능
    let errorMessage = '이벤트 전송 실패';
    if (error.response) {
      errorMessage = error.response.data?.error || errorMessage;
      
      // 403 오류 (승인 대기)는 조용히 처리
      if (error.response.status === 403) {
        console.log('⚠️ 약국 승인 대기 중 - 파싱 이벤트가 전송되지 않습니다.');
        errorMessage = error.response.data?.error || '관리자 승인이 필요합니다.';
      }
    }
    
    return { success: false, error: errorMessage };
  }
}); 