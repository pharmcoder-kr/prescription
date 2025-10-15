const { ipcRenderer } = require('electron');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const moment = require('moment');
const cron = require('node-cron');
const iconv = require('iconv-lite');

// 전역 변수
let savedConnections = {};
let connectedDevices = {};
let availableNetworks = [];
let prescriptionPath = '';
let parsedFiles = new Set();
let parsedPrescriptions = {};
let autoDispensing = false;
let scanInterval = null;
let connectionCheckInterval = null;
let backgroundScanActive = false; // 백그라운드 스캔 상태 추가
let isCheckingStatus = false; // 연결 상태 확인 중복 실행 방지
let autoReconnectAttempted = new Map(); // 자동 재연결 시도한 기기들 (시도 횟수 포함)
let manuallyDisconnectedDevices = new Set(); // 수동으로 연결을 끊은 기기들
let networkPrefix = null; // 현재 네트워크 프리픽스
let transmissionStatus = {}; // 각 환자의 전송상태 저장 (receiptNumber -> count)
let maxSyrupAmount = 100; // 시럽 최대량 (기본값: 100mL)
let medicineTransmissionStatus = {}; // 각 약물의 전송상태 저장 (receiptNumber_medicineCode -> count)
let connectionCheckDelayTimer = null; // 연결 상태 확인 지연 타이머
let isDispensingInProgress = false; // 조제 진행 중 플래그
let dispensingDevices = new Set(); // 조제 중인 기기들의 IP 주소 집합
let isAutoDispensingInProgress = false; // 자동조제 진행 중 플래그 (중복 실행 방지)
let connectionCheckIntervalMs = 15000; // 연결 상태 확인 주기 (기본값: 15초)
let prescriptionProgram = 'pm3000'; // 처방조제프로그램 (기본값: PM3000)
let sentParseEvents = new Set(); // 이미 전송한 파싱 이벤트 (중복 방지)

// ============================================
// 파싱 이벤트 전송 (사용량 집계용)
// ============================================

/**
 * 처방전 파싱 이벤트를 서버로 전송
 * @param {string} filePath - 파싱한 파일 경로
 */
async function sendParseEvent(filePath) {
    try {
        // 중복 키 생성 (device_uid + 파일경로 + 수정시간)
        const stats = fs.statSync(filePath);
        const mtime = stats.mtimeMs;
        const deviceUid = await getDeviceUid(); // device-uid.txt에서 읽기
        
        const idempotencyKey = `${deviceUid}_${filePath}_${mtime}`;
        
        // 이미 전송한 이벤트인지 확인
        if (sentParseEvents.has(idempotencyKey)) {
            return;
        }
        
        const eventData = {
            source: 'pharmIT3000',
            count: 1,
            idempotency_key: idempotencyKey,
            ts: new Date().toISOString()
        };
        
        // IPC를 통해 메인 프로세스로 전송
        const result = await ipcRenderer.invoke('api:send-parse-event', eventData);
        
        if (result.success) {
            sentParseEvents.add(idempotencyKey);
            console.log('✅ 파싱 이벤트 전송 성공:', path.basename(filePath));
        } else {
            // 토큰이 없는 경우는 로그만 남기고 진행
            if (result.error === 'no_token') {
                console.log('⚠️ 약국 등록이 필요합니다. 파싱 이벤트가 전송되지 않습니다.');
            } else if (result.error && result.error.includes('승인')) {
                console.log('⚠️ 약국 승인 대기 중입니다. 승인 후 파싱 이벤트가 전송됩니다.');
            } else {
                console.warn('⚠️ 파싱 이벤트 전송 실패:', result.error);
            }
        }
    } catch (error) {
        // 에러가 발생해도 앱 사용에는 지장 없음
        console.error('❌ 파싱 이벤트 전송 중 오류:', error);
    }
}

/**
 * device-uid.txt에서 디바이스 UID 읽기
 */
async function getDeviceUid() {
    try {
        const userDataPath = await ipcRenderer.invoke('get-user-data-path');
        const deviceUidPath = path.join(userDataPath, 'device-uid.txt');
        
        if (fs.existsSync(deviceUidPath)) {
            return fs.readFileSync(deviceUidPath, 'utf8').trim();
        }
    } catch (error) {
        console.error('device UID 읽기 실패:', error);
    }
    return 'unknown';
}

// 전송 상태 헬퍼 함수들
function getStatusText(status) {
    if (status === '등록되지 않은 약물') return '등록되지 않은 약물';
    if (typeof status === 'number') {
        if (status === 0 || !isFinite(status)) return '0'; // -Infinity, Infinity, NaN 처리
        return status.toString();
    }
    return '0'; // 기본값
}

function getStatusBadgeClass(status) {
    if (status === '등록되지 않은 약물') return 'bg-dark';
    if (typeof status === 'number') {
        if (status === 0 || !isFinite(status)) return 'bg-secondary'; // -Infinity, Infinity, NaN 처리
        return 'bg-success';
    }
    return 'bg-secondary';
}

function isSuccessStatus(status) {
    if (status === '등록되지 않은 약물') return false;
    if (typeof status === 'number') {
        return status > 0 && isFinite(status); // -Infinity, Infinity, NaN 처리
    }
    return false;
}

function incrementTransmissionCount(currentStatus) {
    if (currentStatus === '등록되지 않은 약물') return '등록되지 않은 약물';
    if (typeof currentStatus === 'number') {
        return currentStatus + 1;
    }
    return 1; // 처음 전송
}

// 수동조제 전송현황 리스트 관리
let manualStatusList = [];

function addManualStatus({ syrupName, mac, total }) {
    const now = moment().format('HH:mm:ss');
    const entry = {
        time: now,
        syrupName,
        mac,
        total,
        status: '전송중',
        statusClass: 'manual-status-sending',
        id: Date.now() + Math.random()
    };
    manualStatusList.unshift(entry); // 최근순
    if (manualStatusList.length > 10) manualStatusList = manualStatusList.slice(0, 10);
    renderManualStatusList();
    return entry.id;
}

function updateManualStatus(id, status) {
    const entry = manualStatusList.find(e => e.id === id);
    if (!entry) return;
    if (status === '완료') {
        entry.status = '완료';
        entry.statusClass = 'manual-status-success';
    } else if (status === '실패') {
        entry.status = '실패';
        entry.statusClass = 'manual-status-fail';
    }
    renderManualStatusList();
}

