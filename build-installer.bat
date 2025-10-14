@echo off
chcp 65001 > nul
echo ========================================
echo 시럽조제기 연결 관리자 설치파일 빌드
echo ========================================
echo.

REM 현재 디렉토리 확인
echo 현재 작업 디렉토리: %CD%
echo.

REM 필요한 파일들 확인
echo 필요한 파일들 확인 중...
if not exist "package.json" (
    echo 오류: package.json 파일을 찾을 수 없습니다.
    pause
    exit /b 1
)

if not exist "main.js" (
    echo 오류: main.js 파일을 찾을 수 없습니다.
    pause
    exit /b 1
)

if not exist "renderer.js" (
    echo 오류: renderer.js 파일을 찾을 수 없습니다.
    pause
    exit /b 1
)

if not exist "index.html" (
    echo 오류: index.html 파일을 찾을 수 없습니다.
    pause
    exit /b 1
)

echo 모든 필요한 파일이 존재합니다.
echo.

REM Node.js 설치 확인
echo Node.js 설치 확인 중...
node --version > nul 2>&1
if errorlevel 1 (
    echo 오류: Node.js가 설치되지 않았습니다.
    echo https://nodejs.org 에서 Node.js를 다운로드하여 설치해주세요.
    pause
    exit /b 1
)

echo Node.js 버전:
node --version
echo.

REM npm 설치 확인
echo npm 설치 확인 중...
npm --version > nul 2>&1
if errorlevel 1 (
    echo 오류: npm이 설치되지 않았습니다.
    pause
    exit /b 1
)

echo npm 버전:
npm --version
echo.

REM 의존성 설치
echo 의존성 설치 중...
npm install
if errorlevel 1 (
    echo 오류: 의존성 설치에 실패했습니다.
    pause
    exit /b 1
)

echo 의존성 설치 완료.
echo.

REM Electron 앱 빌드
echo Electron 앱 빌드 중...
npm run build
if errorlevel 1 (
    echo 오류: Electron 앱 빌드에 실패했습니다.
    pause
    exit /b 1
)

echo Electron 앱 빌드 완료.
echo.

REM NSIS 설치 확인
echo NSIS 설치 확인 중...
makensis /VERSION > nul 2>&1
if errorlevel 1 (
    echo 경고: NSIS가 설치되지 않았습니다.
    echo NSIS를 설치하지 않으면 설치 스크립트를 컴파일할 수 없습니다.
    echo.
    echo NSIS 다운로드: https://nsis.sourceforge.io/Download
    echo.
    echo 대신 electron-builder를 사용하여 설치파일을 생성합니다...
    echo.
    
    REM electron-builder로 설치파일 생성
    npm run build-installer
    if errorlevel 1 (
        echo 오류: electron-builder 설치파일 생성에 실패했습니다.
        pause
        exit /b 1
    )
    
    echo electron-builder 설치파일 생성 완료.
    echo 설치파일 위치: release\
    echo.
    pause
    exit /b 0
)

echo NSIS 버전:
makensis /VERSION
echo.

REM NSIS 스크립트 컴파일
echo NSIS 설치 스크립트 컴파일 중...
makensis installer.nsi
if errorlevel 1 (
    echo 오류: NSIS 스크립트 컴파일에 실패했습니다.
    pause
    exit /b 1
)

echo.
echo ========================================
echo 빌드 완료!
echo ========================================
echo.
echo 생성된 파일:
echo - release\시럽조제기 연결 관리자 Setup 1.0.0.exe
echo.
echo 설치파일을 실행하여 설치를 테스트해보세요.
echo.
pause

