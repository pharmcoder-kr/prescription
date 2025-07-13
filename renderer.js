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
let networkPrefix = null; // 현재 네트워크 프리픽스
let transmissionStatus = {}; // 각 환자의 전송상태 저장 (receiptNumber -> status)
let medicineTransmissionStatus = {}; // 각 약물의 전송상태 저장 (receiptNumber_medicineCode -> status)
let connectionCheckDelayTimer = null; // 연결 상태 확인 지연 타이머
let isDispensingInProgress = false; // 조제 진행 중 플래그

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
    autoDispensing: document.getElementById('autoDispensing')
};

// 초기화
document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
    setupEventListeners();
    setupDatePicker();
    loadConnections();
    loadPrescriptionPath();
    loadTransmissionStatus(); // 전송상태 로드 추가
    loadMedicineTransmissionStatus(); // 약물별 전송상태 로드 추가
    loadAutoDispensingSettings();
    startPeriodicTasks();
    // datePicker 값이 비어있으면 오늘 날짜로 세팅
    if (!elements.datePicker.value) {
        const today = moment().format('YYYY-MM-DD');
        elements.datePicker.value = today;
    }
});

// 앱 초기화
function initializeApp() {
    logMessage('시럽조제기 연결 관리자가 시작되었습니다.');
    loadPrescriptionPath();
    loadTransmissionStatus(); // 전송상태 로드 추가
    loadMedicineTransmissionStatus(); // 약물별 전송상태 로드 추가
    logMessage(`로드된 처방전 경로: ${prescriptionPath}`);
    initializeEmptyTables();
    detectNetworks();
    parseAllPrescriptionFiles();
    startPrescriptionMonitor();

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
    elements.autoDispensing.addEventListener('change', (e) => {
        autoDispensing = e.target.checked;
        saveAutoDispensingSettings();
        logMessage(`자동 조제 ${autoDispensing ? '활성화' : '비활성화'}`);
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
                timeout: 5000, // 타임아웃을 5초로 증가
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
            timeout: 5000, // 타임아웃을 5초로 증가
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
function saveConnection(mac, ip) {
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
    
    saveConnections();
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
    const selection = document.querySelector('#connectedTableBody tr.selected');
    if (!selection) {
        showMessage('warning', '연결 해제할 기기를 선택해주세요.');
        return;
    }
    
    const mac = selection.dataset.mac;
    delete connectedDevices[mac];
    updateConnectedTable();
    updateMedicineColors();
    showMessage('info', '연결이 해제되었습니다.');
}

// 기기 삭제
function deleteDevice() {
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
    saveConnections();
    updateSavedList();
    showMessage('info', '기기가 삭제되었습니다.');
}

// 연결 정보 저장/로드
function saveConnections() {
    try {
        fs.writeFileSync('connections.json', JSON.stringify({
            connections: savedConnections
        }, null, 2));
    } catch (error) {
        logMessage(`연결 정보 저장 중 오류: ${error.message}`);
    }
}

function loadConnections() {
    try {
        if (fs.existsSync('connections.json')) {
            const data = JSON.parse(fs.readFileSync('connections.json', 'utf8'));
            savedConnections = data.connections || {};
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

function savePrescriptionPath() {
    const path = elements.pathEntry.value.trim();
    if (path && fs.existsSync(path)) {
        prescriptionPath = path;
        try {
            fs.writeFileSync('prescription_path.txt', path);
            showMessage('info', '처방전 파일 경로가 저장되었습니다.');
            parseAllPrescriptionFiles();
        } catch (error) {
            logMessage(`경로 저장 중 오류: ${error.message}`);
        }
    } else {
        showMessage('warning', '올바른 경로를 입력해주세요.');
    }
}

function loadPrescriptionPath() {
    try {
        if (fs.existsSync('prescription_path.txt')) {
            prescriptionPath = fs.readFileSync('prescription_path.txt', 'utf8').trim();
            elements.pathEntry.value = prescriptionPath;
        }
    } catch (error) {
        logMessage(`경로 로드 중 오류: ${error.message}`);
    }
}

// 자동 조제 설정 저장
function saveAutoDispensingSettings() {
    try {
        const settings = {
            autoDispensing: autoDispensing
        };
        fs.writeFileSync('auto_dispensing_settings.json', JSON.stringify(settings, null, 2), 'utf8');
        logMessage(`자동 조제 설정 저장됨: ${autoDispensing ? '활성화' : '비활성화'}`);
    } catch (error) {
        logMessage(`자동 조제 설정 저장 중 오류: ${error.message}`);
    }
}

// 자동 조제 설정 로드
function loadAutoDispensingSettings() {
    try {
        if (fs.existsSync('auto_dispensing_settings.json')) {
            const settings = JSON.parse(fs.readFileSync('auto_dispensing_settings.json', 'utf8'));
            autoDispensing = settings.autoDispensing || false;
            elements.autoDispensing.checked = autoDispensing;
            logMessage(`자동 조제 설정 로드됨: ${autoDispensing ? '활성화' : '비활성화'}`);
        } else {
            // 기본값 설정
            autoDispensing = false;
            elements.autoDispensing.checked = false;
            logMessage('자동 조제 설정 파일이 없어 기본값으로 설정됨: 비활성화');
        }
    } catch (error) {
        logMessage(`자동 조제 설정 로드 중 오류: ${error.message}`);
        // 오류 발생 시 기본값 설정
        autoDispensing = false;
        elements.autoDispensing.checked = false;
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
        const files = fs.readdirSync(prescriptionPath)
            .filter(file => file.endsWith('.txt'))
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
        // 인코딩 우선순위: cp949 → euc-kr → utf8
        const encodings = ['cp949', 'euc-kr', 'utf8'];
        let decoded = false;

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
        
        const receiptNumber = path.basename(filePath, '.txt');
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
                receipt_date: receiptDate, // 날짜만 별도 저장
                receipt_number: receiptNumber,
                parsed_at: currentTime // 파싱된 시간 기록
            },
            medicines: medicines
        };
        
        parsedFiles.add(filePath);
        logMessage(`처방전 파일 '${path.basename(filePath)}' 파싱 완료 (시간: ${receiptTime})`);
        
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
        
        // 기존 전송상태 확인
        const savedStatus = transmissionStatus[prescription.patient.receipt_number];
        let statusBadge = '<span class="badge bg-secondary">대기</span>';
        
        if (savedStatus) {
            const badgeClass = savedStatus === '완료' ? 'bg-success' : 'bg-danger';
            statusBadge = `<span class="badge ${badgeClass}">${savedStatus}</span>`;
            console.log(`[filterPatientsByDate] 기존 상태 복원: ${prescription.patient.receipt_number} -> ${savedStatus}`);
        }
        
        row.innerHTML = `
            <td>${prescription.patient.name}</td>
            <td>${prescription.patient.receipt_time}</td>
            <td>${prescription.patient.receipt_number}</td>
            <td>${statusBadge}</td>
        `;
        row.setAttribute('data-receipt-number', prescription.patient.receipt_number);
        elements.patientTableBody.appendChild(row);
        foundCount++;
        logMessage(`환자 추가: ${prescription.patient.name} (${prescription.patient.receipt_number})`);
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
            
            let statusBadge = '<span class="badge bg-secondary">대기</span>';
            
            if (savedStatus) {
                const badgeClass = savedStatus === '완료' ? 'bg-success' : 
                                 savedStatus === '실패' ? 'bg-danger' : 
                                 savedStatus === '조제중' ? 'bg-warning' : 
                                 savedStatus === '등록되지 않은 약물' ? 'bg-dark' : 'bg-secondary';
                statusBadge = `<span class="badge ${badgeClass}">${savedStatus}</span>`;
            }
            
            row.innerHTML = `
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
        `;
        emptyRow.classList.add('empty-row');
        elements.medicineTableBody.appendChild(emptyRow);
    }
    
    // 행 색상 업데이트
    updateMedicineRowColors();
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
    let selectedPatient = document.querySelector('#patientTableBody tr.table-primary');
    if (!selectedPatient && isAuto) {
        // 자동조제 모드일 때는 오늘 날짜의 첫 번째 환자 자동 선택
        selectedPatient = document.querySelector('#patientTableBody tr');
        if (selectedPatient) selectedPatient.classList.add('table-primary');
    }
    if (!selectedPatient) {
        showMessage('warning', '환자를 선택해주세요.');
        return;
    }
    const receiptNumber = selectedPatient.dataset.receiptNumber;
    console.log('[startDispensing] receiptNumber:', receiptNumber, 'isAuto:', isAuto);
    
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
    
    // 조제 시작 시 연결 상태 확인 일시 중단
    if (connectionCheckInterval) {
        clearInterval(connectionCheckInterval);
        connectionCheckInterval = null;
        logMessage('조제 시작 - 연결 상태 확인 일시 중단');
    }
    
    // 조제 진행 중 플래그 설정 및 연결 상태 확인 지연 시작
    isDispensingInProgress = true;
    startConnectionCheckDelay(60); // 60초 동안 연결 상태 확인 지연
    
    // 등록된 약물들만 필터링 (저장된 시럽조제기에 등록된 약물만)
    const registeredMedicines = prescription.medicines.filter(medicine => {
        return isMedicineRegistered(medicine.pill_code);
    });
    
    const unregisteredMedicines = prescription.medicines.filter(medicine => {
        return !isMedicineRegistered(medicine.pill_code);
    });
    
    // 등록되지 않은 약물들을 "등록되지 않은 약물" 상태로 표시
    unregisteredMedicines.forEach(medicine => {
        logMessage(`${medicine.pill_name}은(는) 저장된 시럽조제기에 등록되지 않은 약물이므로 전송에서 제외됩니다.`);
        updateMedicineTransmissionStatus(receiptNumber, medicine.pill_code, '등록되지 않은 약물');
    });
    
    // 연결된 약물들만 필터링 (등록된 약물 중에서 연결된 것만)
    const connectedMedicines = registeredMedicines.filter(medicine => {
        const connectedDevice = Object.values(connectedDevices).find(device => 
            device.pill_code === medicine.pill_code && device.status === '연결됨'
        );
        return connectedDevice !== undefined;
    });
    
    const notConnectedMedicines = registeredMedicines.filter(medicine => {
        const connectedDevice = Object.values(connectedDevices).find(device => 
            device.pill_code === medicine.pill_code && device.status === '연결됨'
        );
        return connectedDevice === undefined;
    });
    
    // 연결되지 않은 약물들을 실패 상태로 표시
    notConnectedMedicines.forEach(medicine => {
        logMessage(`${medicine.pill_name}은(는) 연결되지 않은 약물이므로 건너뜁니다.`);
        updateMedicineTransmissionStatus(receiptNumber, medicine.pill_code, '실패');
    });
    
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
        updateConnectedTable();
        logMessage(`${medicine.pill_name} 조제 시작 - 기기 상태를 '시럽 조제 중'으로 변경`);
        
        // 약물 전송상태를 "조제중"으로 변경
        updateMedicineTransmissionStatus(receiptNumber, medicine.pill_code, '조제중');
        
        try {
            const data = `TV${medicine.total} FF FF FF`;
            const response = await axios.post(`http://${connectedDevice.ip}/dispense`, {
                amount: data
            }, {
                timeout: 10000,  // 타임아웃을 10초로 증가
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                }
            });
            
            if (response.status === 200) {
                logMessage(`${medicine.pill_name} 총량 전달 성공`);
                
                // 성공 시 약물 전송상태를 "완료"로 변경
                updateMedicineTransmissionStatus(receiptNumber, medicine.pill_code, '완료');
                
                // 성공 시 30초 후에 상태를 "연결됨"으로 복원 (조제 시간 고려)
                setTimeout(() => {
                    connectedDevice.status = '연결됨';
                    updateConnectedTable();
                    logMessage(`${medicine.pill_name} 조제 완료 - 기기 상태를 '연결됨'으로 복원`);
                }, 30000);
                
                return {
                    success: true,
                    medicine: medicine,
                    device: connectedDevice
                };
            } else {
                logMessage(`${medicine.pill_name} 총량 전달 실패: ${response.status}`);
                // 실패 시 즉시 상태를 "연결됨"으로 복원
                connectedDevice.status = '연결됨';
                updateConnectedTable();
                logMessage(`${medicine.pill_name} 조제 실패 - 기기 상태를 '연결됨'으로 복원`);
                
                // 실패 시 약물 전송상태를 "실패"로 변경
                updateMedicineTransmissionStatus(receiptNumber, medicine.pill_code, '실패');
                
                return {
                    success: false,
                    medicine: medicine,
                    device: connectedDevice,
                    reason: `HTTP 오류 (${response.status})`
                };
            }
        } catch (error) {
            logMessage(`${medicine.pill_name} 총량 전달 중 오류: ${error.message}`);
            // 오류 시 즉시 상태를 "연결됨"으로 복원
            connectedDevice.status = '연결됨';
            updateConnectedTable();
            logMessage(`${medicine.pill_name} 조제 오류 - 기기 상태를 '연결됨'으로 복원`);
            
            // 오류 시 약물 전송상태를 "실패"로 변경
            updateMedicineTransmissionStatus(receiptNumber, medicine.pill_code, '실패');
            
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
    
    // 모든 전송 완료 대기
    const results = await Promise.all(dispensingPromises);
    
    // 결과 분석
    const successMedicines = results.filter(result => result.success).map(result => result.medicine);
    const failedMedicines = results.filter(result => !result.success).map(result => ({
        name: result.medicine.pill_name,
        code: result.medicine.pill_code,
        reason: result.reason
    }));
    
    // 결과 메시지 생성
    const totalMedicines = prescription.medicines.length;
    const successCount = successMedicines.length;
    const failedCount = failedMedicines.length + notConnectedMedicines.length;
    const unregisteredCount = unregisteredMedicines.length;
    
    if (failedCount === 0 && unregisteredCount === 0) {
        console.log('[startDispensing] 조제 성공 - updateTransmissionStatus 호출:', receiptNumber, '완료');
        updateTransmissionStatus(receiptNumber, '완료');
        // showMessage('success', `모든 약물 조제가 성공적으로 완료되었습니다.\n성공: ${successCount}개`);
    } else if (failedCount === 0 && unregisteredCount > 0) {
        // 실패는 없고 등록되지 않은 약물만 있을 때는 팝업을 띄우지 않음
        updateTransmissionStatus(receiptNumber, '완료');
        // 아무 메시지도 띄우지 않음
        return;
    } else {
        console.log('[startDispensing] 조제 실패 - updateTransmissionStatus 호출:', receiptNumber, '실패');
        updateTransmissionStatus(receiptNumber, '실패');
        
        let errorMessage = `조제 결과:\n• 성공: ${successCount}개\n• 실패: ${failedCount}개\n• 등록되지 않은 약물: ${unregisteredCount}개\n\n`;
        
        if (failedMedicines.length > 0) {
            errorMessage += '▼ 통신 실패 약물:\n';
            failedMedicines.forEach(medicine => {
                errorMessage += `• ${medicine.name} (${medicine.code})\n  → ${medicine.reason}\n`;
            });
        }
        
        if (notConnectedMedicines.length > 0) {
            errorMessage += '\n▼ 연결되지 않은 약물:\n';
            notConnectedMedicines.forEach(medicine => {
                errorMessage += `• ${medicine.name} (${medicine.code})\n  → 시럽조제기 연결 필요\n`;
            });
        }
        
        if (unregisteredMedicines.length > 0) {
            errorMessage += '\n▼ 등록되지 않은 약물:\n';
            unregisteredMedicines.forEach(medicine => {
                errorMessage += `• ${medicine.name} (${medicine.code})\n  → 저장된 시럽조제기에 등록 필요\n`;
            });
        }
        
        showMessage('error', errorMessage);
    }
}

// 전송 상태 업데이트
function updateTransmissionStatus(receiptNumber, status) {
    console.log('[updateTransmissionStatus] 호출됨:', receiptNumber, status);
    
    // 전역 변수에 상태 저장
    transmissionStatus[receiptNumber] = status;
    
    // 파일에 저장
    saveTransmissionStatus();
    
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

// 주기적 작업 시작
function startPeriodicTasks() {
    // 주기적 스캔 시작
    scheduleScan();
    
    // 주기적 연결 상태 확인 (15초마다)
    connectionCheckInterval = setInterval(checkConnectionStatus, 15000);
    
    logMessage('주기적 작업이 시작되었습니다.');
}

// 연결 상태 확인 (arduino_connector.py 방식 적용)
async function checkConnectionStatus() {
    if (isCheckingStatus) {
        return; // 이미 확인 중이면 중복 실행 방지
    }
    
    // 조제 진행 중이면 연결 상태 확인을 건너뛰기
    if (isDispensingInProgress) {
        logMessage('조제 진행 중 - 연결 상태 확인 건너뜀');
        return;
    }
    
    try {
        isCheckingStatus = true;
        const rows = elements.connectedTableBody.querySelectorAll('tr');
        
        // MAC 주소 정규화 함수
        const normalizeMac = (macStr) => {
            return macStr.replace(/[:\-]/g, '').toUpperCase();
        };
        
        for (const row of rows) {
            const cells = row.cells;
            const ip = cells[2].textContent;
            const currentStatus = cells[3].textContent.trim(); // 현재 상태 가져오기
            
            // 조제 중인 기기는 연결 상태 확인을 건너뛰기
            if (currentStatus === "시럽 조제 중") {
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
            
            try {
                // 일시적인 타임아웃에 대한 재시도 로직
                let response = null;
                let lastError = null;
                
                for (let retry = 0; retry < 2; retry++) {
                    try {
                        response = await axios.get(`http://${ip}`, { timeout: 5000 });
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
                            if (currentStatus !== "시럽 조제 중") {
                                updateDeviceStatus(ip, '연결됨');
                            }
                        } else {
                            // MAC 주소가 다르면 연결 해제
                            elements.connectedTableBody.removeChild(row);
                            delete connectedDevices[mac];
                            logMessage(`기기 MAC 주소 불일치로 연결 해제: ${ip} (기기=${data.mac}, 저장된=${mac})`);
                        }
                    } else {
                        // MAC 정보가 없으면 일시적 응답 없음으로 처리
                        const currentStatus = cells[3].textContent.trim();
                        if (currentStatus !== "시럽 조제 중") {
                            updateDeviceStatus(ip, '일시적 응답 없음');
                        }
                    }
                } else {
                    // 비정상 응답 - 일시적 응답 없음으로 처리
                    const currentStatus = cells[3].textContent.trim();
                    if (currentStatus !== "시럽 조제 중") {
                        updateDeviceStatus(ip, '일시적 응답 없음');
                    }
                }
            } catch (error) {
                // 조제 중인 기기는 상태를 보존
                const currentStatus = cells[3].textContent.trim();
                if (currentStatus === "시럽 조제 중") {
                    logMessage(`조제 중인 기기는 연결 상태 유지: ${ip} - 오류: ${error.message}`);
                } else {
                    // 조제 중이 아닌 경우에만 "일시적 응답 없음"으로 변경
                    updateDeviceStatus(ip, '일시적 응답 없음');
                    logMessage(`연결 상태 확인 오류: ${ip} - ${error.message}`);
                }
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
            const files = fs.readdirSync(prescriptionPath)
                .filter(file => file.endsWith('.txt'))
                .map(file => path.join(prescriptionPath, file));

            let newFileDetected = false;
            let latestDate = null;
            let newReceiptNumbers = [];

            files.forEach(filePath => {
                if (!parsedFiles.has(filePath)) {
                    const receiptNumber = path.basename(filePath, '.txt');
                    parsePrescriptionFile(filePath);
                    // 파일명에서 날짜 추출 (예: 20250625xxxxxx.txt)
                    const datePart = receiptNumber.substring(0, 8);
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
                            logMessage(`새로운 처방전 '${receiptNumber}.txt'이(가) 감지되어 자동으로 조제를 시작합니다.`);
                            
                            // 환자 행이 생성된 후 자동 선택
                            setTimeout(() => {
                                const row = document.querySelector(`#patientTableBody tr[data-receipt-number="${receiptNumber}"]`);
                                if (row) {
                                    // 기존 선택 해제
                                    document.querySelectorAll('#patientTableBody tr').forEach(r => r.classList.remove('table-primary'));
                                    row.classList.add('table-primary');
                                    logMessage(`조제를 시작합니다. 환자: ${prescription.patient.name}`);
                                    startDispensing(true); // true: 자동조제 플래그
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
function saveTransmissionStatus() {
    try {
        const data = JSON.stringify(transmissionStatus);
        fs.writeFileSync('transmission_status.json', data, 'utf8');
        console.log('[saveTransmissionStatus] 전송상태 저장됨:', Object.keys(transmissionStatus).length, '개');
    } catch (error) {
        console.error('[saveTransmissionStatus] 저장 오류:', error.message);
    }
}

// 전송 상태 로드
function loadTransmissionStatus() {
    try {
        if (fs.existsSync('transmission_status.json')) {
            const data = fs.readFileSync('transmission_status.json', 'utf8');
            transmissionStatus = JSON.parse(data);
            console.log('[loadTransmissionStatus] 전송상태 로드됨:', Object.keys(transmissionStatus).length, '개');
        }
    } catch (error) {
        console.error('[loadTransmissionStatus] 로드 오류:', error.message);
        transmissionStatus = {};
    }
}

// 약물별 전송 상태 저장
function saveMedicineTransmissionStatus() {
    try {
        const data = JSON.stringify(medicineTransmissionStatus);
        fs.writeFileSync('medicine_transmission_status.json', data, 'utf8');
        console.log('[saveMedicineTransmissionStatus] 약물별 전송상태 저장됨:', Object.keys(medicineTransmissionStatus).length, '개');
    } catch (error) {
        console.error('[saveMedicineTransmissionStatus] 저장 오류:', error.message);
    }
}

// 약물별 전송 상태 로드
function loadMedicineTransmissionStatus() {
    try {
        if (fs.existsSync('medicine_transmission_status.json')) {
            const data = fs.readFileSync('medicine_transmission_status.json', 'utf8');
            medicineTransmissionStatus = JSON.parse(data);
            console.log('[loadMedicineTransmissionStatus] 약물별 전송상태 로드됨:', Object.keys(medicineTransmissionStatus).length, '개');
        }
    } catch (error) {
        console.error('[loadMedicineTransmissionStatus] 로드 오류:', error.message);
        medicineTransmissionStatus = {};
    }
}

// 약물별 전송 상태 업데이트
function updateMedicineTransmissionStatus(receiptNumber, medicineCode, status) {
    console.log('[updateMedicineTransmissionStatus] 호출됨:', receiptNumber, medicineCode, status);
    
    const key = `${receiptNumber}_${medicineCode}`;
    medicineTransmissionStatus[key] = status;
    
    // 파일에 저장
    saveMedicineTransmissionStatus();
    
    // 현재 표시된 약물 테이블에서 해당 약물의 상태 업데이트
    const rows = elements.medicineTableBody.querySelectorAll('tr:not(.empty-row)');
    rows.forEach(row => {
        if (row.dataset.pillCode === medicineCode) {
            const statusCell = row.cells[6]; // 7번째 컬럼 (0부터 시작하므로 6)
            const badgeClass = status === '완료' ? 'bg-success' : 
                             status === '실패' ? 'bg-danger' : 
                             status === '조제중' ? 'bg-warning' : 'bg-secondary';
            statusCell.innerHTML = `<span class="badge ${badgeClass}">${status}</span>`;
            console.log('[updateMedicineTransmissionStatus] 약물 상태 업데이트 성공:', medicineCode, status);
        }
    });
    
    // 행 색상 업데이트
    updateMedicineRowColors();
}

// 실패한 약물만 재전송
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
    
    // 실패한 약물들만 필터링 (등록된 약물 중에서만)
    const failedMedicines = prescription.medicines.filter(medicine => {
        const key = `${receiptNumber}_${medicine.pill_code}`;
        return medicineTransmissionStatus[key] === '실패' && isMedicineRegistered(medicine.pill_code);
    });
    
    // 등록되지 않은 약물들도 확인
    const unregisteredMedicines = prescription.medicines.filter(medicine => {
        const key = `${receiptNumber}_${medicine.pill_code}`;
        return medicineTransmissionStatus[key] === '실패' && !isMedicineRegistered(medicine.pill_code);
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
        
        // 약물 전송상태를 "조제중"으로 변경
        updateMedicineTransmissionStatus(receiptNumber, medicine.pill_code, '조제중');
        
        try {
            const data = `TV${medicine.total} FF FF FF`;
            const response = await axios.post(`http://${connectedDevice.ip}/dispense`, {
                amount: data
            }, {
                timeout: 10000,
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                }
            });
            
            if (response.status === 200) {
                logMessage(`${medicine.pill_name} 재전송 성공`);
                
                // 성공 시 약물 전송상태를 "완료"로 변경
                updateMedicineTransmissionStatus(receiptNumber, medicine.pill_code, '완료');
                
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
                
                updateMedicineTransmissionStatus(receiptNumber, medicine.pill_code, '실패');
                
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
            
            updateMedicineTransmissionStatus(receiptNumber, medicine.pill_code, '실패');
            
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
        
        showMessage('error', errorMessage);
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
    
    // 해당 환자의 모든 약물 전송상태를 "대기"로 초기화
    prescription.medicines.forEach(medicine => {
        const key = `${receiptNumber}_${medicine.pill_code}`;
        
        // 등록되지 않은 약물은 "등록되지 않은 약물" 상태로 유지
        if (!isMedicineRegistered(medicine.pill_code)) {
            medicineTransmissionStatus[key] = '등록되지 않은 약물';
        } else {
            medicineTransmissionStatus[key] = '대기';
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
        if (status === '완료') {
            row.classList.add('medicine-success');
        } else if (status === '실패') {
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
    dropdownBtn.className = 'btn btn-outline-primary dropdown-toggle w-100';
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
    statusSpan.className = 'status-disconnected';
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
    totalInput.className = 'form-control';
    totalInput.placeholder = '총량';
    totalInput.style.maxWidth = '100px';
    totalInput.value = initTotal;
    totalInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            sendBtn.click();
        }
    });
    totalInput.addEventListener('input', saveManualRowsState);

    // 전송 버튼 ...
    const sendBtn = document.createElement('button');
    sendBtn.className = 'btn btn-success';
    sendBtn.innerHTML = '<i class="fas fa-paper-plane me-2"></i>전송';
    sendBtn.onclick = async function() {
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
        if (!connectedDevices[selectedMac] || connectedDevices[selectedMac].status !== '연결됨') {
            await showMessage('warning', '선택한 시럽조제기가 연결되어 있지 않습니다.');
            return;
        }
        const statusId = addManualStatus({ syrupName: info.nickname, mac: selectedMac, total });
        try {
            const device = connectedDevices[selectedMac];
            updateConnectedTable();
            updateStatus();
            const data = `TV${total} FF FF FF`;
            await axios.post(`http://${device.ip}/dispense`, { amount: data }, {
                timeout: 10000,
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }
            });
            updateManualStatus(statusId, '완료');
            totalInput.value = '';
            totalInput.placeholder = '총량';
            updateStatus();
            saveManualRowsState();
        } catch (error) {
            updateManualStatus(statusId, '실패');
            await showMessage('error', `전송 실패: ${error.message}`);
            if (connectedDevices[selectedMac]) {
                updateConnectedTable();
                updateStatus();
            }
        }
    };

    // 행 삭제 버튼 ...
    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-outline-danger';
    delBtn.innerHTML = '<i class="fas fa-times"></i>';
    delBtn.onclick = function() {
        manualRows = manualRows.filter(r => r.id !== rowId);
        renderManualRows();
        saveManualRowsState();
    };

    rowDiv.appendChild(dropdownDiv);
    rowDiv.appendChild(statusSpan);
    rowDiv.appendChild(totalInput);
    rowDiv.appendChild(sendBtn);
    rowDiv.appendChild(delBtn);

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