function renderManualStatusList() {
    const tbody = document.getElementById('manualStatusListBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    manualStatusList.forEach(entry => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${entry.time}</td>
            <td>${entry.syrupName}</td>
            <td>${entry.mac}</td>
            <td>${entry.total}</td>
            <td class="${entry.statusClass}">${entry.status}</td>
        `;
        tbody.appendChild(tr);
    });
    // 빈 줄 추가 (10줄 고정)
    for (let i = manualStatusList.length; i < 10; i++) {
        const tr = document.createElement('tr');
        tr.className = 'empty-row';
        tr.innerHTML = '<td>&nbsp;</td><td></td><td></td><td></td><td></td>';
        tbody.appendChild(tr);
    }
}

// DOM 요소들
const elements = {
    mainPage: document.getElementById('mainPage'),
    networkPage: document.getElementById('networkPage'),
    pathEntry: document.getElementById('pathEntry'),
    datePicker: document.getElementById('datePicker'),
    patientTableBody: document.getElementById('patientTableBody'),
    medicineTableBody: document.getElementById('medicineTableBody'),
    logContainer: document.getElementById('logContainer'),
    networkTableBody: document.getElementById('networkTableBody'),
    savedList: document.getElementById('savedList'),
    connectedTableBody: document.getElementById('connectedTableBody'),
    autoDispensing: document.getElementById('autoDispensing'),
    maxSyrupAmount: document.getElementById('maxSyrupAmount')
};

// 초기화
document.addEventListener('DOMContentLoaded', async () => {
    await initializeApp();
    setupEventListeners();
    setupDatePicker();
    await loadConnections();
    await loadPrescriptionPath();
    await loadTransmissionStatus(); // 전송상태 로드 추가
    await loadMedicineTransmissionStatus(); // 약물별 전송상태 로드 추가
    await loadAutoDispensingSettings();
    await loadPrescriptionProgramSettings(); // 처방조제프로그램 설정 로드 추가
    startPeriodicTasks();
    // datePicker 값이 비어있으면 오늘 날짜로 세팅
    if (!elements.datePicker.value) {
        const today = moment().format('YYYY-MM-DD');
        elements.datePicker.value = today;
    }
});

// 앱 초기화
async function initializeApp() {
    logMessage('시럽조제기 연결 관리자가 시작되었습니다.');
    await loadPrescriptionPath();
    await loadConnections(); // 저장된 연결 정보 로드
    await loadTransmissionStatus(); // 전송상태 로드 추가
    await loadMedicineTransmissionStatus(); // 약물별 전송상태 로드 추가
    await loadPrescriptionProgramSettings(); // 처방조제프로그램 설정 로드 추가
    logMessage(`로드된 처방전 경로: ${prescriptionPath}`);
    initializeEmptyTables();
    detectNetworks();
    parseAllPrescriptionFiles();
    startPrescriptionMonitor();
    
    // 저장된 기기들 즉시 연결 시도
    attemptInitialConnection();
    
    startPeriodicTasks(); // 주기적 작업 시작 (자동 연결 포함)

    // datePicker 값이 비어있으면 오늘 날짜로 세팅
    if (!elements.datePicker.value) {
        const today = moment().format('YYYY-MM-DD');
        elements.datePicker.value = today;
    }
}

// 초기 빈 테이블 설정
function initializeEmptyTables() {
    // 환자 정보 테이블에 빈 행 추가
    elements.patientTableBody.innerHTML = '';
    for (let i = 0; i < 5; i++) {
        const emptyRow = document.createElement('tr');
        emptyRow.innerHTML = `
            <td>&nbsp;</td>
            <td>&nbsp;</td>
            <td>&nbsp;</td>
            <td>&nbsp;</td>
        `;
        emptyRow.classList.add('empty-row');
        elements.patientTableBody.appendChild(emptyRow);
    }
    
    // 약물 정보 테이블에 빈 행 추가
    elements.medicineTableBody.innerHTML = '';
    for (let i = 0; i < 5; i++) {
        const emptyRow = document.createElement('tr');
        emptyRow.innerHTML = `
            <td>&nbsp;</td>
            <td>&nbsp;</td>
            <td>&nbsp;</td>
            <td>&nbsp;</td>
            <td>&nbsp;</td>
            <td>&nbsp;</td>
            <td>&nbsp;</td>
            <td>&nbsp;</td>
        `;
        emptyRow.classList.add('empty-row');
        elements.medicineTableBody.appendChild(emptyRow);
    }
}

// 이벤트 리스너 설정
function setupEventListeners() {
    // F12 키 이벤트
    document.addEventListener('keydown', (event) => {
        if (event.key === 'F12') {
            event.preventDefault();
            startDispensing();
        }
    });

    // 네트워크 테이블 행 클릭 이벤트
    elements.networkTableBody.addEventListener('click', (e) => {
        const row = e.target.closest('tr');
        if (row) {
            // 기존 선택 해제
            document.querySelectorAll('#networkTableBody tr').forEach(r => r.classList.remove('selected'));
            // 새 행 선택
            row.classList.add('selected');
        }
    });
    
    // 저장된 연결 목록 클릭 이벤트
    elements.savedList.addEventListener('click', (e) => {
        const item = e.target.closest('.list-group-item');
        if (item) {
            // 기존 선택 해제
            document.querySelectorAll('#savedList .list-group-item').forEach(i => i.classList.remove('active'));
            // 새 아이템 선택
            item.classList.add('active');
        }
    });
    
    // 연결된 기기 테이블 행 클릭 이벤트
    elements.connectedTableBody.addEventListener('click', (e) => {
        const row = e.target.closest('tr');
        if (row) {
            // 기존 선택 해제
            document.querySelectorAll('#connectedTableBody tr').forEach(r => r.classList.remove('selected'));
            // 새 행 선택
            row.classList.add('selected');
        }
    });

    // 자동 조제 체크박스 이벤트
    elements.autoDispensing.addEventListener('change', async (e) => {
        autoDispensing = e.target.checked;
        await saveAutoDispensingSettings();
        logMessage(`자동 조제 ${autoDispensing ? '활성화' : '비활성화'}`);
    });

    // 시럽 최대량 설정 이벤트
    elements.maxSyrupAmount.addEventListener('change', async (e) => {
        maxSyrupAmount = parseInt(e.target.value) || 100;
        await saveAutoDispensingSettings();
        logMessage(`시럽 최대량 설정 변경: ${maxSyrupAmount}mL`);
    });
    
    elements.maxSyrupAmount.addEventListener('blur', async (e) => {
        maxSyrupAmount = parseInt(e.target.value) || 100;
        await saveAutoDispensingSettings();
        logMessage(`시럽 최대량 설정 변경: ${maxSyrupAmount}mL`);
    });

    // 환자 테이블 클릭 이벤트
    elements.patientTableBody.addEventListener('click', (event) => {
        const row = event.target.closest('tr');
        if (row) {
            // 기존 선택 해제
            document.querySelectorAll('#patientTableBody tr').forEach(r => r.classList.remove('table-primary'));
            // 현재 행 선택
            row.classList.add('table-primary');
            loadPatientMedicines(row.dataset.receiptNumber);
        }
    });

    // 약물 테이블 체크박스 이벤트
    elements.medicineTableBody.addEventListener('change', (event) => {
        if (event.target.type === 'checkbox') {
            updateMedicineColors();
            updateMedicineSelectAllCheckbox();
        }
    });
}

// 날짜 선택기 설정
function setupDatePicker() {
    const today = moment().format('YYYY-MM-DD');
    elements.datePicker.value = today;
    flatpickr(elements.datePicker, {
        locale: 'ko',
        dateFormat: 'Y-m-d',
        defaultDate: today,
        onChange: function(selectedDates, dateStr) {
            elements.datePicker.value = dateStr;
            filterPatientsByDate();
        }
    });
}

// 페이지 전환
function showMainPage() {
    elements.mainPage.style.display = 'block';
    elements.networkPage.style.display = 'none';
    // 수동조제 페이지도 반드시 숨김
    const manualPage = document.getElementById('manualPage');
    if (manualPage) manualPage.style.display = 'none';
}

function showNetworkPage() {
    elements.mainPage.style.display = 'none';
    elements.networkPage.style.display = 'block';
    // 수동조제 페이지도 반드시 숨김
    const manualPage = document.getElementById('manualPage');
    if (manualPage) manualPage.style.display = 'none';
}

// 로그 메시지
function logMessage(message) {
    const timestamp = moment().format('HH:mm:ss');
    const logEntry = document.createElement('div');
    logEntry.textContent = `[${timestamp}] ${message}`;
    elements.logContainer.appendChild(logEntry);
    elements.logContainer.scrollTop = elements.logContainer.scrollHeight;
    console.log(`[${timestamp}] ${message}`);
}

// 네트워크 감지
async function detectNetworks() {
    try {
        logMessage('네트워크 인터페이스 감지 중...');
        const networkInfo = await ipcRenderer.invoke('get-network-info');
        
        if (networkInfo) {
            networkPrefix = networkInfo.prefix;
            availableNetworks = [networkPrefix];
            logMessage(`감지된 네트워크: ${networkInfo.interface} (${networkInfo.address})`);
            logMessage(`네트워크 프리픽스: ${networkPrefix}`);
            logMessage(`네트워크 마스크: ${networkInfo.netmask}`);
            logMessage(`연결 방식: ${networkInfo.interface.includes('Wi-Fi') || networkInfo.interface.includes('wlan') ? 'WiFi' : 'LAN'}`);
            logMessage(`설정된 네트워크 프리픽스: ${networkPrefix}`);
            
            // 네트워크 콤보박스 업데이트
            updateNetworkCombo();
            
            // 즉시 네트워크 스캔 시작
            scanNetwork();
        } else {
            logMessage('사용 가능한 네트워크를 찾을 수 없습니다.');
            await showMessage('warning', '사용 가능한 네트워크를 찾을 수 없습니다.\n수동으로 설정해주세요.');
            showNetworkSettingsDialog();
        }
    } catch (error) {
        logMessage(`네트워크 감지 중 오류 발생: ${error.message}`);
        await showMessage('warning', '네트워크 감지 중 오류가 발생했습니다.\n수동으로 설정해주세요.');
        showNetworkSettingsDialog();
    }
}

// 네트워크 콤보박스 업데이트
function updateNetworkCombo() {
    const networkCombo = document.getElementById('networkCombo');
    if (networkCombo) {
        networkCombo.innerHTML = '';
        availableNetworks.forEach(network => {
            const option = document.createElement('option');
            option.value = network;
            option.textContent = network;
            networkCombo.appendChild(option);
        });
        if (availableNetworks.length > 0) {
            networkCombo.value = availableNetworks[0];
        }
    }
}

// 네트워크 설정 다이얼로그 표시
function showNetworkSettingsDialog() {
    const dialog = document.createElement('div');
    dialog.className = 'modal fade show';
    dialog.style.display = 'block';
    dialog.innerHTML = `
        <div class="modal-dialog">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title">네트워크 설정</h5>
                    <button type="button" class="btn-close" onclick="closeNetworkDialog()"></button>
                </div>
                <div class="modal-body">
                    <p>네트워크 주소 범위를 입력하세요 (예: 192.168.1.)</p>
                    <input type="text" id="networkPrefixInput" class="form-control" placeholder="192.168.1.">
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-primary" onclick="saveNetworkPrefix()">확인</button>
                    <button type="button" class="btn btn-secondary" onclick="closeNetworkDialog()">취소</button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(dialog);
}

// 네트워크 프리픽스 저장
function saveNetworkPrefix() {
    const input = document.getElementById('networkPrefixInput');
    const prefix = input.value.trim();
    
    if (prefix && prefix.endsWith('.')) {
        networkPrefix = prefix;
        if (!availableNetworks.includes(prefix)) {
            availableNetworks.push(prefix);
            updateNetworkCombo();
        }
        closeNetworkDialog();
        scanNetwork();
    } else {
        showMessage('error', '올바른 네트워크 주소 범위를 입력하세요.');
    }
}

// 네트워크 다이얼로그 닫기
function closeNetworkDialog() {
    const dialog = document.querySelector('.modal');
    if (dialog) {
        dialog.remove();
    }
}

// 네트워크 변경 이벤트
function onNetworkChanged() {
    const networkCombo = document.getElementById('networkCombo');
    if (networkCombo) {
        networkPrefix = networkCombo.value;
        scanNetwork();
    }
}

// 주기적 스캔 스케줄링
function scheduleScan() {
    scanNetwork();
    scanInterval = setTimeout(scheduleScan, 10000); // 10초마다 스캔 (5초에서 변경)
}

// 네트워크 스캔 (arduino_connector.py 방식 적용)
async function scanNetwork() {
    if (!networkPrefix) {
        logMessage('네트워크 프리픽스가 설정되지 않았습니다.');
        updateScanStatus('네트워크 프리픽스 없음', 'error');
        return;
    }
    
    logMessage(`네트워크 스캔 시작: ${networkPrefix}0/24`);
    logMessage(`현재 네트워크 프리픽스: ${networkPrefix}`);
    updateScanStatus('스캔 중...', 'scanning');
    
    // 기존에 발견된 기기들을 유지하기 위해 현재 테이블의 기기 정보를 저장
    const existingDevices = new Map();
    const existingRows = elements.networkTableBody.querySelectorAll('tr:not(.empty-row)');
    existingRows.forEach(row => {
        const ip = row.cells[0].textContent;
        const mac = row.cells[1].textContent;
        if (ip && mac && ip !== '&nbsp;' && mac !== '&nbsp;') {
            existingDevices.set(mac, {
                ip: ip,
                status: row.cells[2].textContent,
                row: row
            });
        }
    });
    
    logMessage(`기존 테이블 기기 수: ${existingDevices.size}`);
    
    const results = {};
    const threads = [];
    
    // MAC 주소 정규화 함수
    const normalizeMac = (macStr) => {
        return macStr.replace(/[:\-]/g, '').toUpperCase();
    };
    
    // IP 체크 함수
    const checkIP = async (ip) => {
        try {
            console.log(`IP 체크 시도: ${ip}`);
            const response = await axios.get(`http://${ip}`, { 
                timeout: COMMUNICATION_CONFIG.TIMEOUTS.SCAN,
                headers: {
                    'User-Agent': 'SyrupDispenser/1.0'
                }
            });
            console.log(`IP 체크 응답: ${ip} - 상태: ${response.status}, 데이터:`, response.data);
            
            if (response.status === 200) {
                const data = response.data;
                if (data.status === 'ready' || data.mac) {
                    console.log(`유효한 기기 발견: ${ip} - MAC: ${data.mac}, 상태: ${data.status}`);
                    return data;
                } else {
                    console.log(`기기 응답이지만 유효하지 않음: ${ip} - 데이터:`, data);
                }
            }
        } catch (error) {
            // 타임아웃이나 연결 실패는 무시하되 로그는 남김
            if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
                console.log(`IP 체크 타임아웃: ${ip}`);
            } else if (error.code === 'ECONNREFUSED') {
                console.log(`IP 체크 연결 거부: ${ip}`);
            } else {
                console.log(`IP 체크 오류: ${ip} - ${error.message}`);
            }
        }
        return null;
    };
    
    // 모든 IP에 대해 병렬로 체크
    for (let i = 1; i <= 255; i++) {
        const ip = `${networkPrefix}${i}`;
        const promise = checkIP(ip).then(data => {
            results[ip] = data;
        });
        threads.push(promise);
    }
    
    // 모든 스캔 완료 대기
    await Promise.all(threads);
    
    // 스캔 결과 로그 출력
    logMessage(`=== 스캔 결과 전체 ===`);
    let validDeviceCount = 0;
    for (const [ip, data] of Object.entries(results)) {
        if (data && data.mac) {
            validDeviceCount++;
            logMessage(`유효한 기기 발견: ${ip} - MAC: ${data.mac} - 상태: ${data.status || 'ready'}`);
        }
    }
    logMessage(`총 유효한 기기 수: ${validDeviceCount}`);
    
    // 발견된 기기들 처리
    const foundDevices = {};
    const uniqueDevices = new Map(); // MAC 주소별로 고유한 기기만 저장
    
    for (const [ip, data] of Object.entries(results)) {
        if (data && data.mac) {
            const mac = data.mac;
            const normalizedMac = normalizeMac(mac);
            
            logMessage(`처리 중: ${ip} (MAC: ${mac} -> 정규화: ${normalizedMac})`);
            
            // IP 주소가 현재 네트워크 프리픽스와 일치하는지 확인
            // networkPrefix는 "172.30.1." 형태이므로 IP 주소가 이로 시작하는지 확인
            if (ip.startsWith(networkPrefix)) {
                logMessage(`네트워크 범위 내 기기 발견: ${ip} (MAC: ${mac})`);
                
                // 중복 MAC 주소 처리 (같은 MAC이 여러 IP에서 발견되면 첫 번째만 유지)
                if (!uniqueDevices.has(normalizedMac)) {
                    uniqueDevices.set(normalizedMac, { ip, data, originalMac: mac });
                    foundDevices[normalizedMac] = ip;
                    logMessage(`foundDevices에 추가: ${normalizedMac} -> ${ip}`);
                } else {
                    logMessage(`중복 MAC 주소 발견: ${mac} (기존: ${uniqueDevices.get(normalizedMac).ip}, 새로: ${ip})`);
                }
            } else {
                logMessage(`네트워크 범위 외 기기 무시: ${ip} (MAC: ${mac}) - 현재 프리픽스: ${networkPrefix}`);
                logMessage(`IP 시작 부분: ${ip.substring(0, networkPrefix.length)}, 프리픽스: ${networkPrefix}`);
            }
        }
    }
    
    logMessage(`네트워크 범위 내 발견된 기기 수: ${uniqueDevices.size}`);
    logMessage(`foundDevices 최종 내용: ${JSON.stringify(foundDevices)}`);
    
    // 네트워크 테이블 업데이트 (기존 기기 유지하면서 새로운 기기 추가)
    logMessage(`=== 네트워크 테이블 업데이트 ===`);
    
    // 기존 테이블에서 빈 행만 제거
    const emptyRows = elements.networkTableBody.querySelectorAll('tr.empty-row');
    emptyRows.forEach(row => row.remove());
    
    // 새로운 기기들 추가
    uniqueDevices.forEach((deviceInfo, normalizedMac) => {
        const { ip, data, originalMac } = deviceInfo;
        
        // 이미 테이블에 있는 기기인지 확인
        const existingDevice = existingDevices.get(originalMac);
        if (existingDevice) {
            logMessage(`기존 기기 업데이트: ${ip} (MAC: ${originalMac})`);
            // 기존 행의 IP 업데이트
            existingDevice.row.cells[0].textContent = ip;
            
            // 상태는 현재 조제 중인 경우에만 보존하고, 그 외에는 새로운 상태로 업데이트
            const currentStatus = existingDevice.row.cells[2].textContent;
            if (currentStatus === "시럽 조제 중") {
                logMessage(`조제 중인 기기 상태 보존: ${ip} - 상태: ${currentStatus}`);
                // 조제 중인 상태 유지
                // connectedDevices에서도 상태 보존
                for (const [deviceMac, deviceInfo] of Object.entries(connectedDevices)) {
                    if (normalizeMac(deviceMac) === normalizedMac && deviceInfo.status === "시럽 조제 중") {
                        logMessage(`연결된 기기 목록에서도 조제 중 상태 보존: ${deviceInfo.nickname}`);
                        break;
                    }
                }
            } else {
                // 조제 중이 아니면 새로운 상태로 업데이트
                existingDevice.row.cells[2].textContent = data.status || 'ready';
                // connectedDevices에서도 상태 업데이트
                for (const [deviceMac, deviceInfo] of Object.entries(connectedDevices)) {
                    if (normalizeMac(deviceMac) === normalizedMac) {
                        deviceInfo.status = "연결됨";
                        break;
                    }
                }
            }
            
            existingDevices.delete(originalMac); // 처리 완료 표시
        } else {
            logMessage(`새로운 기기 추가: ${ip} (MAC: ${originalMac})`);
            
            // 이미 저장된 연결인지 확인
            const isSaved = Object.keys(savedConnections).some(savedMac => 
                normalizeMac(savedMac) === normalizedMac
            );
            
            // 이미 연결된 기기인지 확인
            const isConnected = Object.keys(connectedDevices).some(connectedMac => 
                normalizeMac(connectedMac) === normalizedMac
            );
            
            logMessage(`기기 상태 확인 - 저장됨: ${isSaved}, 연결됨: ${isConnected}`);
            
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${ip}</td>
                <td>${originalMac}</td>
                <td>${data.status || 'ready'}</td>
                <td>
                    <input type="text" class="form-control form-control-sm" placeholder="약품명" id="nickname_${originalMac}" ${isSaved ? 'disabled' : ''}>
                </td>
                <td>
                    <input type="text" class="form-control form-control-sm" placeholder="약품코드" id="pillcode_${originalMac}" ${isSaved ? 'disabled' : ''}>
                </td>
                <td>
                    ${isSaved ? 
                        `<span class="badge bg-success">저장됨</span>` :
                        `<button class="btn btn-primary btn-sm" onclick="saveConnection('${originalMac}', '${ip}')">저장</button>`
                    }
                </td>
            `;
            elements.networkTableBody.appendChild(row);
            logMessage(`테이블 행 추가 완료: ${ip} (MAC: ${originalMac})`);
        }
    });
    
    // 더 이상 응답하지 않는 기기들 제거 (선택사항)
    existingDevices.forEach((deviceInfo, mac) => {
        // 연결된 기기는 일시적으로 응답하지 않아도 제거하지 않음
        const isConnectedDevice = Object.keys(connectedDevices).some(connectedMac => 
            normalizeMac(connectedMac) === normalizeMac(mac)
        );
        
        if (isConnectedDevice) {
            logMessage(`연결된 기기는 제거하지 않음: ${deviceInfo.ip} (MAC: ${mac})`);
            // 연결된 기기는 상태를 "일시적 응답 없음"으로 변경하되 테이블에서 제거하지 않음
            deviceInfo.row.cells[2].textContent = "일시적 응답 없음";
        } else {
            logMessage(`응답하지 않는 기기 제거: ${deviceInfo.ip} (MAC: ${mac})`);
            deviceInfo.row.remove();
        }
    });
    
    // 빈 행 추가하여 최소 5줄 유지
    const currentRows = elements.networkTableBody.querySelectorAll('tr:not(.empty-row)').length;
    const emptyRowsNeeded = Math.max(0, 5 - currentRows);
    for (let i = 0; i < emptyRowsNeeded; i++) {
        const emptyRow = document.createElement('tr');
        emptyRow.innerHTML = `
            <td>&nbsp;</td>
            <td>&nbsp;</td>
            <td>&nbsp;</td>
            <td>&nbsp;</td>
            <td>&nbsp;</td>
            <td>&nbsp;</td>
        `;
        emptyRow.classList.add('empty-row');
        elements.networkTableBody.appendChild(emptyRow);
    }
    
    logMessage(`스캔 완료: ${uniqueDevices.size}개 기기 발견 (총 테이블 기기 수: ${elements.networkTableBody.querySelectorAll('tr:not(.empty-row)').length})`);
    
    // 스캔 완료 상태 업데이트
    if (uniqueDevices.size > 0) {
        updateScanStatus(`${uniqueDevices.size}개 기기 발견`, 'success');
    } else {
        updateScanStatus('기기 없음', 'warning');
    }
    
    // 자동 재연결 시도
    await attemptAutoReconnect(foundDevices);
}

// 자동 재연결 시도 (arduino_connector.py 방식)
async function attemptAutoReconnect(foundDevices) {
    // MAC 주소 정규화 함수
    const normalizeMac = (macStr) => {
        return macStr.replace(/[:\-]/g, '').toUpperCase();
    };
    
    logMessage(`자동 재연결 시도 시작 - 저장된 기기 수: ${Object.keys(savedConnections).length}`);
    logMessage(`발견된 기기들: ${JSON.stringify(foundDevices)}`);
    
    // 발견된 기기들의 상세 정보 출력
    logMessage(`=== 발견된 기기 상세 정보 ===`);
    for (const [normalizedMac, ip] of Object.entries(foundDevices)) {
        logMessage(`MAC: ${normalizedMac} -> IP: ${ip}`);
    }
    logMessage(`=== 저장된 기기 상세 정보 ===`);
    for (const [savedMac, info] of Object.entries(savedConnections)) {
        const normalizedSavedMac = normalizeMac(savedMac);
        logMessage(`저장된 MAC: ${savedMac} -> 정규화: ${normalizedSavedMac} -> IP: ${info.ip} -> 별명: ${info.nickname}`);
    }
    
    for (const [savedMac, info] of Object.entries(savedConnections)) {
        const normalizedSavedMac = normalizeMac(savedMac);
        
        logMessage(`검사 중: ${info.nickname} (${savedMac} -> ${normalizedSavedMac})`);
        
        // 이미 연결되었거나 재연결 시도한 기기는 건너뛰기
        if (connectedDevices[savedMac]) {
            logMessage(`이미 연결됨: ${info.nickname}`);
            continue;
        }
        
        // 수동으로 연결을 끊은 기기는 자동 재연결하지 않음
        if (manuallyDisconnectedDevices.has(savedMac)) {
            logMessage(`수동으로 연결을 끊은 기기이므로 자동 재연결하지 않음: ${info.nickname}`);
            continue;
        }
        
        // 재연결 시도 횟수 제한 (최대 3회)
        const attemptCount = autoReconnectAttempted.has(normalizedSavedMac) ? 
            autoReconnectAttempted.get(normalizedSavedMac) : 0;
        
        if (attemptCount >= 3) {
            logMessage(`재연결 시도 횟수 초과 (3회): ${info.nickname}`);
            continue;
        }
        
        // 발견된 기기 목록에서 MAC 주소로 찾기 (정규화된 MAC으로 비교)
        const foundIP = foundDevices[normalizedSavedMac];
        if (foundIP) {
            logMessage(`자동 재연결 시도 (${attemptCount + 1}/3): ${info.nickname} (${savedMac}) -> ${foundIP}`);
            
            // IP 업데이트
            savedConnections[savedMac].ip = foundIP;
            
            // 자동 연결
            const success = await connectToDeviceByMac(savedMac, true);
            if (success) {
                autoReconnectAttempted.delete(normalizedSavedMac); // 성공하면 시도 기록 삭제
                logMessage(`자동 재연결 성공: ${info.nickname} (${foundIP})`);
            } else {
                // 실패 시 시도 횟수 증가
                autoReconnectAttempted.set(normalizedSavedMac, attemptCount + 1);
                logMessage(`자동 재연결 실패 (${attemptCount + 1}/3): ${info.nickname} (${foundIP})`);
            }
        } else {
            logMessage(`발견된 기기 목록에 없음: ${info.nickname} (${normalizedSavedMac})`);
            logMessage(`현재 저장된 IP: ${info.ip}, 발견된 기기 IP들: ${Object.values(foundDevices).join(', ')}`);
        }
    }
    
    logMessage(`자동 재연결 시도 완료`);
}

// MAC 주소로 기기 연결
async function connectToDeviceByMac(mac, silent = false) {
    if (!savedConnections[mac]) {
        if (!silent) {
            await showMessage('warning', '저장된 기기 정보를 찾을 수 없습니다.');
        }
        return false;
    }
    
    const deviceInfo = savedConnections[mac];
    const ip = deviceInfo.ip;
    
    // MAC 주소 정규화 함수
    const normalizeMac = (macStr) => {
        return macStr.replace(/[:\-]/g, '').toUpperCase();
    };
    
    logMessage(`연결 시도 시작: ${deviceInfo.nickname} (${ip})`);
    
    try {
        console.log(`연결 요청: http://${ip}`);
        const response = await axios.get(`http://${ip}`, { 
            timeout: COMMUNICATION_CONFIG.TIMEOUTS.CONNECTION_CHECK,
            headers: {
                'User-Agent': 'SyrupDispenser/1.0'
            }
        });
        
        console.log(`연결 응답: ${ip} - 상태: ${response.status}, 데이터:`, response.data);
        
        if (response.status === 200) {
            const data = response.data;
            if (data.mac) {
                // MAC 주소 정규화하여 비교
                const normalizedDeviceMac = normalizeMac(data.mac);
                const normalizedSavedMac = normalizeMac(mac);
                
                console.log(`MAC 비교: 기기=${data.mac}(${normalizedDeviceMac}) vs 저장된=${mac}(${normalizedSavedMac})`);
                
                if (normalizedDeviceMac === normalizedSavedMac) {
                    // 연결 성공
                    connectedDevices[mac] = {
                        ip: ip,
                        nickname: deviceInfo.nickname,
                        pill_code: deviceInfo.pill_code || '',
                        status: '연결됨'
                    };
                    
                    updateConnectedTable();
                    updateMedicineColors();
                    
                    if (!silent) {
                        await showMessage('info', `${deviceInfo.nickname}에 연결되었습니다.`);
                    }
                    logMessage(`${deviceInfo.nickname} 연결 성공 (${ip})`);
                    return true;
                } else {
                    logMessage(`MAC 주소 불일치: 기기=${data.mac}(${normalizedDeviceMac}), 저장된=${mac}(${normalizedSavedMac})`);
                }
            } else {
                logMessage(`기기 응답에 MAC 주소가 없음: ${ip} - 응답:`, data);
            }
        } else {
            logMessage(`기기 응답 상태 코드 오류: ${ip} - 상태: ${response.status}`);
        }
    } catch (error) {
        console.log(`연결 오류 상세: ${ip} - ${error.code} - ${error.message}`);
        if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
            logMessage(`연결 타임아웃: ${deviceInfo.nickname} (${ip})`);
        } else if (error.code === 'ECONNREFUSED') {
            logMessage(`연결 거부: ${deviceInfo.nickname} (${ip})`);
        } else {
            logMessage(`연결 실패: ${deviceInfo.nickname} (${ip}) - ${error.message}`);
        }
    }
    
    if (!silent) {
        await showMessage('warning', '기기를 찾을 수 없습니다.');
    }
    return false;
}

// 기기 확인 (포트 지정 가능)
async function checkDevice(ip, port = 80) {
    try {
        const url = `http://${ip}:${port}`;
        console.log(`연결 시도: ${url}`);
        
        const response = await axios.get(url, { 
            timeout: 3000, // 타임아웃을 3초로 설정
            headers: {
                'User-Agent': 'SyrupDispenser/1.0'
            },
            // 연결 재시도 설정
            maxRedirects: 0,
            validateStatus: function (status) {
                return status >= 200 && status < 500; // 2xx, 3xx, 4xx 상태 코드 모두 허용
            }
        });
        
        console.log(`응답 받음: ${url} - 상태: ${response.status}, 데이터:`, response.data);
        
        if (response.status >= 200 && response.status < 300) {
            // 성공적인 응답
            if (response.data) {
                // 시럽조제기 응답 형식 확인
                if (response.data.mac || response.data.status === 'ready' || response.data.deviceType) {
                    return {
                        ip: ip,
                        port: port,
                        mac: response.data.mac || 'Unknown',
                        status: '온라인',
                        deviceType: response.data.deviceType || '시럽조제기'
                    };
                } else if (typeof response.data === 'string' && response.data.includes('mac')) {
                    // 문자열 형태의 응답에서 MAC 주소 추출 시도
                    const macMatch = response.data.match(/mac[:\s]*([0-9a-fA-F:]+)/i);
                    if (macMatch) {
                        return {
                            ip: ip,
                            port: port,
                            mac: macMatch[1],
                            status: '온라인',
                            deviceType: '시럽조제기'
                        };
                    }
                } else if (Object.keys(response.data).length > 0) {
                    // 응답 데이터가 있지만 예상 형식이 아닌 경우
                    console.log(`예상하지 못한 응답 형식: ${url}`, response.data);
                    return {
                        ip: ip,
                        port: port,
                        mac: 'Unknown',
                        status: '온라인',
                        deviceType: '기타 디바이스'
                    };
                }
            }
        } else if (response.status >= 300 && response.status < 400) {
            // 리다이렉트 응답 - 디바이스가 존재함을 의미
            console.log(`리다이렉트 응답: ${url} - 상태: ${response.status}`);
            return {
                ip: ip,
                port: port,
                mac: 'Unknown',
                status: '온라인',
                deviceType: '웹 서버'
            };
        } else if (response.status >= 400 && response.status < 500) {
            // 클라이언트 오류 - 디바이스는 존재하지만 요청이 거부됨
            console.log(`클라이언트 오류: ${url} - 상태: ${response.status}`);
            return {
                ip: ip,
                port: port,
                mac: 'Unknown',
                status: '온라인',
                deviceType: '웹 서버'
            };
        }
    } catch (error) {
        // 기기 없음 또는 연결 실패
        if (error.code === 'ECONNREFUSED') {
            // 연결 거부 - 해당 포트에서 서비스가 실행되지 않음
            console.log(`연결 거부: ${ip}:${port}`);
        } else if (error.code === 'ENOTFOUND') {
            // 호스트를 찾을 수 없음
            console.log(`호스트 없음: ${ip}:${port}`);
        } else if (error.code === 'ETIMEDOUT') {
            // 타임아웃 - 네트워크 지연 또는 방화벽
            console.log(`타임아웃: ${ip}:${port}`);
        } else if (error.code === 'ECONNABORTED') {
            // 연결 중단
            console.log(`연결 중단: ${ip}:${port}`);
        } else {
            console.log(`연결 실패: ${ip}:${port} - ${error.message}`);
        }
    }
    return null;
}

// 네트워크 테이블 업데이트 (MAC 주소 기반 중복 방지)
function updateNetworkTable() {
    elements.networkTableBody.innerHTML = '';
    
    // MAC 주소 정규화 함수
    const normalizeMac = (macStr) => {
        return macStr.replace(/[:\-]/g, '').toUpperCase();
    };
    
    // MAC 주소별로 고유한 디바이스만 표시 (중복 제거)
    const uniqueDevices = [];
    const seenMacs = new Set();
    
    availableNetworks.forEach(device => {
        const normalizedMac = normalizeMac(device.mac);
        if (!seenMacs.has(normalizedMac)) {
            seenMacs.add(normalizedMac);
            uniqueDevices.push(device);
        } else {
            // 중복된 MAC 주소가 있는 경우, 더 최근에 발견된 것으로 업데이트
            const existingIndex = uniqueDevices.findIndex(d => normalizeMac(d.mac) === normalizedMac);
            if (existingIndex >= 0) {
                uniqueDevices[existingIndex] = device;
            }
        }
    });
    
    uniqueDevices.forEach(device => {
        const row = document.createElement('tr');
        
        // 저장된 연결 정보와 비교하여 상태 표시
        let statusBadge = 'bg-success';
        let statusText = device.status;
        
        const savedConnection = Object.entries(savedConnections).find(([mac, conn]) => {
            return normalizeMac(mac) === normalizeMac(device.mac);
        });
        
        if (savedConnection) {
            statusBadge = 'bg-info';
            statusText = '저장됨';
        }
        
        row.innerHTML = `
            <td>${device.ip}:${device.port}</td>
            <td>${device.mac}</td>
            <td>${device.deviceType}</td>
            <td><span class="badge ${statusBadge}">${statusText}</span></td>
        `;
        elements.networkTableBody.appendChild(row);
    });
}

// 스캔 중지
function stopScan() {
    if (scanInterval) {
        clearInterval(scanInterval);
        scanInterval = null;
        logMessage('네트워크 스캔이 중지되었습니다.');
        updateScanStatus('스캔 중지됨', 'warning');
    }
    
    if (backgroundScanActive) {
        backgroundScanActive = false;
        logMessage('백그라운드 스캔이 중지되었습니다.');
        updateScanStatus('백그라운드 스캔 중지됨', 'warning');
    }
    
    if (!scanInterval && !backgroundScanActive) {
        logMessage('현재 실행 중인 스캔이 없습니다.');
        updateScanStatus('대기중', 'info');
    }
}

// 연결 정보 저장
async function saveConnection(mac, ip) {
    const nicknameInput = document.getElementById(`nickname_${mac}`);
    const pillCodeInput = document.getElementById(`pillcode_${mac}`);
    
    if (!nicknameInput || !pillCodeInput) {
        showMessage('warning', '기기 정보를 찾을 수 없습니다.');
        return;
    }
    
    const nickname = nicknameInput.value.trim();
    const pillCode = pillCodeInput.value.trim();
    
    if (!nickname) {
        showMessage('warning', '약품명을 입력해주세요.');
        return;
    }
    
    if (!pillCode) {
        showMessage('warning', '약품코드를 입력해주세요.');
        return;
    }
    
    savedConnections[mac] = {
        ip: ip,
        nickname: nickname,
        pill_code: pillCode
    };
    
    await saveConnections();
    updateSavedList();
    showMessage('info', '연결 정보가 저장되었습니다.');
    
    // 입력 필드 초기화
    nicknameInput.value = '';
    pillCodeInput.value = '';
}

// 저장된 연결 목록 업데이트
function updateSavedList() {
    elements.savedList.innerHTML = '';
    Object.entries(savedConnections).forEach(([mac, info]) => {
        const item = document.createElement('div');
        item.className = 'list-group-item';
        item.textContent = `${info.nickname} (MAC: ${mac})`;
        item.dataset.mac = mac;
        elements.savedList.appendChild(item);
    });
}

// 기기 연결
async function connectToDevice() {
    const selectedItem = document.querySelector('#savedList .list-group-item.active');
    if (!selectedItem) {
        await showMessage('warning', '연결할 기기를 선택해주세요.');
        return;
    }
    
    const mac = selectedItem.dataset.mac;
    
    if (connectedDevices[mac]) {
        await showMessage('info', '이미 연결된 기기입니다.');
        return;
    }
    
    const success = await connectToDeviceByMac(mac, false);
    if (success) {
        // 연결 성공 시 재연결 시도 목록에서 제거
        autoReconnectAttempted.delete(mac);
    }
}

// 연결된 기기 테이블 업데이트
function updateConnectedTable() {
    elements.connectedTableBody.innerHTML = '';
    Object.entries(connectedDevices).forEach(([mac, device]) => {
        const row = document.createElement('tr');

        let statusClass = 'status-disconnected';
        if (device.status === '연결됨') {
            statusClass = 'status-connected';
        } else if (device.status === '시럽 조제 중') {
            statusClass = 'status-dispensing';
        }

        row.innerHTML = `
            <td>${device.nickname}</td>
            <td>${device.pill_code}</td>
            <td>${device.ip}</td>
            <td><span class="${statusClass}">${device.status}</span></td>
            <td>${moment().format('HH:mm:ss')}</td>
        `;
        elements.connectedTableBody.appendChild(row);
    });
}

// 기기 연결 해제
function disconnectDevice() {
    const selection = document.querySelector('#savedList .active');
    if (!selection) {
        showMessage('warning', '연결 해제할 기기를 선택해주세요.');
        return;
    }
    
    const mac = selection.dataset.mac;
    
    if (!connectedDevices[mac]) {
        showMessage('warning', '선택한 기기가 연결되어 있지 않습니다.');
        return;
    }
    
    // 연결된 기기에서 제거
    delete connectedDevices[mac];
    
    // 수동으로 연결을 끊은 기기로 기록
    manuallyDisconnectedDevices.add(mac);
    
    updateConnectedTable();
    updateMedicineColors();
    
    // 연결 상태 확인에서 해당 기기 제외
    logMessage(`기기 연결 해제: ${mac} (수동 해제로 기록됨)`);
    showMessage('info', '연결이 해제되었습니다.');
}

// 기기 삭제
async function deleteDevice() {
    const selection = document.querySelector('#savedList .active');
    if (!selection) {
        showMessage('warning', '삭제할 기기를 선택해주세요.');
        return;
    }
    
    const mac = selection.dataset.mac;
    
    if (mac in connectedDevices) {
        showMessage('warning', '연결된 기기는 삭제할 수 없습니다. 먼저 연결을 해제해주세요.');
        return;
    }
    
    delete savedConnections[mac];
    await saveConnections();
    updateSavedList();
    showMessage('info', '기기가 삭제되었습니다.');
}

// 연결 정보 저장/로드
async function saveConnections() {
    try {
        const filePath = await getConfigFilePath('connections.json');
        fs.writeFileSync(filePath, JSON.stringify({
            connections: savedConnections,
            manuallyDisconnectedDevices: Array.from(manuallyDisconnectedDevices)
        }, null, 2));
    } catch (error) {
        logMessage(`연결 정보 저장 중 오류: ${error.message}`);
    }
}

async function loadConnections() {
    try {
        const filePath = await getConfigFilePath('connections.json');
        if (fs.existsSync(filePath)) {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            savedConnections = data.connections || {};
            
            // 수동으로 연결을 끊은 기기 목록 로드
            if (data.manuallyDisconnectedDevices) {
                manuallyDisconnectedDevices = new Set(data.manuallyDisconnectedDevices);
                logMessage(`수동으로 연결을 끊은 기기 목록 로드: ${Array.from(manuallyDisconnectedDevices).join(', ')}`);
            }
            
            updateSavedList();
            // 시럽조제기 목록이 로드된 후에만 수동조제 줄 복원
            if (document.getElementById('manualPage')) {
                loadManualRowsState();
            }
        }
    } catch (error) {
        logMessage(`연결 정보 로드 중 오류: ${error.message}`);
    }
}

// 처방전 경로 관리
async function selectPrescriptionPath() {
    const path = await ipcRenderer.invoke('select-directory');
    if (path) {
        elements.pathEntry.value = path;
        prescriptionPath = path;
        savePrescriptionPath();
    }
}

async function savePrescriptionPath() {
    const path = elements.pathEntry.value.trim();
    if (path && fs.existsSync(path)) {
        prescriptionPath = path;
        try {
            const filePath = await getConfigFilePath('prescription_path.txt');
            fs.writeFileSync(filePath, path);
            showMessage('info', '처방전 파일 경로가 저장되었습니다.');
            parseAllPrescriptionFiles();
        } catch (error) {
            logMessage(`경로 저장 중 오류: ${error.message}`);
        }
    } else {
        showMessage('warning', '올바른 경로를 입력해주세요.');
    }
}

async function loadPrescriptionPath() {
    try {
        const filePath = await getConfigFilePath('prescription_path.txt');
        if (fs.existsSync(filePath)) {
            prescriptionPath = fs.readFileSync(filePath, 'utf8').trim();
            elements.pathEntry.value = prescriptionPath;
        }
    } catch (error) {
        logMessage(`경로 로드 중 오류: ${error.message}`);
    }
}

// 자동 조제 설정 저장
async function saveAutoDispensingSettings() {
    try {
        const settings = {
            autoDispensing: autoDispensing,
            maxSyrupAmount: maxSyrupAmount
        };
        const filePath = await getConfigFilePath('auto_dispensing_settings.json');
        fs.writeFileSync(filePath, JSON.stringify(settings, null, 2), 'utf8');
        logMessage(`자동 조제 설정 저장됨: ${autoDispensing ? '활성화' : '비활성화'}, 시럽 최대량: ${maxSyrupAmount}mL`);
    } catch (error) {
        logMessage(`자동 조제 설정 저장 중 오류: ${error.message}`);
    }
}

// 자동 조제 설정 로드
async function loadAutoDispensingSettings() {
    try {
        const filePath = await getConfigFilePath('auto_dispensing_settings.json');
        if (fs.existsSync(filePath)) {
            const settings = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            autoDispensing = settings.autoDispensing || false;
            maxSyrupAmount = settings.maxSyrupAmount || 100;
            elements.autoDispensing.checked = autoDispensing;
            elements.maxSyrupAmount.value = maxSyrupAmount;
            logMessage(`자동 조제 설정 로드됨: ${autoDispensing ? '활성화' : '비활성화'}, 시럽 최대량: ${maxSyrupAmount}mL`);
        } else {
            // 기본값 설정
            autoDispensing = false;
            maxSyrupAmount = 100;
            elements.autoDispensing.checked = false;
            elements.maxSyrupAmount.value = maxSyrupAmount;
            logMessage('자동 조제 설정 파일이 없어 기본값으로 설정됨: 비활성화, 시럽 최대량: 100mL');
        }
    } catch (error) {
        logMessage(`자동 조제 설정 로드 중 오류: ${error.message}`);
        // 오류 발생 시 기본값 설정
        autoDispensing = false;
        maxSyrupAmount = 100;
        elements.autoDispensing.checked = false;
        elements.maxSyrupAmount.value = maxSyrupAmount;
    }
}

// 처방조제프로그램 설정 로드
async function loadPrescriptionProgramSettings() {
    try {
        const filePath = await getConfigFilePath('prescription_program_settings.json');
        if (fs.existsSync(filePath)) {
            const settings = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            prescriptionProgram = settings.prescriptionProgram || 'pm3000';
            const programSelect = document.getElementById('prescriptionProgram');
            if (programSelect) {
                programSelect.value = prescriptionProgram;
            }
            logMessage(`처방조제프로그램 설정 로드됨: ${prescriptionProgram === 'pm3000' ? 'PM3000, 팜플러스20' : '유팜'}`);
        } else {
            // 기본값 설정
            prescriptionProgram = 'pm3000';
            const programSelect = document.getElementById('prescriptionProgram');
            if (programSelect) {
                programSelect.value = prescriptionProgram;
            }
            logMessage('처방조제프로그램 설정 파일이 없어 기본값으로 설정됨: PM3000, 팜플러스20');
        }
    } catch (error) {
        logMessage(`처방조제프로그램 설정 로드 중 오류: ${error.message}`);
        // 오류 발생 시 기본값 설정
        prescriptionProgram = 'pm3000';
        const programSelect = document.getElementById('prescriptionProgram');
        if (programSelect) {
            programSelect.value = prescriptionProgram;
        }
    }
}

// 처방조제프로그램 설정 저장
async function savePrescriptionProgramSettings() {
    try {
        const settings = {
            prescriptionProgram: prescriptionProgram
        };
        const filePath = await getConfigFilePath('prescription_program_settings.json');
        fs.writeFileSync(filePath, JSON.stringify(settings, null, 2));
        logMessage(`처방조제프로그램 설정 저장됨: ${prescriptionProgram === 'pm3000' ? 'PM3000, 팜플러스20' : '유팜'}`);
    } catch (error) {
        logMessage(`처방조제프로그램 설정 저장 중 오류: ${error.message}`);
    }
}

// 처방조제프로그램 변경 이벤트
async function onPrescriptionProgramChanged() {
    const programSelect = document.getElementById('prescriptionProgram');
    if (programSelect) {
        prescriptionProgram = programSelect.value;
        await savePrescriptionProgramSettings();
        logMessage(`처방조제프로그램 변경됨: ${prescriptionProgram === 'pm3000' ? 'PM3000, 팜플러스20' : '유팜'}`);
        
        // 기존 파싱된 데이터 초기화
        parsedFiles.clear();
        parsedPrescriptions = {};
        
        // 새로운 프로그램에 맞게 파일 다시 파싱
        parseAllPrescriptionFiles();
    }
}

// 처방전 파일 파싱
function parseAllPrescriptionFiles() {
    if (!prescriptionPath) {
        logMessage('처방전 경로가 설정되지 않았습니다.');
        return;
    }
    
    logMessage(`처방전 파일 파싱 시작: ${prescriptionPath}`);
    
    try {
        // 선택된 프로그램에 따라 파일 확장자 결정
        const fileExtension = prescriptionProgram === 'pm3000' ? '.txt' : '.xml';
        const files = fs.readdirSync(prescriptionPath)
            .filter(file => file.endsWith(fileExtension))
            .map(file => path.join(prescriptionPath, file));
        
        logMessage(`발견된 파일 수: ${files.length}`);
        files.forEach(file => {
            logMessage(`파일: ${path.basename(file)}`);
        });
        
        files.forEach(filePath => {
            parsePrescriptionFile(filePath);
        });
        
        logMessage(`파싱된 처방전 수: ${Object.keys(parsedPrescriptions).length}`);
        Object.keys(parsedPrescriptions).forEach(key => {
            logMessage(`파싱된 처방전: ${key} -> ${parsedPrescriptions[key].patient.receipt_time}`);
        });
        
        filterPatientsByDate();
    } catch (error) {
        logMessage(`처방전 파일 파싱 중 오류: ${error.message}`);
    }
}

function parsePrescriptionFile(filePath) {
    if (parsedFiles.has(filePath)) return;
    
    try {
        const buffer = fs.readFileSync(filePath);
        let content = '';
        
        // 선택된 프로그램에 따라 파일 확장자 결정
        const fileExtension = prescriptionProgram === 'pm3000' ? '.txt' : '.xml';
        const receiptNumber = path.basename(filePath, fileExtension);
        
        if (prescriptionProgram === 'pm3000') {
            // PM3000, 팜플러스20 - TXT 파일 파싱
            let decoded = false;
            // 인코딩 우선순위: cp949 → euc-kr → utf8
            const encodings = ['cp949', 'euc-kr', 'utf8'];

            for (const encoding of encodings) {
                try {
                    content = iconv.decode(buffer, encoding);
                    // 한글이 포함되어 있는지 확인 (더 엄격하게)
                    if (/[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(content)) {
                        decoded = true;
                        break;
                    }
                } catch (error) {
                    continue;
                }
            }
            if (!decoded) {
                content = iconv.decode(buffer, 'utf8');
            }

            const lines = content.toString().split('\n').filter(line => line.trim());
            if (lines.length === 0) return;
            
            const patientName = lines[0].trim();
            
            // 파일명에서 날짜 추출 (YYYYMMDD 형식)
            const datePart = receiptNumber.substring(0, 8);
            const year = datePart.substring(0, 4);
            const month = datePart.substring(4, 6);
            const day = datePart.substring(6, 8);
            const receiptDate = `${year}-${month}-${day}`;
            
            // 파일의 실제 생성 시간 가져오기
            const stats = fs.statSync(filePath);
            const creationTime = moment(stats.birthtime).format('YYYY-MM-DD HH:mm:ss');
            const currentTime = moment().format('YYYY-MM-DD HH:mm:ss');
            
            // 파일 생성 시간이 유효하지 않으면 현재 시간 사용
            const receiptTime = stats.birthtime.getTime() > 0 ? creationTime : currentTime;
            
            const medicines = lines.slice(1).map((line, index) => {
                const parts = line.trim().split('\\');
                if (parts.length >= 8) {
                    return {
                        pill_code: parts[0],
                        pill_name: parts[1],
                        volume: parseInt(parts[2]),
                        daily: parseInt(parts[3]),
                        period: parseInt(parts[4]),
                        total: parseInt(parts[5]),
                        date: parts[6],
                        line_number: parseInt(parts[7])
                    };
                }
                return null;
            }).filter(medicine => medicine !== null);
            
            medicines.sort((a, b) => a.line_number - b.line_number);
            
            parsedPrescriptions[receiptNumber] = {
                patient: {
                    name: patientName,
                    receipt_time: receiptTime,
                    receipt_date: receiptDate,
                    receipt_number: receiptNumber,
                    parsed_at: currentTime
                },
                medicines: medicines
            };
            
            parsedFiles.add(filePath);
            logMessage(`PM3000 처방전 파일 '${path.basename(filePath)}' 파싱 완료 (시간: ${receiptTime})`);
            
            // 파싱 이벤트 전송 (사용량 집계용)
            sendParseEvent(filePath).catch(err => {
                console.error('파싱 이벤트 전송 중 오류:', err);
            });
            
        } else {
            // 유팜 - XML 파일 파싱
            content = buffer.toString('utf8');
            
            // XML 파싱을 위한 간단한 정규식 사용
            const orderNumMatch = content.match(/<OrderNum>([^<]+)<\/OrderNum>/);
            const orderDtMatch = content.match(/<OrderDt>([^<]+)<\/OrderDt>/);
            const orderDtmMatch = content.match(/<OrderDtm>([^<]+)<\/OrderDtm>/);
            const ptntNmMatch = content.match(/<PtntNm>([^<]+)<\/PtntNm>/);
            
            if (!orderNumMatch || !ptntNmMatch) {
                logMessage(`유팜 XML 파일 파싱 실패: 필수 정보 누락 - ${path.basename(filePath)}`);
                return;
            }
            
            const orderNum = orderNumMatch[1];
            const orderDt = orderDtMatch ? orderDtMatch[1] : '';
            const orderDtm = orderDtmMatch ? orderDtmMatch[1] : '';
            const patientName = ptntNmMatch[1];
            
            // 날짜 형식 변환 (YYYYMMDD -> YYYY-MM-DD)
            let receiptDate = '';
            let receiptTime = '';
            if (orderDt) {
                const year = orderDt.substring(0, 4);
                const month = orderDt.substring(4, 6);
                const day = orderDt.substring(6, 8);
                receiptDate = `${year}-${month}-${day}`;
            }
            
            if (orderDtm) {
                const year = orderDtm.substring(0, 4);
                const month = orderDtm.substring(4, 6);
                const day = orderDtm.substring(6, 8);
                const hour = orderDtm.substring(8, 10);
                const minute = orderDtm.substring(10, 12);
                const second = orderDtm.substring(12, 14);
                receiptTime = `${year}-${month}-${day} ${hour}:${minute}:${second}`;
            } else {
                // 파일 생성 시간 사용
                const stats = fs.statSync(filePath);
                receiptTime = moment(stats.birthtime).format('YYYY-MM-DD HH:mm:ss');
            }
            
            // MedItem 태그들을 찾아서 약물 정보 추출
            const medItemMatches = content.match(/<MedItem>([\s\S]*?)<\/MedItem>/g);
            const medicines = [];
            
            if (medItemMatches) {
                medItemMatches.forEach((medItem, index) => {
                    const codeMatch = medItem.match(/<Code>([^<]+)<\/Code>/);
                    const medNmMatch = medItem.match(/<MedNm>([^<]+)<\/MedNm>/);
                    const takeDaysMatch = medItem.match(/<TakeDays>([^<]+)<\/TakeDays>/);
                    const doseMatch = medItem.match(/<Dose>([^<]+)<\/Dose>/);
                    const dayTakeCntMatch = medItem.match(/<DayTakeCnt>([^<]+)<\/DayTakeCnt>/);
                    
                    if (codeMatch && medNmMatch && takeDaysMatch && doseMatch && dayTakeCntMatch) {
                        const pill_code = codeMatch[1];
                        const pill_name = medNmMatch[1];
                        const period = parseInt(takeDaysMatch[1]);
                        const volume = parseFloat(doseMatch[1]);
                        const daily = parseInt(dayTakeCntMatch[1]);
                        const total = Math.round(volume * daily * period); // 총량 계산
                        
                        medicines.push({
                            pill_code: pill_code,
                            pill_name: pill_name,
                            volume: volume,
                            daily: daily,
                            period: period,
                            total: total,
                            date: receiptDate,
                            line_number: index + 1
                        });
                    }
                });
            }
            
            parsedPrescriptions[receiptNumber] = {
                patient: {
                    name: patientName,
                    receipt_time: receiptTime,
                    receipt_date: receiptDate,
                    receipt_number: receiptNumber,
                    parsed_at: moment().format('YYYY-MM-DD HH:mm:ss')
                },
                medicines: medicines
            };
            
            parsedFiles.add(filePath);
            logMessage(`유팜 XML 파일 '${path.basename(filePath)}' 파싱 완료 (시간: ${receiptTime})`);
            
            // 파싱 이벤트 전송 (사용량 집계용)
            sendParseEvent(filePath).catch(err => {
                console.error('파싱 이벤트 전송 중 오류:', err);
            });
        }
        
        // 자동 조제 트리거는 처방전 모니터링에서 처리하도록 변경
        // 여기서는 즉시 startDispensing을 호출하지 않음
    } catch (error) {
        logMessage(`파일 파싱 중 오류: ${error.message}`);
    }
}

// 환자 필터링
function filterPatientsByDate() {
    let selectedDate = elements.datePicker.value;
    if (!selectedDate) {
        selectedDate = moment().format('YYYY-MM-DD');
        elements.datePicker.value = selectedDate;
    }
    logMessage(`날짜 필터링 시작: 선택된 날짜 = ${selectedDate}`);
    
    elements.patientTableBody.innerHTML = '';
    
    // 해당 날짜의 처방전들을 최신 순으로 정렬
    const prescriptionsForDate = Object.values(parsedPrescriptions)
        .filter(prescription => prescription.patient.receipt_date === selectedDate)
        .sort((a, b) => {
            // receipt_time을 기준으로 내림차순 정렬 (최신이 위로)
            return b.patient.receipt_time.localeCompare(a.patient.receipt_time);
        });
    
    let foundCount = 0;
    prescriptionsForDate.forEach(prescription => {
        logMessage(`확인 중: ${prescription.patient.receipt_number} (날짜: ${prescription.patient.receipt_time})`);
        
        const row = document.createElement('tr');
        
        // 기존에 저장된 환자 전송상태 확인
        const existingStatus = transmissionStatus[prescription.patient.receipt_number];
        
        // 해당 환자의 모든 약물 상태 확인하여 전체 상태 계산
        const medicineStatuses = prescription.medicines.map(medicine => {
            const key = `${prescription.patient.receipt_number}_${medicine.pill_code}`;
            return medicineTransmissionStatus[key] || 0;
        });
        
        // 전체 상태 결정 - 약물들의 최대 전송횟수를 반영
        let overallStatus = 0;
        
        // 등록된 약물들만 필터링하여 상태 확인
        const registeredMedicineStatuses = prescription.medicines
            .filter(medicine => isMedicineRegistered(medicine.pill_code))
            .map(medicine => {
                const key = `${prescription.patient.receipt_number}_${medicine.pill_code}`;
                return medicineTransmissionStatus[key] || 0;
            });
        
        if (registeredMedicineStatuses.length === 0) {
            // 등록된 약물이 없는 경우
            overallStatus = 0;
        } else {
            // 등록된 약물들의 최대 전송횟수를 환자 전체 상태로 설정
            const numericStatuses = registeredMedicineStatuses.filter(s => typeof s === 'number');
            if (numericStatuses.length > 0) {
                const maxCount = Math.max(...numericStatuses);
                overallStatus = maxCount;
            } else {
                // 숫자가 아닌 상태들만 있는 경우 (예: "등록되지 않은 약물")
                overallStatus = 0;
            }
        }
        
        // 전송상태 저장
        transmissionStatus[prescription.patient.receipt_number] = overallStatus;
        
        const badgeClass = getStatusBadgeClass(overallStatus);
        const statusText = getStatusText(overallStatus);
        const statusBadge = `<span class="badge ${badgeClass}">${statusText}</span>`;
        
        row.innerHTML = `
            <td>${prescription.patient.name}</td>
            <td>${prescription.patient.receipt_time}</td>
            <td>${prescription.patient.receipt_number}</td>
            <td>${statusBadge}</td>
        `;
        row.setAttribute('data-receipt-number', prescription.patient.receipt_number);
        elements.patientTableBody.appendChild(row);
        foundCount++;
        logMessage(`환자 추가: ${prescription.patient.name} (${prescription.patient.receipt_number}) - 상태: ${overallStatus}`);
    });
    
    // 빈 행 추가하여 5줄 고정
    const emptyRowsNeeded = 5 - foundCount;
    for (let i = 0; i < emptyRowsNeeded; i++) {
        const emptyRow = document.createElement('tr');
        emptyRow.innerHTML = `
            <td>&nbsp;</td>
            <td>&nbsp;</td>
            <td>&nbsp;</td>
            <td>&nbsp;</td>
        `;
        emptyRow.classList.add('empty-row');
        elements.patientTableBody.appendChild(emptyRow);
    }
    
    logMessage(`날짜 필터링 완료: ${foundCount}명의 환자 발견 (최신 순 정렬)`);
}

// 환자 약물 정보 로드
function loadPatientMedicines(receiptNumber) {
    const prescription = parsedPrescriptions[receiptNumber];
    
    elements.medicineTableBody.innerHTML = '';
    
    if (prescription) {
        prescription.medicines.forEach(medicine => {
            const row = document.createElement('tr');
            
            // 약물이 저장된 시럽조제기에 등록되어 있는지 확인
            const isRegistered = isMedicineRegistered(medicine.pill_code);
            
            // 기존 약물별 전송상태 확인
            const key = `${receiptNumber}_${medicine.pill_code}`;
            let savedStatus = medicineTransmissionStatus[key];
            
            // 등록되지 않은 약물은 "등록되지 않은 약물" 상태로 설정
            if (!isRegistered) {
                savedStatus = '등록되지 않은 약물';
                medicineTransmissionStatus[key] = savedStatus;
            }
            
            let statusBadge = '<span class="badge bg-secondary">0</span>';
            
            if (savedStatus !== undefined) {
                const badgeClass = getStatusBadgeClass(savedStatus);
                const statusText = getStatusText(savedStatus);
                statusBadge = `<span class="badge ${badgeClass}">${statusText}</span>`;
            }
            
            // 체크박스 상태 결정 (모든 약물 기본 체크)
            const isChecked = isRegistered;
            const isDisabled = !isRegistered;
            
            row.innerHTML = `
                <td>
                    <input type="checkbox" 
                           class="medicine-checkbox" 
                           data-pill-code="${medicine.pill_code}"
                           data-pill-name="${medicine.pill_name}"
                           data-total="${medicine.total}"
                           ${isChecked ? 'checked' : ''}
                           ${isDisabled ? 'disabled' : ''}>
                </td>
                <td>${medicine.pill_name}</td>
                <td>${medicine.pill_code}</td>
                <td>${medicine.volume}</td>
                <td>${medicine.daily}</td>
                <td>${medicine.period}</td>
                <td>${medicine.total}</td>
                <td>${statusBadge}</td>
            `;
            row.dataset.pillCode = medicine.pill_code;
            row.dataset.isRegistered = isRegistered;
            elements.medicineTableBody.appendChild(row);
        });
        
        updateMedicineColors();
    }
    
    // 빈 행 추가하여 5줄 고정
    const currentRows = elements.medicineTableBody.querySelectorAll('tr:not(.empty-row)').length;
    const emptyRowsNeeded = 5 - currentRows;
    for (let i = 0; i < emptyRowsNeeded; i++) {
        const emptyRow = document.createElement('tr');
        emptyRow.innerHTML = `
            <td>&nbsp;</td>
            <td>&nbsp;</td>
            <td>&nbsp;</td>
            <td>&nbsp;</td>
            <td>&nbsp;</td>
            <td>&nbsp;</td>
            <td>&nbsp;</td>
            <td>&nbsp;</td>
        `;
        emptyRow.classList.add('empty-row');
        elements.medicineTableBody.appendChild(emptyRow);
    }
    
    // 행 색상 업데이트
    updateMedicineRowColors();
    
    // 전체 선택 체크박스 상태 업데이트
    updateMedicineSelectAllCheckbox();
    
    // 환자 테이블의 전송상태 업데이트 (약물 정보 변경 시 자동 반영)
    updatePatientTransmissionStatus(receiptNumber);
}

// 전체 선택 체크박스 토글
function toggleAllMedicineSelections() {
    const selectAllCheckbox = document.getElementById('selectAllMedicineCheckbox');
    const checkboxes = document.querySelectorAll('.medicine-checkbox:not(:disabled)');
    
    checkboxes.forEach(checkbox => {
        checkbox.checked = selectAllCheckbox.checked;
    });
}

// 전체 선택 체크박스 상태 업데이트
function updateMedicineSelectAllCheckbox() {
    const selectAllCheckbox = document.getElementById('selectAllMedicineCheckbox');
    if (!selectAllCheckbox) return;
    
    const checkboxes = document.querySelectorAll('.medicine-checkbox:not(:disabled)');
    const checkedBoxes = document.querySelectorAll('.medicine-checkbox:not(:disabled):checked');
    
    if (checkedBoxes.length === 0) {
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = false;
    } else if (checkedBoxes.length === checkboxes.length) {
        selectAllCheckbox.checked = true;
        selectAllCheckbox.indeterminate = false;
    } else {
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = true;
    }
}

// 약물 색상 업데이트
function updateMedicineColors() {
    console.log('=== 약물 색상 업데이트 시작 ===');
    console.log('연결된 기기들:', connectedDevices);
    
    const rows = elements.medicineTableBody.querySelectorAll('tr:not(.empty-row)');
    console.log(`약물 정보 행 수: ${rows.length}`);
    
    rows.forEach((row, index) => {
        const pillCode = row.dataset.pillCode;
        const isRegistered = row.dataset.isRegistered === 'true';
        console.log(`행 ${index + 1}: 약품 코드 = ${pillCode}, 등록됨 = ${isRegistered}`);
        
        if (!pillCode) {
            console.log(`행 ${index + 1}: 약품 코드 없음, 건너뛰기`);
            return; // 약품 코드가 없는 행은 건너뛰기
        }
        
        // 기존 클래스 제거
        row.classList.remove('connected', 'disconnected', 'unregistered');
        console.log(`행 ${index + 1}: 기존 클래스 제거됨`);
        
        // 등록되지 않은 약물은 검정색으로 표시
        if (!isRegistered) {
            row.classList.add('unregistered');
            console.log(`행 ${index + 1}: unregistered 클래스 추가 (검정색)`);
        } else {
            let isConnected = false;
            
            // 연결된 기기들 중에서 해당 약품 코드와 일치하는 기기가 있는지 확인
            Object.values(connectedDevices).forEach(device => {
                console.log(`기기 확인: ${device.pill_code} vs ${pillCode} (상태: ${device.status})`);
                if (device.pill_code === pillCode && device.status === '연결됨') {
                    isConnected = true;
                    console.log(`일치 발견: ${device.nickname}`);
                }
            });
            
            // 연결 상태에 따라 클래스 추가
            if (isConnected) {
                row.classList.add('connected');
                console.log(`행 ${index + 1}: connected 클래스 추가 (파란색)`);
            } else {
                row.classList.add('disconnected');
                console.log(`행 ${index + 1}: disconnected 클래스 추가 (빨간색)`);
            }
        }
        
        // 현재 클래스 확인
        console.log(`행 ${index + 1}: 현재 클래스 = ${row.className}`);
    });
    
    console.log('=== 약물 색상 업데이트 완료 ===');
}

// 조제 시작
async function startDispensing(isAuto = false) {
    // 자동조제 중복 실행 방지
    if (isAuto && isAutoDispensingInProgress) {
        logMessage('자동조제가 이미 진행 중입니다. 중복 실행을 방지합니다.');
        return;
    }
    
    let selectedPatient = document.querySelector('#patientTableBody tr.table-primary');
    if (!selectedPatient && isAuto) {
        // 자동조제 모드일 때는 오늘 날짜의 첫 번째 환자 자동 선택
        selectedPatient = document.querySelector('#patientTableBody tr');
        if (selectedPatient) {
            selectedPatient.classList.add('table-primary');
            // 자동조제 모드일 때는 약물 정보도 자동으로 로드
            const receiptNumber = selectedPatient.dataset.receiptNumber;
            if (receiptNumber) {
                loadPatientMedicines(receiptNumber);
                logMessage(`자동조제: 환자 ${receiptNumber} 선택 및 약물 정보 로드 완료`);
                
                // 자동조제 진행 중 플래그 설정
                isAutoDispensingInProgress = true;
                
                // 약물 정보 로드 후 체크박스 생성까지 약간의 지연을 두고 조제 시작
                setTimeout(() => {
                    startDispensingInternal(receiptNumber, isAuto);
                }, 200);
                return; // 여기서 함수 종료하고 내부 함수에서 계속 처리
            }
        }
    }
    if (!selectedPatient) {
        showMessage('warning', '환자를 선택해주세요.');
        return;
    }
    const receiptNumber = selectedPatient.dataset.receiptNumber;
    console.log('[startDispensing] receiptNumber:', receiptNumber, 'isAuto:', isAuto);
    
    // 내부 조제 함수 호출
    startDispensingInternal(receiptNumber, isAuto);
}

// 실제 조제 로직을 처리하는 내부 함수
async function startDispensingInternal(receiptNumber, isAuto = false) {
    const prescription = parsedPrescriptions[receiptNumber];
    if (!prescription) {
        showMessage('error', '처방전 정보를 찾을 수 없습니다.');
        return;
    }
    
    if (Object.keys(connectedDevices).length === 0) {
        showMessage('warning', '연결된 시럽조제기가 없습니다.');
        return;
    }
    
    logMessage(`조제를 시작합니다. 환자: ${prescription.patient.name}`);
    
    // 조제 시작 시 연결 상태 확인을 느린 모드로 전환
    setSlowConnectionCheck();
    
    // 조제 진행 중 플래그 설정 및 연결 상태 확인 지연 시작
    isDispensingInProgress = true;
    dispensingDevices.clear(); // 조제 중인 기기 목록 초기화
    startConnectionCheckDelay(60); // 60초 동안 연결 상태 확인 지연
    
    // 자동조제 모드일 때는 모든 등록된 약물을 자동으로 선택
    if (isAuto) {
        prescription.medicines.forEach(medicine => {
            const checkbox = document.querySelector(`.medicine-checkbox[data-pill-code="${medicine.pill_code}"]`);
            if (checkbox && !checkbox.disabled) {
                checkbox.checked = true;
            }
        });
        logMessage('자동조제: 모든 등록된 약물을 자동으로 선택했습니다.');
    }
    
    // 선택된 약물들만 필터링
    const selectedMedicines = prescription.medicines.filter(medicine => {
        const checkbox = document.querySelector(`.medicine-checkbox[data-pill-code="${medicine.pill_code}"]`);
        return checkbox && checkbox.checked;
    });
    
    if (selectedMedicines.length === 0) {
        if (isAuto) {
            logMessage('자동조제: 선택 가능한 약물이 없습니다. (모든 약물이 등록되지 않았거나 연결되지 않음)');
            return;
        } else {
            showMessage('warning', '전송할 약물을 선택해주세요.');
            return;
        }
    }
    
    // 등록된 약물들만 필터링 (저장된 시럽조제기에 등록된 약물만)
    const registeredMedicines = selectedMedicines.filter(medicine => {
        return isMedicineRegistered(medicine.pill_code);
    });
    
    const unregisteredMedicines = selectedMedicines.filter(medicine => {
        return !isMedicineRegistered(medicine.pill_code);
    });
    
    // 등록되지 않은 약물들을 "등록되지 않은 약물" 상태로 표시
    for (const medicine of unregisteredMedicines) {
        logMessage(`${medicine.pill_name}은(는) 저장된 시럽조제기에 등록되지 않은 약물이므로 전송에서 제외됩니다.`);
        await updateMedicineTransmissionStatus(receiptNumber, medicine.pill_code, '등록되지 않은 약물');
    }

    // 시럽 최대량 초과 검증
    const overLimitMedicines = registeredMedicines.filter(medicine => {
        return medicine.total > maxSyrupAmount;
    });

    const validMedicines = registeredMedicines.filter(medicine => {
        return medicine.total <= maxSyrupAmount;
    });

    // 최대량을 초과하는 약물들을 실패 상태로 표시
    if (overLimitMedicines.length > 0) {
        const overLimitNames = overLimitMedicines.map(m => `${m.pill_name}(${m.total}mL)`).join('\n• ');
        const message = `다음 약물들이 설정된 최대량 ${maxSyrupAmount}mL를 초과하여 전송에서 제외됩니다:\n\n• ${overLimitNames}\n\n설정에서 시럽 최대량을 조정하거나 약물을 분할하여 전송하세요.`;
        
        showMessage('warning', message);
        
        for (const medicine of overLimitMedicines) {
            logMessage(`${medicine.pill_name}은(는) 총량 ${medicine.total}mL가 설정된 최대량 ${maxSyrupAmount}mL를 초과하므로 전송에서 제외됩니다.`);
            await updateMedicineTransmissionStatus(receiptNumber, medicine.pill_code, 0); // 실패는 0으로 표시
        }
    }
    
    // 연결된 약물들만 필터링 (유효한 약물 중에서 연결된 것만)
    const connectedMedicines = validMedicines.filter(medicine => {
        const connectedDevice = Object.values(connectedDevices).find(device => 
            device.pill_code === medicine.pill_code && device.status === '연결됨'
        );
        return connectedDevice !== undefined;
    });
    
    const notConnectedMedicines = validMedicines.filter(medicine => {
        const connectedDevice = Object.values(connectedDevices).find(device => 
            device.pill_code === medicine.pill_code && device.status === '연결됨'
        );
        return connectedDevice === undefined;
    });
    
    // 연결되지 않은 약물들을 실패 상태로 표시
    for (const medicine of notConnectedMedicines) {
        logMessage(`${medicine.pill_name}은(는) 연결되지 않은 약물이므로 건너뜁니다.`);
        await updateMedicineTransmissionStatus(receiptNumber, medicine.pill_code, '실패');
    }
    
    if (connectedMedicines.length === 0) {
        showMessage('warning', '전송할 수 있는 약물이 없습니다.');
        return;
    }
    
    logMessage(`병렬 전송 시작: ${connectedMedicines.length}개 약물`);
    
    // 모든 약물을 병렬로 전송
    const dispensingPromises = connectedMedicines.map(async (medicine) => {
        const connectedDevice = Object.values(connectedDevices).find(device => 
            device.pill_code === medicine.pill_code && device.status === '연결됨'
        );
        
        logMessage(`병렬 전송 시작: ${medicine.pill_name}, 코드: ${medicine.pill_code}, 총량: ${medicine.total}`);
        
        // 조제 시작 전에 상태를 "시럽 조제 중"으로 변경
        connectedDevice.status = '시럽 조제 중';
        dispensingDevices.add(connectedDevice.ip); // 조제 중인 기기 목록에 추가
        updateConnectedTable();
        logMessage(`${medicine.pill_name} 조제 시작 - 기기 상태를 '시럽 조제 중'으로 변경`);
        
        // 약물 전송상태는 변경하지 않음 (전송 결과에 따라만 변경)
        
        try {
            const data = {
                patient_name: prescription.patient.name,
                total_volume: medicine.total
            };
            
            const response = await makeStableRequest(`http://${connectedDevice.ip}/dispense`, data, {
                timeout: COMMUNICATION_CONFIG.TIMEOUTS.DISPENSE
            });
            
            if (response.status === 200) {
                logMessage(`${medicine.pill_name} 응답 데이터: ${JSON.stringify(response.data)}`);
                
                // 모든 200 응답(BUSY 포함)을 성공으로 처리
                const key = `${receiptNumber}_${medicine.pill_code}`;
                const currentStatus = medicineTransmissionStatus[key] || 0;
                const newStatus = incrementTransmissionCount(currentStatus);
                
                if (response.data === "BUSY") {
                    logMessage(`${medicine.pill_name} 조제 중 - 대기열에 추가됨 (성공으로 처리)`);
                    await updateMedicineTransmissionStatus(receiptNumber, medicine.pill_code, newStatus);
                    return { success: true, medicine: medicine, device: connectedDevice, status: 'success' };
                } else {
                    logMessage(`${medicine.pill_name} 데이터 전송 성공 (응답: ${response.data})`);
                    await updateMedicineTransmissionStatus(receiptNumber, medicine.pill_code, newStatus);
                    return { success: true, medicine: medicine, device: connectedDevice, status: 'success' };
                }
            } else {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
        } catch (error) {
            logMessage(`${medicine.pill_name} 전송 실패: ${error.message}`);
            await updateMedicineTransmissionStatus(receiptNumber, medicine.pill_code, 0); // 실패는 0으로 표시
            
            // 연결 실패 시 기기 상태를 "연결 끊김"으로 변경
            connectedDevice.status = '연결 끊김';
            dispensingDevices.delete(connectedDevice.ip); // 조제 중인 기기 목록에서 제거
            updateConnectedTable();
            
            return { success: false, medicine: medicine, device: connectedDevice, error: error.message };
        }
    });
    
    try {
        const results = await Promise.allSettled(dispensingPromises);
        
        // 모든 조제 완료 후 처리
        let successCount = 0;
        let failureCount = 0;
        
        logMessage(`=== 조제 결과 분석 시작 ===`);
        for (let index = 0; index < results.length; index++) {
            const result = results[index];
            const medicine = connectedMedicines[index];
            logMessage(`약물 ${medicine.pill_name} 결과: ${result.status} - ${JSON.stringify(result.value || result.reason)}`);
            
            if (result.status === 'fulfilled' && result.value && result.value.success) {
                const { device, status } = result.value;
                
                // 조제 완료된 기기 상태를 "연결됨"으로 복구
                device.status = '연결됨';
                dispensingDevices.delete(device.ip); // 조제 중인 기기 목록에서 제거
                updateConnectedTable();
                
                logMessage(`${medicine.pill_name} 데이터 전송 완료 - 기기 상태를 '연결됨'으로 복구`);
            } else {
                const device = Object.values(connectedDevices).find(d => d.pill_code === medicine.pill_code);
                if (device) {
                    dispensingDevices.delete(device.ip); // 조제 중인 기기 목록에서 제거
                }
                
                // 실패한 약물 상태 업데이트
                await updateMedicineTransmissionStatus(receiptNumber, medicine.pill_code, 0); // 실패는 0으로 표시
                logMessage(`${medicine.pill_name} 조제 실패`);
            }
        }
        
        // 조제 완료 후 연결 상태 확인 재개
        if (dispensingDevices.size === 0) {
            isDispensingInProgress = false;
            isAutoDispensingInProgress = false; // 자동조제 플래그 해제
            cancelConnectionCheckDelay(); // 지연 타이머 취소
            setNormalConnectionCheck(); // 일반 모드로 전환
            logMessage('모든 조제 완료 - 일반 연결 상태 확인 모드로 전환');
        }
        
        // 조제 완료 로그 출력
        logMessage(`조제 작업이 완료되었습니다.`);
        
    } catch (error) {
        logMessage(`조제 중 오류 발생: ${error.message}`);
        isAutoDispensingInProgress = false; // 오류 발생 시에도 자동조제 플래그 해제
        
        // 오류 발생 시에도 조제 중인 기기들을 정리
        dispensingDevices.clear();
        isDispensingInProgress = false;
        cancelConnectionCheckDelay();
        setNormalConnectionCheck(); // 일반 모드로 복구
    }
}

// 전송 상태 업데이트
async function updateTransmissionStatus(receiptNumber, status) {
    console.log('[updateTransmissionStatus] 호출됨:', receiptNumber, status);
    
    // 전역 변수에 상태 저장
    transmissionStatus[receiptNumber] = status;
    
    // 파일에 저장
    await saveTransmissionStatus();
    
    const row = document.querySelector(`#patientTableBody tr[data-receipt-number="${receiptNumber}"]`);
    if (row) {
        const statusCell = row.cells[3];
        const badgeClass = status === '완료' ? 'bg-success' : 'bg-danger';
        statusCell.innerHTML = `<span class="badge ${badgeClass}">${status}</span>`;
        console.log('[updateTransmissionStatus] 상태 업데이트 성공:', receiptNumber, status);
    } else {
        console.error('[updateTransmissionStatus] 환자 행을 찾을 수 없음:', receiptNumber);
        console.log('[updateTransmissionStatus] 현재 환자 테이블 행들:');
        document.querySelectorAll('#patientTableBody tr').forEach((r, index) => {
            console.log(`  행 ${index}: data-receipt-number="${r.dataset.receiptNumber}"`);
        });
    }
}

// 선택된 약물 삭제
function deleteSelectedMedicine() {
    const selectedRows = elements.medicineTableBody.querySelectorAll('tr.table-primary');
    if (selectedRows.length === 0) {
        showMessage('warning', '삭제할 약물을 선택해주세요.');
        return;
    }
    
    selectedRows.forEach(row => {
        const medicineName = row.cells[0].textContent;
        row.remove();
        logMessage(`약물 '${medicineName}'이(가) 삭제되었습니다.`);
    });
    
    showMessage('info', '선택된 약물이 삭제되었습니다.');
}

// 메시지 표시 함수 보정
async function showMessage(type, message) {
    // Electron에서 허용하는 타입만 사용
    const validTypes = ['info', 'warning', 'error', 'question'];
    if (type === 'success') type = 'info';
    if (!validTypes.includes(type)) type = 'info';
    await ipcRenderer.invoke('show-message', { type, message });
}

// 초기 연결 시도 (앱 시작 시 저장된 기기들 연결)
async function attemptInitialConnection() {
    logMessage('초기 연결 시도 시작...');
    
    // 연결할 기기 목록 생성
    const devicesToConnect = [];
    for (const [savedMac, info] of Object.entries(savedConnections)) {
        // 수동으로 연결을 끊은 기기는 제외
        if (manuallyDisconnectedDevices.has(savedMac)) {
            logMessage(`초기 연결에서 제외 (수동 해제): ${info.nickname}`);
            continue;
        }
        
        // 이미 연결된 기기는 제외
        if (connectedDevices[savedMac]) {
            logMessage(`이미 연결됨: ${info.nickname}`);
            continue;
        }
        
        devicesToConnect.push({ mac: savedMac, info: info });
    }
    
    // 모든 기기를 병렬로 연결 시도
    const connectionPromises = devicesToConnect.map(async ({ mac, info }) => {
        logMessage(`초기 연결 시도: ${info.nickname} (${info.ip})`);
        
        try {
            const success = await connectToDeviceByMac(mac, true);
            if (success) {
                logMessage(`초기 연결 성공: ${info.nickname}`);
            } else {
                logMessage(`초기 연결 실패: ${info.nickname}`);
            }
            return { mac, success };
        } catch (error) {
            logMessage(`초기 연결 오류: ${info.nickname} - ${error.message}`);
            return { mac, success: false };
        }
    });
    
    // 모든 연결 시도 완료 대기
    const results = await Promise.allSettled(connectionPromises);
    
    // 결과 요약
    const successfulConnections = results.filter(result => 
        result.status === 'fulfilled' && result.value.success
    ).length;
    
    logMessage(`초기 연결 시도 완료: ${successfulConnections}/${devicesToConnect.length}개 성공`);
}

// 주기적 작업 시작
function startPeriodicTasks() {
    // 주기적 스캔 시작
    scheduleScan();
    
    // 초기에는 빠른 연결 상태 확인 시작
    setFastConnectionCheck();
    
    logMessage('주기적 작업이 시작되었습니다.');
}

// 연결 상태 확인 시작
function startConnectionStatusCheck() {
    if (connectionCheckInterval) {
        clearInterval(connectionCheckInterval);
    }
    
    connectionCheckInterval = setInterval(checkConnectionStatus, connectionCheckIntervalMs);
    logMessage(`연결 상태 확인 시작 (주기: ${connectionCheckIntervalMs/1000}초)`);
}

// 연결 상태 확인 주기 조정
function adjustConnectionCheckInterval(newIntervalMs) {
    connectionCheckIntervalMs = newIntervalMs;
    
    if (connectionCheckInterval) {
        clearInterval(connectionCheckInterval);
        connectionCheckInterval = setInterval(checkConnectionStatus, connectionCheckIntervalMs);
        logMessage(`연결 상태 확인 주기 조정: ${connectionCheckIntervalMs/1000}초`);
    }
}

// 빠른 연결 상태 확인 (초기 연결 시)
function setFastConnectionCheck() {
    adjustConnectionCheckInterval(5000); // 5초
    logMessage('빠른 연결 상태 확인 모드 활성화 (5초 주기)');
}

// 일반 연결 상태 확인 (기본)
function setNormalConnectionCheck() {
    adjustConnectionCheckInterval(15000); // 15초
    logMessage('일반 연결 상태 확인 모드 활성화 (15초 주기)');
}

// 느린 연결 상태 확인 (조제 중)
function setSlowConnectionCheck() {
    adjustConnectionCheckInterval(60000); // 60초
    logMessage('느린 연결 상태 확인 모드 활성화 (60초 주기)');
}

// 연결 상태 즉시 새로고침 (사용자 요청)
async function refreshConnectionStatus() {
    logMessage('사용자 요청으로 연결 상태 새로고침 시작...');
    
    // 조제 진행 중이면 새로고침 건너뛰기
    if (isDispensingInProgress) {
        await showMessage('warning', '조제 진행 중에는 연결 상태를 확인할 수 없습니다.');
        return;
    }
    
    // 조제 중인 기기가 있는지 확인
    if (dispensingDevices.size > 0) {
        await showMessage('warning', '조제 중인 기기가 있어 연결 상태를 확인할 수 없습니다.');
        return;
    }
    
    // 기존 연결 상태 확인 중단
    if (connectionCheckInterval) {
        clearInterval(connectionCheckInterval);
        connectionCheckInterval = null;
    }
    
    // 즉시 연결 상태 확인 실행
    await checkConnectionStatus();
    
    // 연결 상태 확인 재시작
    if (connectionCheckIntervalMs) {
        connectionCheckInterval = setInterval(checkConnectionStatus, connectionCheckIntervalMs);
        logMessage(`연결 상태 확인 재시작 (주기: ${connectionCheckIntervalMs/1000}초)`);
    }
    
    logMessage('연결 상태 새로고침 완료');
}

// 연결 상태 확인 (arduino_connector.py 방식 적용)
async function checkConnectionStatus() {
    if (isCheckingStatus) {
        return; // 이미 확인 중이면 중복 실행 방지
    }
    
    // 조제 진행 중이면 연결 상태 확인을 완전히 건너뛰기
    if (isDispensingInProgress) {
        logMessage('조제 진행 중 - 연결 상태 확인 건너뜀');
        return;
    }
    
    // 조제 중인 기기가 있는지 확인
    if (dispensingDevices.size > 0) {
        logMessage(`조제 중인 기기 존재 (${dispensingDevices.size}개) - 연결 상태 확인 건너뜀`);
        return;
    }
    
    try {
        isCheckingStatus = true;
        const rows = elements.connectedTableBody.querySelectorAll('tr');
        
        // MAC 주소 정규화 함수
        const normalizeMac = (macStr) => {
            return macStr.replace(/[:\-]/g, '').toUpperCase();
        };
        
        let allConnected = true;
        let hasConnectedDevices = false;
        
        for (const row of rows) {
            const cells = row.cells;
            const ip = cells[2].textContent;
            const currentStatus = cells[3].textContent.trim(); // 현재 상태 가져오기
            
            // 조제 중인 기기는 연결 상태 확인을 건너뛰기
            if (currentStatus === "시럽 조제 중" || dispensingDevices.has(ip)) {
                logMessage(`조제 중인 기기 연결 상태 확인 건너뜀: ${ip}`);
                continue;
            }
            
            let mac = null;
            for (const [deviceMac, deviceInfo] of Object.entries(connectedDevices)) {
                if (deviceInfo.ip === ip) {
                    mac = deviceMac;
                    break;
                }
            }
            
            hasConnectedDevices = true;
            
            try {
                // 일시적인 타임아웃에 대한 재시도 로직
                let response = null;
                let lastError = null;
                
                for (let retry = 0; retry < 2; retry++) {
                    try {
                        response = await axios.get(`http://${ip}`, { timeout: COMMUNICATION_CONFIG.TIMEOUTS.CONNECTION_CHECK });
                        break; // 성공하면 재시도 중단
                    } catch (error) {
                        lastError = error;
                        if (retry < 1 && (error.code === 'ECONNABORTED' || error.message.includes('timeout'))) {
                            logMessage(`연결 상태 확인 재시도: ${ip} - ${error.message}`);
                            await new Promise(resolve => setTimeout(resolve, 1000)); // 1초 대기
                        } else {
                            break; // 타임아웃이 아닌 오류는 재시도하지 않음
                        }
                    }
                }
                
                if (!response) {
                    throw lastError; // 모든 재시도 실패
                }
                
                if (response.status === 200) {
                    const data = response.data;
                    if (data.mac) {
                        // MAC 주소 정규화하여 비교
                        const normalizedDeviceMac = normalizeMac(data.mac);
                        const normalizedSavedMac = normalizeMac(mac);
                        
                        if (normalizedDeviceMac === normalizedSavedMac) {
                            // 조제 중이 아닌 경우에만 상태를 "연결됨"으로 변경
                            const currentStatus = cells[3].textContent.trim();
                            if (currentStatus !== "시럽 조제 중" && !dispensingDevices.has(ip)) {
                                updateDeviceStatus(ip, '연결됨');
                            }
                        } else {
                            // MAC 주소가 다르면 연결 해제
                            elements.connectedTableBody.removeChild(row);
                            delete connectedDevices[mac];
                            logMessage(`기기 MAC 주소 불일치로 연결 해제: ${ip} (기기=${data.mac}, 저장된=${mac})`);
                            allConnected = false;
                        }
                    } else {
                        // MAC 정보가 없으면 일시적 응답 없음으로 처리
                        const currentStatus = cells[3].textContent.trim();
                        if (currentStatus !== "시럽 조제 중" && !dispensingDevices.has(ip)) {
                            updateDeviceStatus(ip, '일시적 응답 없음');
                            allConnected = false;
                        }
                    }
                } else {
                    // 비정상 응답 - 일시적 응답 없음으로 처리
                    const currentStatus = cells[3].textContent.trim();
                    if (currentStatus !== "시럽 조제 중" && !dispensingDevices.has(ip)) {
                        updateDeviceStatus(ip, '일시적 응답 없음');
                        allConnected = false;
                    }
                }
            } catch (error) {
                // 조제 중인 기기는 상태를 보존
                const currentStatus = cells[3].textContent.trim();
                if (currentStatus === "시럽 조제 중" || dispensingDevices.has(ip)) {
                    logMessage(`조제 중인 기기는 연결 상태 유지: ${ip} - 오류: ${error.message}`);
                } else {
                    // 조제 중이 아닌 경우에만 "일시적 응답 없음"으로 변경
                    updateDeviceStatus(ip, '일시적 응답 없음');
                    logMessage(`연결 상태 확인 오류: ${ip} - ${error.message}`);
                    allConnected = false;
                }
            }
        }
        
        // 연결 상태에 따른 주기 조정
        if (hasConnectedDevices) {
            if (allConnected && connectionCheckIntervalMs === 5000) {
                // 모든 기기가 연결되었고 현재 빠른 모드라면 일반 모드로 전환
                setNormalConnectionCheck();
            } else if (!allConnected && connectionCheckIntervalMs === 15000) {
                // 연결되지 않은 기기가 있고 현재 일반 모드라면 빠른 모드로 전환
                setFastConnectionCheck();
            }
        }
        
        // 연결 상태 변경 후 약물 색상 갱신
        updateMedicineColors();
        
    } catch (error) {
        logMessage(`연결 상태 확인 중 오류: ${error.message}`);
    } finally {
        isCheckingStatus = false;
    }
}

// 기기 상태 업데이트
function updateDeviceStatus(ip, status) {
    for (const [mac, deviceInfo] of Object.entries(connectedDevices)) {
        if (deviceInfo.ip === ip) {
            connectedDevices[mac].status = status;
            
            // 연결된 기기 테이블 업데이트
            const rows = elements.connectedTableBody.querySelectorAll('tr');
            for (const row of rows) {
                if (row.cells[2].textContent === ip) {
                    row.cells[3].textContent = status;
                    row.cells[4].textContent = moment().format('HH:mm:ss');
                    break;
                }
            }
            break;
        }
    }
    
    // 연결 상태 변경 시 약물 색상도 갱신
    updateMedicineColors();
}

// 처방전 파일 모니터링
function startPrescriptionMonitor() {
    if (!prescriptionPath) return;

    setInterval(() => {
        try {
            // 선택된 프로그램에 따라 파일 확장자 결정
            const fileExtension = prescriptionProgram === 'pm3000' ? '.txt' : '.xml';
            const files = fs.readdirSync(prescriptionPath)
                .filter(file => file.endsWith(fileExtension))
                .map(file => path.join(prescriptionPath, file));

            let newFileDetected = false;
            let latestDate = null;
            let newReceiptNumbers = [];

            files.forEach(filePath => {
                if (!parsedFiles.has(filePath)) {
                    const receiptNumber = path.basename(filePath, fileExtension);
                    parsePrescriptionFile(filePath);
                    
                    // 파일명에서 날짜 추출
                    let datePart = '';
                    if (prescriptionProgram === 'pm3000') {
                        // PM3000: 20250625xxxxxx.txt 형식
                        datePart = receiptNumber.substring(0, 8);
                    } else {
                        // 유팜: XML 파일에서 OrderDt 추출
                        try {
                            const content = fs.readFileSync(filePath, 'utf8');
                            const orderDtMatch = content.match(/<OrderDt>([^<]+)<\/OrderDt>/);
                            if (orderDtMatch) {
                                datePart = orderDtMatch[1]; // YYYYMMDD 형식
                                logMessage(`유팜 XML 파일에서 날짜 추출: ${datePart} (${path.basename(filePath)})`);
                            } else {
                                logMessage(`유팜 XML 파일에서 OrderDt 태그를 찾을 수 없음: ${path.basename(filePath)}`);
                            }
                        } catch (error) {
                            logMessage(`유팜 XML 파일 날짜 추출 실패: ${path.basename(filePath)} - ${error.message}`);
                        }
                    }
                    
                    if (/^20\d{6}$/.test(datePart)) {
                        if (!latestDate || datePart > latestDate) {
                            latestDate = datePart;
                        }
                        newReceiptNumbers.push(receiptNumber);
                    }
                    newFileDetected = true;
                }
            });

            // 새 파일이 감지되면 datePicker를 최신 날짜로 맞추고 리스트 갱신
            if (newFileDetected && latestDate) {
                const formatted = `${latestDate.substring(0,4)}-${latestDate.substring(4,6)}-${latestDate.substring(6,8)}`;
                elements.datePicker.value = formatted;
                filterPatientsByDate();
                
                // 자동 조제가 활성화되어 있고, 새로 추가된 처방전이 현재 선택된 날짜와 일치하면 자동 조제 시작
                if (autoDispensing && newReceiptNumbers.length > 0) {
                    const selectedDate = elements.datePicker.value;
                    const formattedDate = selectedDate.replace(/-/g, '');
                    
                    newReceiptNumbers.forEach(receiptNumber => {
                        const prescription = parsedPrescriptions[receiptNumber];
                        if (prescription && prescription.patient.receipt_date === selectedDate) {
                            const fileExt = prescriptionProgram === 'pm3000' ? '.txt' : '.xml';
                            logMessage(`새로운 처방전 '${receiptNumber}${fileExt}'이(가) 감지되어 자동으로 조제를 시작합니다.`);
                            
                            // 환자 행이 생성된 후 자동 선택
                            setTimeout(() => {
                                const row = document.querySelector(`#patientTableBody tr[data-receipt-number="${receiptNumber}"]`);
                                if (row) {
                                    // 기존 선택 해제
                                    document.querySelectorAll('#patientTableBody tr').forEach(r => r.classList.remove('table-primary'));
                                    row.classList.add('table-primary');
                                    
                                    // 약물 정보 로드
                                    loadPatientMedicines(receiptNumber);
                                    logMessage(`자동조제: 환자 ${prescription.patient.name} 선택 및 약물 정보 로드 완료`);
                                    
                                    // 약물 정보 로드 후 조제 시작
                                    setTimeout(() => {
                                        if (!isAutoDispensingInProgress) {
                                            logMessage(`조제를 시작합니다. 환자: ${prescription.patient.name}`);
                                            startDispensing(true); // true: 자동조제 플래그
                                        } else {
                                            logMessage('자동조제가 이미 진행 중입니다. 새로운 처방전 처리를 건너뜁니다.');
                                        }
                                    }, 200);
                                } else {
                                    logMessage(`환자 행을 찾을 수 없음: ${receiptNumber}`);
                                }
                            }, 100); // 환자 행 생성 후 약간의 지연을 두고 실행
                        }
                    });
                }
            }
        } catch (error) {
            logMessage(`파일 모니터링 중 오류: ${error.message}`);
        }
    }, 2000);
}

// 네트워크 스캔 모달 표시
function showNetworkScanModal() {
    const modal = new bootstrap.Modal(document.getElementById('networkScanModal'));
    modal.show();
    
    // 모달이 표시되면 초기 상태 설정
    updateScanStatus('대기중', 'info');
    
    // 모달이 표시되면 즉시 스캔 시작
    setTimeout(() => {
        scanNetwork();
    }, 500);
}

// 스캔 상태 업데이트
function updateScanStatus(status, type = 'info') {
    const statusElement = document.getElementById('scanStatus');
    if (!statusElement) return;
    
    let badgeClass = 'bg-secondary';
    let icon = 'fas fa-info-circle';
    
    switch (type) {
        case 'scanning':
            badgeClass = 'bg-primary';
            icon = 'fas fa-search';
            break;
        case 'success':
            badgeClass = 'bg-success';
            icon = 'fas fa-check-circle';
            break;
        case 'error':
            badgeClass = 'bg-danger';
            icon = 'fas fa-exclamation-circle';
            break;
        case 'warning':
            badgeClass = 'bg-warning';
            icon = 'fas fa-exclamation-triangle';
            break;
        default:
            badgeClass = 'bg-secondary';
            icon = 'fas fa-info-circle';
    }
    
    statusElement.className = `badge ${badgeClass}`;
    statusElement.innerHTML = `<i class="${icon} me-1"></i>${status}`;
}

function showAllPatients() {
    elements.patientTableBody.innerHTML = '';
    
    // 모든 처방전을 최신 순으로 정렬
    const sortedPrescriptions = Object.values(parsedPrescriptions)
        .sort((a, b) => {
            // receipt_time을 기준으로 내림차순 정렬 (최신이 위로)
            return b.patient.receipt_time.localeCompare(a.patient.receipt_time);
        });
    
    sortedPrescriptions.forEach(prescription => {
        const row = document.createElement('tr');
        
        // 기존 전송상태 확인
        const savedStatus = transmissionStatus[prescription.patient.receipt_number];
        let statusBadge = '<span class="badge bg-secondary">대기</span>';
        
        if (savedStatus) {
            const badgeClass = savedStatus === '완료' ? 'bg-success' : 'bg-danger';
            statusBadge = `<span class="badge ${badgeClass}">${savedStatus}</span>`;
        }
        
        row.innerHTML = `
            <td>${prescription.patient.name}</td>
            <td>${prescription.patient.receipt_time}</td>
            <td>${prescription.patient.receipt_number}</td>
            <td>${statusBadge}</td>
        `;
        row.dataset.receiptNumber = prescription.patient.receipt_number;
        elements.patientTableBody.appendChild(row);
    });
    
    logMessage(`전체 환자 목록 표시: ${sortedPrescriptions.length}명 (최신 순 정렬)`);
}

// 전송 상태 저장
async function saveTransmissionStatus() {
    try {
        const data = JSON.stringify(transmissionStatus);
        const filePath = await getConfigFilePath('transmission_status.json');
        fs.writeFileSync(filePath, data, 'utf8');
        console.log('[saveTransmissionStatus] 전송상태 저장됨:', Object.keys(transmissionStatus).length, '개');
    } catch (error) {
        console.error('[saveTransmissionStatus] 저장 오류:', error.message);
    }
}

// 전송 상태 로드
async function loadTransmissionStatus() {
    try {
        const filePath = await getConfigFilePath('transmission_status.json');
        if (fs.existsSync(filePath)) {
            const data = fs.readFileSync(filePath, 'utf8');
            transmissionStatus = JSON.parse(data);
            
            // 기존 문자열 상태를 숫자로 변환 (호환성)
            Object.keys(transmissionStatus).forEach(key => {
                const status = transmissionStatus[key];
                if (typeof status === 'string') {
                    if (status === '성공' || status === '완료') {
                        transmissionStatus[key] = 0; // 기존 성공 상태를 0으로 초기화 (새로운 전송 횟수 계산을 위해)
                    } else if (status === '실패' || status === '대기' || status === '대기중') {
                        transmissionStatus[key] = 0;
                    }
                }
            });
            
            console.log('[loadTransmissionStatus] 전송상태 로드됨:', Object.keys(transmissionStatus).length, '개');
        } else {
            // 파일이 존재하지 않으면 빈 객체로 초기화
            transmissionStatus = {};
            console.log('[loadTransmissionStatus] 전송상태 파일이 없어 빈 객체로 초기화');
        }
    } catch (error) {
        console.error('[loadTransmissionStatus] 로드 오류:', error.message);
        transmissionStatus = {};
    }
}

// 약물별 전송 상태 저장
async function saveMedicineTransmissionStatus() {
    try {
        const data = JSON.stringify(medicineTransmissionStatus);
        const filePath = await getConfigFilePath('medicine_transmission_status.json');
        fs.writeFileSync(filePath, data, 'utf8');
        console.log('[saveMedicineTransmissionStatus] 약물별 전송상태 저장됨:', Object.keys(medicineTransmissionStatus).length, '개');
    } catch (error) {
        console.error('[saveMedicineTransmissionStatus] 저장 오류:', error.message);
    }
}

// 약물별 전송 상태 로드
async function loadMedicineTransmissionStatus() {
    try {
        const filePath = await getConfigFilePath('medicine_transmission_status.json');
        if (fs.existsSync(filePath)) {
            const data = fs.readFileSync(filePath, 'utf8');
            medicineTransmissionStatus = JSON.parse(data);
            
            // 기존 문자열 상태를 숫자로 변환 (호환성)
            Object.keys(medicineTransmissionStatus).forEach(key => {
                const status = medicineTransmissionStatus[key];
                if (typeof status === 'string') {
                    if (status === '성공' || status === '완료') {
                        medicineTransmissionStatus[key] = 0; // 기존 성공 상태를 0으로 초기화 (새로운 전송 횟수 계산을 위해)
                    } else if (status === '실패' || status === '대기' || status === '대기중') {
                        medicineTransmissionStatus[key] = 0;
                    }
                    // '등록되지 않은 약물'은 그대로 유지
                }
            });
            
            console.log('[loadMedicineTransmissionStatus] 약물별 전송상태 로드됨:', Object.keys(medicineTransmissionStatus).length, '개');
        } else {
            // 파일이 존재하지 않으면 빈 객체로 초기화
            medicineTransmissionStatus = {};
            console.log('[loadMedicineTransmissionStatus] 약물별 전송상태 파일이 없어 빈 객체로 초기화');
        }
    } catch (error) {
        console.error('[loadMedicineTransmissionStatus] 로드 오류:', error.message);
        medicineTransmissionStatus = {};
    }
}

// 약물별 전송 상태 업데이트
async function updateMedicineTransmissionStatus(receiptNumber, medicineCode, status, forceUpdate = false) {
    console.log('[updateMedicineTransmissionStatus] 호출됨:', receiptNumber, medicineCode, status, 'forceUpdate:', forceUpdate);
    
    const key = `${receiptNumber}_${medicineCode}`;
    const currentStatus = medicineTransmissionStatus[key];
    
    // 상태 보호 로직: 이미 성공한 약물은 실패로 덮어쓰지 않음 (재전송 시 제외)
    if (isSuccessStatus(currentStatus) && status === 0 && !forceUpdate) {
        console.log(`[updateMedicineTransmissionStatus] 상태 보호: ${medicineCode}는 이미 성공 상태이므로 실패로 변경하지 않음`);
        logMessage(`약물 ${medicineCode} 상태 보호: 이미 성공 상태 유지`);
        return;
    }
    
    // 상태 업데이트
    medicineTransmissionStatus[key] = status;
    
    // 파일에 저장
    await saveMedicineTransmissionStatus();
    
    // 현재 표시된 약물 테이블에서 해당 약물의 상태 업데이트
    const rows = elements.medicineTableBody.querySelectorAll('tr:not(.empty-row)');
    let updated = false;
    
    rows.forEach(row => {
        if (row.dataset.pillCode === medicineCode) {
            const statusCell = row.cells[7]; // 8번째 컬럼 (0부터 시작하므로 7) - 전송상태
            const badgeClass = getStatusBadgeClass(status);
            const statusText = getStatusText(status);
            statusCell.innerHTML = `<span class="badge ${badgeClass}">${statusText}</span>`;
            updated = true;
            console.log('[updateMedicineTransmissionStatus] 약물 상태 업데이트 성공:', medicineCode, status, '배지클래스:', badgeClass);
            logMessage(`약물 ${medicineCode} 상태 업데이트: ${status}`);
        }
    });
    
    // 현재 환자 테이블에서도 전송상태 업데이트
    updatePatientTransmissionStatus(receiptNumber);
    
    // 행 색상 업데이트
    updateMedicineRowColors();
    
    if (!updated) {
        console.log('[updateMedicineTransmissionStatus] 현재 표시된 테이블에서 약물을 찾을 수 없음:', medicineCode);
    }
}

// 환자별 전송상태 업데이트
function updatePatientTransmissionStatus(receiptNumber) {
    const prescription = parsedPrescriptions[receiptNumber];
    if (!prescription) return;
    
    // 기존에 저장된 환자 전송상태 확인
    const existingStatus = transmissionStatus[receiptNumber];
    
    // 등록된 약물들만 필터링하여 상태 확인
    const registeredMedicineStatuses = prescription.medicines
        .filter(medicine => isMedicineRegistered(medicine.pill_code))
        .map(medicine => {
            const key = `${receiptNumber}_${medicine.pill_code}`;
            return medicineTransmissionStatus[key] || 0;
        });
    
    console.log(`[updatePatientTransmissionStatus] 등록된 약물 상태들:`, registeredMedicineStatuses);
    console.log(`[updatePatientTransmissionStatus] 기존 환자 상태:`, existingStatus);
    
    // 전체 상태 결정 - 약물들의 최대 전송횟수를 반영
    let overallStatus = 0;
    
    if (registeredMedicineStatuses.length === 0) {
        // 등록된 약물이 없는 경우
        overallStatus = 0;
        logMessage(`환자 ${receiptNumber}: 등록된 약물이 없음`);
    } else {
        // 등록된 약물들의 최대 전송횟수를 환자 전체 상태로 설정
        const numericStatuses = registeredMedicineStatuses.filter(s => typeof s === 'number');
        if (numericStatuses.length > 0) {
            const maxCount = Math.max(...numericStatuses);
            overallStatus = maxCount;
            logMessage(`환자 ${receiptNumber}: 약물들의 최대 전송 횟수: ${maxCount}`);
        } else {
            // 숫자가 아닌 상태들만 있는 경우 (예: "등록되지 않은 약물")
            overallStatus = 0;
            logMessage(`환자 ${receiptNumber}: 숫자 상태가 없음, 0으로 설정`);
        }
    }
    
    // 환자 테이블에서 해당 환자의 전송상태 업데이트
    const patientRows = elements.patientTableBody.querySelectorAll('tr');
    patientRows.forEach(row => {
        if (row.dataset.receiptNumber === receiptNumber) {
            const statusCell = row.cells[3]; // 4번째 컬럼 (0부터 시작하므로 3)
            const badgeClass = getStatusBadgeClass(overallStatus);
            const statusText = getStatusText(overallStatus);
            statusCell.innerHTML = `<span class="badge ${badgeClass}">${statusText}</span>`;
            console.log('[updatePatientTransmissionStatus] 환자 전송상태 업데이트:', receiptNumber, overallStatus);
        }
    });
    
    // 전송상태 저장
    transmissionStatus[receiptNumber] = overallStatus;
    saveTransmissionStatus();
}



// 테이블에서 선택된 약물들 재전송
async function retrySelectedMedicinesFromTable() {
    let selectedPatient = document.querySelector('#patientTableBody tr.table-primary');
    if (!selectedPatient) {
        showMessage('warning', '환자를 선택해주세요.');
        return;
    }
    
    const receiptNumber = selectedPatient.dataset.receiptNumber;
    const prescription = parsedPrescriptions[receiptNumber];
    if (!prescription) {
        showMessage('error', '처방전 정보를 찾을 수 없습니다.');
        return;
    }
    
    // 선택된 약물들만 필터링
    const selectedMedicines = prescription.medicines.filter(medicine => {
        const checkbox = document.querySelector(`.medicine-checkbox[data-pill-code="${medicine.pill_code}"]`);
        return checkbox && checkbox.checked;
    });
    
    if (selectedMedicines.length === 0) {
        showMessage('warning', '재전송할 약물을 선택해주세요.');
        return;
    }
    
    // 재전송 실행
    await retrySelectedMedicines(selectedMedicines);
}

// 선택된 약물들 재전송
async function retrySelectedMedicines(selectedMedicines) {
    let selectedPatient = document.querySelector('#patientTableBody tr.table-primary');
    if (!selectedPatient) {
        showMessage('error', '환자 정보를 찾을 수 없습니다.');
        return;
    }
    
    const receiptNumber = selectedPatient.dataset.receiptNumber;
    
    logMessage(`선택된 약물 ${selectedMedicines.length}개를 병렬 재전송합니다.`);
    
    // 조제 시작 시 연결 상태 확인 일시 중단
    if (connectionCheckInterval) {
        clearInterval(connectionCheckInterval);
        connectionCheckInterval = null;
        logMessage('재전송 시작 - 연결 상태 확인 일시 중단');
    }
    
    // 조제 진행 중 플래그 설정 및 연결 상태 확인 지연 시작
    isDispensingInProgress = true;
    startConnectionCheckDelay(60); // 60초 동안 연결 상태 확인 지연
    
    // 선택된 약물들을 병렬로 재전송
    const retryPromises = selectedMedicines.map(async (medicine) => {
        const connectedDevice = Object.values(connectedDevices).find(device => 
            device.pill_code === medicine.pill_code && device.status === '연결됨'
        );
        
        if (!connectedDevice) {
            logMessage(`${medicine.pill_name}은(는) 연결되지 않은 약물이므로 건너뜁니다.`);
            return {
                success: false,
                medicine: medicine,
                reason: '연결되지 않은 약물'
            };
        }
        
        logMessage(`병렬 재전송 시작: ${medicine.pill_name}, 코드: ${medicine.pill_code}, 총량: ${medicine.total}`);
        
        // 조제 시작 전에 상태를 "시럽 조제 중"으로 변경
        connectedDevice.status = '시럽 조제 중';
        updateConnectedTable();
        logMessage(`${medicine.pill_name} 재전송 시작 - 기기 상태를 '시럽 조제 중'으로 변경`);
        
        try {
            const data = `TV${medicine.total} FF FF FF`;
            const response = await makeStableRequest(`http://${connectedDevice.ip}/dispense`, {
                amount: data
            }, {
                timeout: COMMUNICATION_CONFIG.TIMEOUTS.RETRY
            });
            
            if (response.status === 200) {
                logMessage(`${medicine.pill_name} 재전송 성공`);
                
                // 성공 시 약물 전송상태를 증가
                const key = `${receiptNumber}_${medicine.pill_code}`;
                const currentStatus = medicineTransmissionStatus[key] || 0;
                const newStatus = incrementTransmissionCount(currentStatus);
                await updateMedicineTransmissionStatus(receiptNumber, medicine.pill_code, newStatus, true);
                
                // 성공 시 30초 후에 상태를 "연결됨"으로 복원 (조제 시간 고려)
                setTimeout(() => {
                    connectedDevice.status = '연결됨';
                    updateConnectedTable();
                    logMessage(`${medicine.pill_name} 재전송 완료 - 기기 상태를 '연결됨'으로 복원`);
                }, 30000);
                
                return {
                    success: true,
                    medicine: medicine,
                    device: connectedDevice
                };
            } else {
                logMessage(`${medicine.pill_name} 재전송 실패: ${response.status}`);
                connectedDevice.status = '연결됨';
                updateConnectedTable();
                logMessage(`${medicine.pill_name} 재전송 실패 - 기기 상태를 '연결됨'으로 복원`);
                
                await updateMedicineTransmissionStatus(receiptNumber, medicine.pill_code, 0); // 실패는 0으로 표시
                
                return {
                    success: false,
                    medicine: medicine,
                    device: connectedDevice,
                    reason: `HTTP 오류 (${response.status})`
                };
            }
        } catch (error) {
            logMessage(`${medicine.pill_name} 재전송 중 오류: ${error.message}`);
            connectedDevice.status = '연결됨';
            updateConnectedTable();
            logMessage(`${medicine.pill_name} 재전송 오류 - 기기 상태를 '연결됨'으로 복원`);
            
            await updateMedicineTransmissionStatus(receiptNumber, medicine.pill_code, 0); // 실패는 0으로 표시
            
            return {
                success: false,
                medicine: medicine,
                device: connectedDevice,
                reason: error.message.includes('timeout') ? '통신 타임아웃 (10초 초과)' : 
                       error.message.includes('ECONNREFUSED') ? '연결 거부' :
                       error.message.includes('ENETUNREACH') ? '네트워크 연결 불가' : 
                       `통신 오류: ${error.message}`
            };
        }
    });
    
    // 모든 재전송 완료 대기
    const results = await Promise.all(retryPromises);
    
    // 결과 분석
    const successMedicines = results.filter(result => result.success).map(result => result.medicine);
    const failedMedicinesRetry = results.filter(result => !result.success).map(result => ({
        name: result.medicine.pill_name,
        code: result.medicine.pill_code,
        reason: result.reason
    }));
    
    const totalRetry = selectedMedicines.length;
    const successCount = successMedicines.length;
    const failedCount = failedMedicinesRetry.length;
    
    if (failedCount === 0) {
        showMessage('success', `모든 선택한 약물 재전송이 성공적으로 완료되었습니다.\n성공: ${successCount}개`);
    } else {
        let errorMessage = `재전송 결과:\n• 성공: ${successCount}개\n• 실패: ${failedCount}개\n\n`;
        
        if (failedMedicinesRetry.length > 0) {
            errorMessage += '▼ 재전송 실패 약물:\n';
            failedMedicinesRetry.forEach(medicine => {
                errorMessage += `• ${medicine.name} (${medicine.code})\n  → ${medicine.reason}\n`;
            });
        }
        
        showMessage('warning', errorMessage);
        logMessage(`재전송 결과: ${errorMessage}`);
    }
}

// 실패한 약물만 재전송 (기존 함수 - 호환성 유지)
async function retryFailedMedicines() {
    let selectedPatient = document.querySelector('#patientTableBody tr.table-primary');
    if (!selectedPatient) {
        showMessage('warning', '환자를 선택해주세요.');
        return;
    }
    
    const receiptNumber = selectedPatient.dataset.receiptNumber;
    const prescription = parsedPrescriptions[receiptNumber];
    if (!prescription) {
        showMessage('error', '처방전 정보를 찾을 수 없습니다.');
        return;
    }
    
    // 실패한 약물들만 필터링 (등록된 약물 중에서만) - 상태가 0인 약물들
    const failedMedicines = prescription.medicines.filter(medicine => {
        const key = `${receiptNumber}_${medicine.pill_code}`;
        return medicineTransmissionStatus[key] === 0 && isMedicineRegistered(medicine.pill_code);
    });
    
    // 등록되지 않은 약물들도 확인
    const unregisteredMedicines = prescription.medicines.filter(medicine => {
        const key = `${receiptNumber}_${medicine.pill_code}`;
        return medicineTransmissionStatus[key] === 0 && !isMedicineRegistered(medicine.pill_code);
    });
    
    if (failedMedicines.length === 0 && unregisteredMedicines.length === 0) {
        showMessage('info', '재전송할 실패한 약물이 없습니다.');
        return;
    }
    
    if (unregisteredMedicines.length > 0) {
        logMessage(`등록되지 않은 약물 ${unregisteredMedicines.length}개는 재전송에서 제외됩니다.`);
    }
    
    if (failedMedicines.length === 0) {
        showMessage('info', '재전송할 수 있는 실패한 약물이 없습니다. (등록되지 않은 약물은 재전송 불가)');
        return;
    }
    
    logMessage(`실패한 약물 ${failedMedicines.length}개를 병렬 재전송합니다.`);
    
    // 조제 시작 시 연결 상태 확인 일시 중단
    if (connectionCheckInterval) {
        clearInterval(connectionCheckInterval);
        connectionCheckInterval = null;
        logMessage('재전송 시작 - 연결 상태 확인 일시 중단');
    }
    
    // 조제 진행 중 플래그 설정 및 연결 상태 확인 지연 시작
    isDispensingInProgress = true;
    startConnectionCheckDelay(60); // 60초 동안 연결 상태 확인 지연
    
    // 연결된 실패한 약물들만 필터링
    const connectedFailedMedicines = failedMedicines.filter(medicine => {
        const connectedDevice = Object.values(connectedDevices).find(device => 
            device.pill_code === medicine.pill_code && device.status === '연결됨'
        );
        return connectedDevice !== undefined;
    });
    
    const notConnectedMedicines = failedMedicines.filter(medicine => {
        const connectedDevice = Object.values(connectedDevices).find(device => 
            device.pill_code === medicine.pill_code && device.status === '연결됨'
        );
        return connectedDevice === undefined;
    });
    
    // 연결되지 않은 약물들을 실패 상태로 표시
    notConnectedMedicines.forEach(medicine => {
        logMessage(`${medicine.pill_name}은(는) 연결되지 않은 약물이므로 건너뜁니다.`);
    });
    
    if (connectedFailedMedicines.length === 0) {
        showMessage('warning', '재전송할 연결된 약물이 없습니다.');
        return;
    }
    
    // 모든 실패한 약물을 병렬로 재전송
    const retryPromises = connectedFailedMedicines.map(async (medicine) => {
        const connectedDevice = Object.values(connectedDevices).find(device => 
            device.pill_code === medicine.pill_code && device.status === '연결됨'
        );
        
        logMessage(`병렬 재전송 시작: ${medicine.pill_name}, 코드: ${medicine.pill_code}, 총량: ${medicine.total}`);
        
        // 조제 시작 전에 상태를 "시럽 조제 중"으로 변경
        connectedDevice.status = '시럽 조제 중';
        updateConnectedTable();
        logMessage(`${medicine.pill_name} 재전송 시작 - 기기 상태를 '시럽 조제 중'으로 변경`);
        
        // 약물 전송상태는 변경하지 않음 (전송 결과에 따라만 변경)
        
        try {
            const data = `TV${medicine.total} FF FF FF`;
            const response = await makeStableRequest(`http://${connectedDevice.ip}/dispense`, {
                amount: data
            }, {
                timeout: COMMUNICATION_CONFIG.TIMEOUTS.RETRY
            });
            
            if (response.status === 200) {
                logMessage(`${medicine.pill_name} 재전송 성공`);
                
                // 성공 시 약물 전송상태를 증가 (재전송이므로 forceUpdate = true)
                const key = `${receiptNumber}_${medicine.pill_code}`;
                const currentStatus = medicineTransmissionStatus[key] || 0;
                const newStatus = incrementTransmissionCount(currentStatus);
                await updateMedicineTransmissionStatus(receiptNumber, medicine.pill_code, newStatus, true);
                
                // 성공 시 30초 후에 상태를 "연결됨"으로 복원 (조제 시간 고려)
                setTimeout(() => {
                    connectedDevice.status = '연결됨';
                    updateConnectedTable();
                    logMessage(`${medicine.pill_name} 재전송 완료 - 기기 상태를 '연결됨'으로 복원`);
                }, 30000);
                
                return {
                    success: true,
                    medicine: medicine,
                    device: connectedDevice
                };
            } else {
                logMessage(`${medicine.pill_name} 재전송 실패: ${response.status}`);
                connectedDevice.status = '연결됨';
                updateConnectedTable();
                logMessage(`${medicine.pill_name} 재전송 실패 - 기기 상태를 '연결됨'으로 복원`);
                
                await updateMedicineTransmissionStatus(receiptNumber, medicine.pill_code, 0); // 실패는 0으로 표시
                
                return {
                    success: false,
                    medicine: medicine,
                    device: connectedDevice,
                    reason: `HTTP 오류 (${response.status})`
                };
            }
        } catch (error) {
            logMessage(`${medicine.pill_name} 재전송 중 오류: ${error.message}`);
            connectedDevice.status = '연결됨';
            updateConnectedTable();
            logMessage(`${medicine.pill_name} 재전송 오류 - 기기 상태를 '연결됨'으로 복원`);
            
            await updateMedicineTransmissionStatus(receiptNumber, medicine.pill_code, 0); // 실패는 0으로 표시
            
            return {
                success: false,
                medicine: medicine,
                device: connectedDevice,
                reason: error.message.includes('timeout') ? '통신 타임아웃 (10초 초과)' : 
                       error.message.includes('ECONNREFUSED') ? '연결 거부' :
                       error.message.includes('ENETUNREACH') ? '네트워크 연결 불가' : 
                       `통신 오류: ${error.message}`
            };
        }
    });
    
    // 모든 재전송 완료 대기
    const results = await Promise.all(retryPromises);
    
    // 결과 분석
    const successMedicines = results.filter(result => result.success).map(result => result.medicine);
    const failedMedicinesRetry = results.filter(result => !result.success).map(result => ({
        name: result.medicine.pill_name,
        code: result.medicine.pill_code,
        reason: result.reason
    }));
    
    const totalRetry = connectedFailedMedicines.length;
    const successCount = successMedicines.length;
    const failedCount = failedMedicinesRetry.length + notConnectedMedicines.length;
    
    if (failedCount === 0) {
        // showMessage('success', `모든 실패한 약물 재전송이 성공적으로 완료되었습니다.\n성공: ${successCount}개`);
    } else {
        let errorMessage = `재전송 결과:\n• 성공: ${successCount}개\n• 실패: ${failedCount}개\n\n`;
        
        if (failedMedicinesRetry.length > 0) {
            errorMessage += '▼ 재전송 실패 약물:\n';
            failedMedicinesRetry.forEach(medicine => {
                errorMessage += `• ${medicine.name} (${medicine.code})\n  → ${medicine.reason}\n`;
            });
        }
        
        if (notConnectedMedicines.length > 0) {
            errorMessage += '\n▼ 연결되지 않은 약물:\n';
            notConnectedMedicines.forEach(medicine => {
                errorMessage += `• ${medicine.name} (${medicine.code})\n  → 시럽조제기 연결 필요\n`;
            });
        }
        
        logMessage(`재전송 결과: ${errorMessage}`);
    }
}

// 약물별 전송 상태 초기화
function resetMedicineTransmissionStatus() {
    let selectedPatient = document.querySelector('#patientTableBody tr.table-primary');
    if (!selectedPatient) {
        showMessage('warning', '환자를 선택해주세요.');
        return;
    }
    
    const receiptNumber = selectedPatient.dataset.receiptNumber;
    const prescription = parsedPrescriptions[receiptNumber];
    if (!prescription) {
        showMessage('error', '처방전 정보를 찾을 수 없습니다.');
        return;
    }
    
    // 해당 환자의 모든 약물 전송상태를 0으로 초기화
    prescription.medicines.forEach(medicine => {
        const key = `${receiptNumber}_${medicine.pill_code}`;
        
        // 등록되지 않은 약물은 "등록되지 않은 약물" 상태로 유지
        if (!isMedicineRegistered(medicine.pill_code)) {
            medicineTransmissionStatus[key] = '등록되지 않은 약물';
        } else {
            medicineTransmissionStatus[key] = 0;
        }
    });
    
    // 파일에 저장
    saveMedicineTransmissionStatus();
    
    // 현재 표시된 약물 테이블 업데이트
    loadPatientMedicines(receiptNumber);
    
    showMessage('info', '약물별 전송상태가 초기화되었습니다.');
}

// 약물별 전송 상태에 따른 행 색상 업데이트
function updateMedicineRowColors() {
    const rows = elements.medicineTableBody.querySelectorAll('tr:not(.empty-row)');
    rows.forEach(row => {
        const pillCode = row.dataset.pillCode;
        if (!pillCode) return;
        
        // 기존 상태 클래스 제거
        row.classList.remove('medicine-success', 'medicine-failed', 'medicine-dispensing');
        
        // 현재 선택된 환자 확인
        const selectedPatient = document.querySelector('#patientTableBody tr.table-primary');
        if (!selectedPatient) return;
        
        const receiptNumber = selectedPatient.dataset.receiptNumber;
        const key = `${receiptNumber}_${pillCode}`;
        const status = medicineTransmissionStatus[key];
        
        // 상태에 따른 클래스 추가
        if (isSuccessStatus(status)) {
            row.classList.add('medicine-success');
        } else if (status === 0) {
            row.classList.add('medicine-failed');
        } else if (status === '조제중') {
            row.classList.add('medicine-dispensing');
        }
    });
}

// 연결 상태 확인 지연 시작
function startConnectionCheckDelay(delaySeconds = 60) {
    logMessage(`조제 후 연결 상태 확인을 ${delaySeconds}초 동안 지연시킵니다.`);
    
    // 기존 지연 타이머가 있으면 취소
    if (connectionCheckDelayTimer) {
        clearTimeout(connectionCheckDelayTimer);
    }
    
    // 조제 진행 중 플래그 설정
    isDispensingInProgress = true;
    
    // 지연 시간 후에 연결 상태 확인 재시작
    connectionCheckDelayTimer = setTimeout(() => {
        isDispensingInProgress = false;
        connectionCheckDelayTimer = null;
        
        // 연결 상태 확인 재시작
        if (!connectionCheckInterval) {
            connectionCheckInterval = setInterval(checkConnectionStatus, 15000);
            logMessage('조제 후 지연 시간 완료 - 연결 상태 확인 재시작');
        }
    }, delaySeconds * 1000);
}

// 연결 상태 확인 지연 취소
function cancelConnectionCheckDelay() {
    if (connectionCheckDelayTimer) {
        clearTimeout(connectionCheckDelayTimer);
        connectionCheckDelayTimer = null;
        isDispensingInProgress = false;
        logMessage('연결 상태 확인 지연이 취소되었습니다.');
    }
}

// 저장된 시럽조제기 목록에서 약물 코드 확인
function isMedicineRegistered(pillCode) {
    return Object.values(savedConnections).some(device => device.pill_code === pillCode);
}

// 수동조제 행 동적 관리
let manualRowId = 0;
let manualRows = [];

function showManualPage() {
    elements.mainPage.style.display = 'none';
    elements.networkPage.style.display = 'none';
    document.getElementById('manualPage').style.display = 'block';
    renderManualRows();
}

function renderManualRows() {
    const container = document.getElementById('manualRowsContainer');
    container.innerHTML = '';
    manualRows.forEach(row => {
        container.appendChild(row.elem);
    });
}

// 수동조제 줄 상태 저장/복원
const MANUAL_ROWS_STORAGE_KEY = 'manualRowsState';

function saveManualRowsState() {
    const state = manualRows.map(row => ({
        mac: row.getSelectedMac ? row.getSelectedMac() : null,
        total: row.getTotal ? row.getTotal() : ''
    }));
    localStorage.setItem(MANUAL_ROWS_STORAGE_KEY, JSON.stringify(state));
}

function loadManualRowsState() {
    try {
        const state = JSON.parse(localStorage.getItem(MANUAL_ROWS_STORAGE_KEY));
        if (!Array.isArray(state) || state.length === 0) return false;
        manualRows = state.map(item => createManualRow(item.mac, item.total));
        renderManualRows();
        return true;
    } catch {
        return false;
    }
}

// createManualRow(mac, total)로 수정
function createManualRow(initMac = null, initTotal = '') {
    const rowId = ++manualRowId;
    let selectedMac = initMac;

    // 행 컨테이너
    const rowDiv = document.createElement('div');
    rowDiv.className = 'manual-row d-flex align-items-center gap-2 mb-2';
    rowDiv.dataset.rowId = rowId;

    // 시럽조제기 드롭다운 ...
    const dropdownDiv = document.createElement('div');
    dropdownDiv.className = 'dropdown flex-grow-1';
    const dropdownBtn = document.createElement('button');
    dropdownBtn.className = 'btn btn-outline-primary btn-sm dropdown-toggle w-100';
    dropdownBtn.type = 'button';
    dropdownBtn.dataset.bsToggle = 'dropdown';
    dropdownBtn.ariaExpanded = 'false';
    dropdownBtn.textContent = '시럽조제기를 선택하세요';
    const dropdownList = document.createElement('ul');
    dropdownList.className = 'dropdown-menu w-100';

    // 복원 시 드롭다운 텍스트 세팅
    if (initMac && savedConnections[initMac]) {
        const info = savedConnections[initMac];
        dropdownBtn.textContent = `${info.nickname} (MAC: ${initMac})`;
    }

    dropdownBtn.addEventListener('click', () => {
        dropdownList.innerHTML = '';
        Object.entries(savedConnections).forEach(([mac, info]) => {
            const li = document.createElement('li');
            li.className = 'dropdown-item';
            li.textContent = `${info.nickname} (MAC: ${mac})`;
            li.onclick = () => {
                selectedMac = mac;
                dropdownBtn.textContent = `${info.nickname} (MAC: ${mac})`;
                updateStatus();
                saveManualRowsState();
            };
            dropdownList.appendChild(li);
        });
    });
    dropdownDiv.appendChild(dropdownBtn);
    dropdownDiv.appendChild(dropdownList);

    // 연결상태 ...
    const statusSpan = document.createElement('span');
    statusSpan.className = 'status-disconnected badge';
    statusSpan.style.minWidth = '60px';
    statusSpan.textContent = '-';
    function updateStatus() {
        if (!selectedMac) {
            statusSpan.textContent = '-';
            statusSpan.className = 'status-disconnected';
            return;
        }
        let status = '연결끊김';
        let statusClass = 'status-disconnected';
        if (connectedDevices[selectedMac] && connectedDevices[selectedMac].status === '연결됨') {
            status = '연결됨';
            statusClass = 'status-connected';
        }
        statusSpan.textContent = status;
        statusSpan.className = statusClass;
    }

    // 총량 입력 ...
    const totalInput = document.createElement('input');
    totalInput.type = 'number';
    totalInput.className = 'form-control form-control-sm';
    totalInput.placeholder = '총량';
    totalInput.style.maxWidth = '80px';
    totalInput.value = initTotal;
    totalInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            sendBtn.click();
        }
    });
    totalInput.addEventListener('input', saveManualRowsState);

    // 전송 버튼 ...
    const sendBtn = document.createElement('button');
    sendBtn.className = 'btn btn-success btn-sm';
    sendBtn.innerHTML = '<i class="fas fa-paper-plane me-1"></i>전송';
    sendBtn.style.minWidth = '60px';
    sendBtn.onclick = async function() {
        await sendManualDispense(false); // 일반 전송
    };

    // 긴급 전송 버튼 ...
    const urgentBtn = document.createElement('button');
    urgentBtn.className = 'btn btn-danger btn-sm';
    urgentBtn.innerHTML = '<i class="fas fa-exclamation-triangle me-1"></i>긴급';
    urgentBtn.style.minWidth = '60px';
    urgentBtn.onclick = async function() {
        await sendManualDispense(true); // 긴급 전송
    };

    // 전송 함수 (일반/긴급 통합)
    async function sendManualDispense(isUrgent) {
        if (!selectedMac) {
            await showMessage('warning', '시럽조제기를 선택하세요.');
            return;
        }
        const info = savedConnections[selectedMac];
        const total = totalInput.value;
        if (!total || isNaN(total) || Number(total) <= 0) {
            await showMessage('warning', '총량을 올바르게 입력하세요.');
            return;
        }
        
        // 시럽 최대량 검증
        if (Number(total) > maxSyrupAmount) {
            const message = `총량 ${total}mL가 설정된 최대량 ${maxSyrupAmount}mL를 초과합니다.\n\n해결 방법:\n• 설정에서 시럽 최대량을 ${total}mL 이상으로 조정\n• 더 작은 용량으로 분할하여 전송\n• 현재 설정: ${maxSyrupAmount}mL`;
            await showMessage('warning', message);
            return;
        }
        
        if (!connectedDevices[selectedMac] || connectedDevices[selectedMac].status !== '연결됨') {
            await showMessage('warning', '선택한 시럽조제기가 연결되어 있지 않습니다.');
            return;
        }
        
        const device = connectedDevices[selectedMac];
        const statusId = addManualStatus({ 
            syrupName: info.nickname, 
            mac: selectedMac, 
            total: total + (isUrgent ? ' (긴급)' : '')
        });
        
        try {
            // 조제 시작 - 기기 상태를 "시럽 조제 중"으로 변경
            device.status = '시럽 조제 중';
            dispensingDevices.add(device.ip); // 조제 중인 기기 목록에 추가
            updateConnectedTable();
            updateStatus();
            
            const data = {
                patient_name: isUrgent ? '긴급조제' : '수동조제',
                total_volume: total,
                urgent: isUrgent
            };
            
            const response = await axios.post(`http://${device.ip}/dispense`, data, {
                timeout: 30000,
                headers: { 'Content-Type': 'application/json' }
            });
            
            logMessage(`수동조제 응답: ${JSON.stringify(response.data)}`);
            
            // 모든 200 응답(BUSY 포함)을 성공으로 처리
            if (response.data === "BUSY") {
                logMessage(`수동조제: 조제 중 - 대기열에 추가됨 (성공으로 처리)`);
            } else {
                logMessage(`수동조제: 데이터 전송 성공`);
            }
            updateManualStatus(statusId, '완료');
            totalInput.value = '';
            totalInput.placeholder = '총량';
            
            // 조제 완료 - 기기 상태를 "연결됨"으로 복구
            device.status = '연결됨';
            dispensingDevices.delete(device.ip); // 조제 중인 기기 목록에서 제거
            updateConnectedTable();
            updateStatus();
            saveManualRowsState();
            
        } catch (error) {
            updateManualStatus(statusId, '실패');
            logMessage(`수동조제 전송 실패: ${error.message}`);
            
            // 실패 시에도 기기 상태를 "연결됨"으로 복구
            if (connectedDevices[selectedMac]) {
                device.status = '연결됨';
                dispensingDevices.delete(device.ip); // 조제 중인 기기 목록에서 제거
                updateConnectedTable();
                updateStatus();
            }
        }
    }

    // 행 삭제 버튼 ...
    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-outline-danger btn-sm';
    delBtn.innerHTML = '<i class="fas fa-times"></i>';
    delBtn.style.minWidth = '40px';
    delBtn.onclick = function() {
        manualRows = manualRows.filter(r => r.id !== rowId);
        renderManualRows();
        saveManualRowsState();
    };

    // 버튼들을 담을 컨테이너 생성
    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'd-flex gap-1';
    buttonContainer.appendChild(sendBtn);
    buttonContainer.appendChild(urgentBtn);
    buttonContainer.appendChild(delBtn);

    rowDiv.appendChild(dropdownDiv);
    rowDiv.appendChild(statusSpan);
    rowDiv.appendChild(totalInput);
    rowDiv.appendChild(buttonContainer);

    // getter for 저장
    function getSelectedMac() { return selectedMac; }
    function getTotal() { return totalInput.value; }

    return { id: rowId, elem: rowDiv, updateStatus, getSelectedMac, getTotal };
}

