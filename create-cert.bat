@echo off
echo 자체 서명 인증서 생성 중...

REM OpenSSL이 설치되어 있는지 확인
openssl version >nul 2>&1
if %errorLevel% neq 0 (
    echo OpenSSL이 설치되어 있지 않습니다.
    echo https://slproweb.com/products/Win32OpenSSL.html 에서 다운로드하세요.
    pause
    exit /b 1
)

REM 인증서 생성
echo 인증서를 생성합니다...
openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes -subj "/C=KR/ST=Seoul/L=Seoul/O=YourCompany/OU=IT/CN=SyrupDispenser"

REM PKCS12 형식으로 변환
echo PKCS12 형식으로 변환합니다...
openssl pkcs12 -export -out certificate.p12 -inkey key.pem -in cert.pem -passout pass:password

echo.
echo 인증서 생성 완료!
echo certificate.p12 파일이 생성되었습니다.
echo.
pause 