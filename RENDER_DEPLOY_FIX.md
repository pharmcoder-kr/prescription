# Render.com 서버 배포 문제 해결

## 문제
404 Not Found: `/v1/auth/register` 엔드포인트가 서버에 없음

## 해결 방법

### 1. Render.com에서 수동 재배포

1. Render.com 대시보드 접속: https://dashboard.render.com
2. `autosyrup-backend` 서비스 선택
3. 상단 메뉴에서 **"Manual Deploy"** → **"Deploy latest commit"** 클릭
4. 배포 완료까지 대기 (2-3분)

### 2. GitHub에 코드 푸시 후 자동 배포

로컬에서 변경한 코드가 GitHub에 푸시되지 않았을 수 있습니다:

```bash
# backend 폴더에서 변경사항 확인
cd backend
git status

# 변경사항이 있다면 커밋 및 푸시
git add .
git commit -m "Add register endpoint"
git push origin main
```

Render.com이 GitHub와 연동되어 있다면 자동으로 재배포됩니다.

### 3. 서버 로그 확인

Render.com 대시보드에서:
1. `autosyrup-backend` → **"Logs"** 탭
2. 서버 시작 메시지 확인:
   ```
   🚀 오토시럽 백엔드 API 서버 시작
   📡 포트: 3000
   ```
3. 에러 메시지가 있는지 확인

### 4. 환경 변수 확인

Render.com 대시보드에서:
1. `autosyrup-backend` → **"Environment"** 탭
2. 다음 환경 변수가 모두 설정되어 있는지 확인:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_KEY`
   - `JWT_SECRET`
   - `ADMIN_API_KEY`
   - `PORT=3000`
   - `NODE_ENV=production`

### 5. 서버 재시작

1. Render.com 대시보드에서 `autosyrup-backend` 선택
2. 상단 메뉴에서 **"Manual Deploy"** → **"Clear build cache & deploy"** 클릭
3. 완전히 새로 빌드하여 배포

## 확인 방법

배포 후 브라우저에서 다음 URL 접속:
```
https://autosyrup-backend.onrender.com/
```

다음과 같은 응답이 나오면 성공:
```json
{
  "status": "ok",
  "message": "오토시럽 백엔드 API 서버",
  "version": "1.0.0"
}
```

## 문제가 계속되면

1. Render.com 서버 로그에서 에러 메시지 확인
2. 서버가 제대로 시작되었는지 확인
3. `package.json`의 `start` 스크립트가 올바른지 확인:
   ```json
   {
     "scripts": {
       "start": "node server.js"
     }
   }
   ```