// 줄 추가 버튼 이벤트
if (document.getElementById('addManualRowBtn')) {
    document.getElementById('addManualRowBtn').onclick = function() {
        manualRows.push(createManualRow());
        renderManualRows();
        saveManualRowsState();
    };
}

// 수동조제 페이지 진입 시 저장된 줄 복원, 없으면 1줄 생성
if (document.getElementById('manualPage')) {
    if (!loadManualRowsState()) {
        manualRows = [createManualRow()];
        renderManualRows();
    }
}

// 수동조제 행 상태 전체 갱신
function updateAllManualRowStatus() {
    manualRows.forEach(row => {
        if (row && typeof row.updateStatus === 'function') {
            row.updateStatus();
        }
    });
}

// 기존 updateConnectedTable 함수 마지막에 추가
const _origUpdateConnectedTable = updateConnectedTable;
updateConnectedTable = function() {
    _origUpdateConnectedTable.apply(this, arguments);
    updateAllManualRowStatus();
};

// manualPage 진입시에는 복원하지 않음 (중복 방지)
if (document.getElementById('manualPage')) {
    // 복원은 loadConnections에서만!
    if (!fs.existsSync('connections.json')) {
        manualRows = [createManualRow()];
        renderManualRows();
    }
}

// 설정 파일 경로 관리
let userDataPath = '';

