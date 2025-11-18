# Render.com Build/Start Command 수정 가이드

## 문제
- Build Command: `backend/ $ npm install` (불필요한 `backend/ $` 포함)
- Start Command: `backend/ $ npm start` (불필요한 `backend/ $` 포함)
- Root Directory가 `backend`로 설정되어 있으면 명령어에 경로를 포함할 필요 없음

## 해결 방법

### 1. Render.com Settings 수정

1. Render.com 대시보드에서 `autosyrup-backend` → **"Settings"** 탭
2. **"Build Command"** 섹션의 **"Edit"** 버튼 클릭
3. 내용을 다음과 같이 수정:
   ```
   npm install
   ```
   (기존: `backend/ $ npm install`)
4. **"Save"** 클릭

5. **"Start Command"** 섹션의 **"Edit"** 버튼 클릭
6. 내용을 다음과 같이 수정:
   ```
   npm start
   ```
   (기존: `backend/ $ npm start`)
7. **"Save"** 클릭

### 2. 최신 코드 GitHub에 푸시

로컬에서 변경한 코드가 GitHub에 푸시되지 않았을 수 있습니다:

```bash
# 프로젝트 루트에서
git status
git add .
git commit -m "Add register endpoint and improve logging"
git push origin main
```

### 3. 재배포

1. Render.com 대시보드에서 `autosyrup-backend` 선택
2. **"Manual Deploy"** → **"Deploy latest commit"** 클릭
3. Logs 탭에서 배포 진행 상황 확인

### 4. 배포 완료 확인

Logs 탭에서 다음 메시지가 보이면 성공:

```
===========================================
🚀 오토시럽 백엔드 API 서버 시작
📡 포트: 3000
🌐 환경: production
===========================================
📋 등록된 라우트:
  GET  /
  POST /v1/auth/register
  POST /v1/auth/login
  POST /v1/events/parse/batch
===========================================
```

### 5. API 테스트

배포 완료 후 브라우저에서:
```
https://autosyrup-backend.onrender.com/
```

응답이 나오면 서버가 정상 작동 중입니다.

