@echo off
chcp 65001 > nul
echo ========================================
echo 오토시럽 빌드 (아이콘 포함)
echo ========================================
echo.
echo 이 스크립트는 관리자 권한으로 실행되어야 합니다.
echo 실행 파일에 아이콘을 임베드하기 위해 필요합니다.
echo.

REM 관리자 권한 확인
net session >nul 2>&1
if %errorLevel% == 0 (
    echo [OK] 관리자 권한으로 실행 중입니다.
    echo.
) else (
    echo [경고] 관리자 권한이 필요합니다.
    echo 이 파일을 우클릭하여 "관리자 권한으로 실행"을 선택해주세요.
    echo.
    pause
    exit /b 1
)

REM 현재 디렉토리 확인
echo 현재 작업 디렉토리: %CD%
echo.

REM 빌드 시작
echo 빌드 시작...
echo.

call npx electron-builder --win --x64 --publish always

if errorlevel 1 (
    echo.
    echo [오류] 빌드에 실패했습니다.
    echo.
    pause
    exit /b 1
)

echo.
echo ========================================
echo 빌드 완료!
echo ========================================
echo.
echo GitHub 릴리즈 페이지를 확인하세요:
echo https://github.com/pharmcoder-kr/prescription/releases
echo.
pause