// 사용자 데이터 디렉토리 경로 가져오기
async function getUserDataPath() {
    if (!userDataPath) {
        userDataPath = await ipcRenderer.invoke('get-user-data-path');
    }
    return userDataPath;
}

// 설정 파일 경로 생성
async function getConfigFilePath(filename) {
    const userData = await getUserDataPath();
    return path.join(userData, filename);
}

// 통신 설정 및 재시도 로직
const COMMUNICATION_CONFIG = {
    // 타임아웃 설정
    TIMEOUTS: {
        CONNECTION_CHECK: 5000,    // 연결 확인: 5초
        RETRY: 15000,              // 재전송: 15초 (10초에서 증가)
        DISPENSE: 30000,           // 일반 전송: 30초
        SCAN: 5000                 // 스캔: 5초
    },
    // 재시도 설정
    RETRY: {
        MAX_ATTEMPTS: 3,           // 최대 재시도 횟수
        DELAY_BETWEEN_RETRIES: 1000, // 재시도 간 대기 시간 (1초)
        BACKOFF_MULTIPLIER: 1.5    // 지수 백오프 배수
    }
};

// 적응적 재시도 함수
async function retryWithBackoff(operation, maxAttempts = COMMUNICATION_CONFIG.RETRY.MAX_ATTEMPTS) {
    let lastError;
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await operation();
        } catch (error) {
            lastError = error;
            
            // 마지막 시도가 아니고 재시도 가능한 오류인 경우에만 재시도
            if (attempt < maxAttempts && isRetryableError(error)) {
                const delay = COMMUNICATION_CONFIG.RETRY.DELAY_BETWEEN_RETRIES * 
                             Math.pow(COMMUNICATION_CONFIG.RETRY.BACKOFF_MULTIPLIER, attempt - 1);
                
                logMessage(`통신 실패 (${attempt}/${maxAttempts}), ${delay}ms 후 재시도: ${error.message}`);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                break;
            }
        }
    }
    
    throw lastError;
}

