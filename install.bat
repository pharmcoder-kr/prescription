@echo off
echo 시럽조제기 연결 관리자 설치를 시작합니다...

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

REM 기존 설치 제거
if exist "%INSTALL_DIR%" (
    echo 기존 설치를 제거합니다...
    rmdir /s /q "%INSTALL_DIR%"
)

REM 설치 디렉토리 생성
echo 설치 디렉토리를 생성합니다...
mkdir "%INSTALL_DIR%"

REM 파일 복사
echo 파일을 복사합니다...
xcopy "release\win-unpacked\*" "%INSTALL_DIR%\" /s /e /y

REM 바탕화면 바로가기 생성
echo 바탕화면 바로가기를 생성합니다...
powershell "$WshShell = New-Object -comObject WScript.Shell; $Shortcut = $WshShell.CreateShortcut('%DESKTOP_DIR%\시럽조제기 연결 관리자.lnk'); $Shortcut.TargetPath = '%INSTALL_DIR%\시럽조제기 연결 관리자.exe'; $Shortcut.Save()"

REM 시작 메뉴 바로가기 생성
echo 시작 메뉴 바로가기를 생성합니다...
if not exist "%START_MENU_DIR%\시럽조제기 연결 관리자" mkdir "%START_MENU_DIR%\시럽조제기 연결 관리자"
powershell "$WshShell = New-Object -comObject WScript.Shell; $Shortcut = $WshShell.CreateShortcut('%START_MENU_DIR%\시럽조제기 연결 관리자\시럽조제기 연결 관리자.lnk'); $Shortcut.TargetPath = '%INSTALL_DIR%\시럽조제기 연결 관리자.exe'; $Shortcut.Save()"

echo.
echo 설치가 완료되었습니다!
echo 바탕화면과 시작 메뉴에서 "시럽조제기 연결 관리자"를 실행할 수 있습니다.
echo.
pause 