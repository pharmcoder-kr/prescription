@echo off
echo 시럽조제기 연결 관리자 제거를 시작합니다...

REM 설치 디렉토리 설정
set INSTALL_DIR=%PROGRAMFILES%\시럽조제기 연결 관리자
set DESKTOP_DIR=%USERPROFILE%\Desktop
set START_MENU_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs

echo 설치 디렉토리: %INSTALL_DIR%

REM 관리자 권한 확인
net session >nul 2>&1
if %errorLevel% == 0 (
    echo 관리자 권한으로 실행 중입니다.
) else (
    echo 관리자 권한이 필요합니다. 다시 실행해주세요.
    pause
    exit /b 1
)

REM 실행 중인 프로세스 종료
echo 실행 중인 프로세스를 종료합니다...
taskkill /f /im "시럽조제기 연결 관리자.exe" >nul 2>&1

REM 바로가기 제거
echo 바로가기를 제거합니다...
if exist "%DESKTOP_DIR%\시럽조제기 연결 관리자.lnk" del "%DESKTOP_DIR%\시럽조제기 연결 관리자.lnk"
if exist "%START_MENU_DIR%\시럽조제기 연결 관리자" rmdir /s /q "%START_MENU_DIR%\시럽조제기 연결 관리자"

REM 설치 디렉토리 제거
if exist "%INSTALL_DIR%" (
    echo 설치 디렉토리를 제거합니다...
    rmdir /s /q "%INSTALL_DIR%"
    echo 제거가 완료되었습니다.
) else (
    echo 설치된 프로그램을 찾을 수 없습니다.
)

echo.
echo 제거가 완료되었습니다!
echo.
pause 