// 재시도 가능한 오류인지 판단
function isRetryableError(error) {
    const retryableErrors = [
        'ECONNABORTED',
        'ECONNREFUSED', 
        'ENETUNREACH',
        'ETIMEDOUT',
        'timeout'
    ];
    
    return retryableErrors.some(retryableError => 
        error.code === retryableError || 
        error.message.includes(retryableError)
    );
}

// 안정적인 HTTP 요청 함수
async function makeStableRequest(url, data, options = {}) {
    const defaultOptions = {
        timeout: COMMUNICATION_CONFIG.TIMEOUTS.DISPENSE,
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        }
    };
    
    const requestOptions = { ...defaultOptions, ...options };
    
    return retryWithBackoff(async () => {
        const response = await axios.post(url, data, requestOptions);
        return response;
    });
}

// 통신 상태 모니터링
const communicationStats = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    averageResponseTime: 0,
    responseTimes: [],
    lastNetworkQuality: 'unknown'
};

// 네트워크 품질 측정
function measureNetworkQuality(responseTime) {
    communicationStats.responseTimes.push(responseTime);
    
    // 최근 10개 응답 시간만 유지
    if (communicationStats.responseTimes.length > 10) {
        communicationStats.responseTimes.shift();
    }
    
    // 평균 응답 시간 계산
    const avgTime = communicationStats.responseTimes.reduce((sum, time) => sum + time, 0) / communicationStats.responseTimes.length;
    communicationStats.averageResponseTime = avgTime;
    
    // 네트워크 품질 판단
    if (avgTime < 1000) {
        communicationStats.lastNetworkQuality = 'excellent';
    } else if (avgTime < 3000) {
        communicationStats.lastNetworkQuality = 'good';
    } else if (avgTime < 5000) {
        communicationStats.lastNetworkQuality = 'fair';
    } else {
        communicationStats.lastNetworkQuality = 'poor';
    }
    
    return communicationStats.lastNetworkQuality;
}

