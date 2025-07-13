#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');

console.log('🚀 시럽조제기 연결 관리자를 시작합니다...');

// Electron 실행
const electronProcess = spawn('npx', ['electron', '.'], {
    stdio: 'inherit',
    shell: true,
    cwd: __dirname
});

electronProcess.on('close', (code) => {
    console.log(`프로그램이 종료되었습니다. (코드: ${code})`);
});

electronProcess.on('error', (error) => {
    console.error('실행 중 오류가 발생했습니다:', error);
}); 