// 통신 성공률 계산
function getCommunicationSuccessRate() {
    if (communicationStats.totalRequests === 0) return 100;
    return (communicationStats.successfulRequests / communicationStats.totalRequests) * 100;
}

// 통신 통계 로그 출력
function logCommunicationStats() {
    const successRate = getCommunicationSuccessRate();
    logMessage(`통신 통계: 총 ${communicationStats.totalRequests}회, 성공 ${communicationStats.successfulRequests}회, 실패 ${communicationStats.failedRequests}회, 성공률 ${successRate.toFixed(1)}%, 평균 응답시간 ${communicationStats.averageResponseTime.toFixed(0)}ms, 네트워크 품질: ${communicationStats.lastNetworkQuality}`);
}

// 거리 기반 적응적 타임아웃 설정
function getAdaptiveTimeout(baseTimeout, networkQuality = 'unknown') {
    const qualityMultipliers = {
        'excellent': 1.0,    // 거리 가까움, 신호 강함
        'good': 1.2,         // 거리 보통, 신호 양호
        'fair': 1.5,         // 거리 멀음, 신호 약함
        'poor': 2.0,         // 거리 매우 멀음, 신호 불안정
        'unknown': 1.5       // 기본값
    };
    
    const multiplier = qualityMultipliers[networkQuality] || 1.5;
    return Math.round(baseTimeout * multiplier);
}

// 네트워크 환경 진단
async function diagnoseNetworkEnvironment() {
    logMessage('네트워크 환경 진단 시작...');
    
    const testResults = [];
    const testIPs = Object.values(connectedDevices).map(device => device.ip);
    
    for (const ip of testIPs) {
        const startTime = Date.now();
        try {
            const response = await axios.get(`http://${ip}`, { 
                timeout: 10000,
                headers: { 'User-Agent': 'SyrupDispenser/1.0' }
            });
            const responseTime = Date.now() - startTime;
            testResults.push({ ip, responseTime, success: true });
            
            // 네트워크 품질 측정
            const quality = measureNetworkQuality(responseTime);
            logMessage(`기기 ${ip} 응답시간: ${responseTime}ms, 품질: ${quality}`);
            
        } catch (error) {
            const responseTime = Date.now() - startTime;
            testResults.push({ ip, responseTime, success: false, error: error.message });
            logMessage(`기기 ${ip} 연결 실패: ${error.message}`);
        }
    }
    
    // 전체 네트워크 환경 평가
    const successfulTests = testResults.filter(r => r.success);
    if (successfulTests.length > 0) {
        const avgResponseTime = successfulTests.reduce((sum, r) => sum + r.responseTime, 0) / successfulTests.length;
        const quality = measureNetworkQuality(avgResponseTime);
        
        logMessage(`네트워크 환경 진단 완료: 평균 응답시간 ${avgResponseTime.toFixed(0)}ms, 전체 품질: ${quality}`);
        
        // 타임아웃 설정 조정 제안
        const suggestedTimeouts = {
            connection_check: getAdaptiveTimeout(COMMUNICATION_CONFIG.TIMEOUTS.CONNECTION_CHECK, quality),
            retry: getAdaptiveTimeout(COMMUNICATION_CONFIG.TIMEOUTS.RETRY, quality),
            dispense: getAdaptiveTimeout(COMMUNICATION_CONFIG.TIMEOUTS.DISPENSE, quality)
        };
        
        logMessage(`권장 타임아웃 설정: 연결확인 ${suggestedTimeouts.connection_check}ms, 재전송 ${suggestedTimeouts.retry}ms, 전송 ${suggestedTimeouts.dispense}ms`);
        
        return { quality, avgResponseTime, suggestedTimeouts };
    } else {
        logMessage('네트워크 환경 진단 실패: 모든 기기 연결 실패');
        return { quality: 'poor', avgResponseTime: 0, suggestedTimeouts: null };
    }
}

// ============================================
// 자동 업데이트 관련 함수
// ============================================

let updateModal = null;
let updateInfo = null;

// 앱 버전 정보 표시
async function displayAppVersion() {
    try {
        const version = await ipcRenderer.invoke('get-app-version');
        const versionElement = document.getElementById('appVersion');
        if (versionElement) {
            versionElement.textContent = `v${version}`;
        }
    } catch (error) {
        console.error('버전 정보 가져오기 오류:', error);
    }
}

// 수동으로 업데이트 확인
async function checkForUpdatesManually() {
    try {
        logMessage('업데이트 확인 중...');
        const result = await ipcRenderer.invoke('check-for-updates');
        
        if (result.success) {
            logMessage('업데이트 확인 완료');
        } else {
            logMessage(`업데이트 확인 실패: ${result.error}`);
            alert(`업데이트 확인 실패: ${result.error}`);
        }
    } catch (error) {
        console.error('업데이트 확인 오류:', error);
        logMessage(`업데이트 확인 오류: ${error.message}`);
    }
}

// 업데이트 다운로드
async function downloadUpdate() {
    try {
        const downloadBtn = document.getElementById('updateDownloadBtn');
        const laterBtn = document.getElementById('updateLaterBtn');
        const progressDiv = document.getElementById('updateProgress');
        
        // 버튼 비활성화
        downloadBtn.disabled = true;
        laterBtn.disabled = true;
        
        // 진행 상태 표시
        progressDiv.style.display = 'block';
        
        logMessage('업데이트 다운로드 시작...');
        
        const result = await ipcRenderer.invoke('download-update');
        
        if (!result.success) {
            throw new Error(result.error);
        }
    } catch (error) {
        console.error('업데이트 다운로드 오류:', error);
        logMessage(`업데이트 다운로드 오류: ${error.message}`);
        alert(`업데이트 다운로드 오류: ${error.message}`);
        
        // 버튼 다시 활성화
        const downloadBtn = document.getElementById('updateDownloadBtn');
        const laterBtn = document.getElementById('updateLaterBtn');
        downloadBtn.disabled = false;
        laterBtn.disabled = false;
    }
}

// 업데이트 설치
function installUpdate() {
    ipcRenderer.invoke('install-update');
}

// 메인 프로세스로부터 업데이트 이벤트 수신
ipcRenderer.on('update-available', (event, info) => {
    console.log('업데이트 사용 가능:', info);
    updateInfo = info;
    
    // 모달 표시
    showUpdateModal(info);
    
    logMessage(`새로운 버전 ${info.version} 사용 가능`);
});

ipcRenderer.on('update-not-available', (event, info) => {
    console.log('최신 버전입니다.');
});

ipcRenderer.on('update-error', (event, error) => {
    console.error('업데이트 오류:', error);
    logMessage(`업데이트 오류: ${error}`);
});

ipcRenderer.on('update-download-progress', (event, progress) => {
    console.log(`다운로드 진행: ${progress.percent.toFixed(1)}%`);
    
    const progressBar = document.getElementById('updateProgressBar');
    const progressText = document.getElementById('updateProgressText');
    
    if (progressBar && progressText) {
        const percent = Math.round(progress.percent);
        progressBar.style.width = `${percent}%`;
        progressBar.textContent = `${percent}%`;
        
        const transferred = (progress.transferred / 1024 / 1024).toFixed(1);
        const total = (progress.total / 1024 / 1024).toFixed(1);
        progressText.textContent = `다운로드 중... ${transferred}MB / ${total}MB`;
    }
});

ipcRenderer.on('update-downloaded', (event, info) => {
    console.log('업데이트 다운로드 완료');
    logMessage(`업데이트 다운로드 완료: v${info.version}`);
    
    // UI 업데이트
    const downloadBtn = document.getElementById('updateDownloadBtn');
    const installBtn = document.getElementById('updateInstallBtn');
    const laterBtn = document.getElementById('updateLaterBtn');
    const progressText = document.getElementById('updateProgressText');
    
    if (downloadBtn) downloadBtn.style.display = 'none';
    if (installBtn) installBtn.style.display = 'inline-block';
    if (laterBtn) laterBtn.textContent = '나중에 설치';
    if (progressText) progressText.textContent = '다운로드 완료! 지금 설치하거나 앱 종료 시 자동으로 설치됩니다.';
});

// 업데이트 모달 표시
function showUpdateModal(info) {
    const currentVersion = document.getElementById('currentVersion');
    const newVersion = document.getElementById('newVersion');
    const releaseNotes = document.getElementById('updateReleaseNotes');
    
    // 현재 버전 표시
    ipcRenderer.invoke('get-app-version').then(version => {
        if (currentVersion) currentVersion.textContent = version;
    });
    
    // 새 버전 표시
    if (newVersion) newVersion.textContent = info.version;
    
    // 릴리스 노트 표시
    if (releaseNotes) {
        if (info.releaseNotes) {
            // HTML 형식의 릴리스 노트
            if (typeof info.releaseNotes === 'string') {
                releaseNotes.innerHTML = info.releaseNotes;
            } else if (Array.isArray(info.releaseNotes)) {
                // 배열 형식의 릴리스 노트
                releaseNotes.innerHTML = info.releaseNotes.map(note => {
                    if (typeof note === 'string') {
                        return `<p>${note}</p>`;
                    } else if (note.note) {
                        return `<p>${note.note}</p>`;
                    }
                    return '';
                }).join('');
            }
        } else {
            releaseNotes.innerHTML = '<p class="text-muted">업데이트 정보가 없습니다.</p>';
        }
    }
    
    // 모달 초기화 및 표시
    const modalElement = document.getElementById('updateModal');
    if (modalElement) {
        updateModal = new bootstrap.Modal(modalElement);
        updateModal.show();
    }
}

// 초기화 시 버전 정보 표시
document.addEventListener('DOMContentLoaded', () => {
    displayAppVersion();
});