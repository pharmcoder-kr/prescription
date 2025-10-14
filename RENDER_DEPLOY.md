# Render 무료 배포 가이드 (완전 무료)

## Render 배포 (5분)

### 1. Render 가입

1. https://render.com 접속
2. "Get Started for Free" 클릭
3. GitHub 계정으로 로그인

### 2. 웹 서비스 생성

1. 대시보드에서 **"New +"** 클릭
2. **"Web Service"** 선택
3. GitHub 저장소 연결:
   - "Connect a repository" 클릭
   - 저장소 선택 또는 "Configure account" 클릭하여 권한 부여

### 3. 설정

다음 정보 입력:

```
Name: autosyrup-backend
Environment: Node
Region: Singapore (가장 가까운 지역)
Branch: main
Root Directory: backend

Build Command: npm install
Start Command: npm start

Instance Type: Free
```

### 4. 환경 변수 추가

"Advanced" → "Add Environment Variable" 클릭하여 다음 변수 추가:

```
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
JWT_SECRET=(아래 명령어로 생성)
ADMIN_API_KEY=my-secret-admin-key-123
PORT=3000
NODE_ENV=production
```

**JWT_SECRET 생성:**
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### 5. 배포

1. **"Create Web Service"** 클릭
2. 자동으로 빌드 시작 (2-3분 소요)
3. 빌드 완료 후 URL 확인 (예: https://autosyrup-backend.onrender.com)

### 6. URL 확인

배포 완료 후 브라우저에서 접속:
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

### 7. Electron 앱 설정

`main.js` 31번째 줄 수정:

```javascript
const API_BASE = 'https://autosyrup-backend.onrender.com';
```

---

## ⚠️ Render 무료 플랜 제한

### 슬립 모드

- 15분 동안 요청이 없으면 자동 슬립
- 첫 요청 시 30초 정도 대기 (웜업 시간)
- 이후 요청은 정상 속도

**해결 방법:**
- 앱 시작 시 한 번 요청 → 토큰 검증 시 서버 깨움
- 이미 구현되어 있음 (걱정 안 해도 됨)

### 월 750시간 제한

- 하루 24시간 × 30일 = 720시간
- 충분히 사용 가능

---

## GitHub 저장소가 없는 경우

### 옵션 1: GitHub 저장소 생성 (추천)

```bash
# Git 초기화 (아직 안 했다면)
git init

# .gitignore 확인
echo "node_modules/" >> .gitignore
echo "backend/.env" >> .gitignore
echo ".DS_Store" >> .gitignore

# 커밋
git add .
git commit -m "Add backend server"

# GitHub에 저장소 생성 후 푸시
git remote add origin https://github.com/your-username/prescription.git
git branch -M main
git push -u origin main
```

그 후 Render에서 저장소 연결

### 옵션 2: Render CLI 사용

```bash
# Render CLI 설치
npm install -g @renderinc/cli

# 로그인
render login

# 배포
cd backend
render deploy
```

---

## 비용

**Render 무료 플랜:**
- ✅ 완전 무료 (영구)
- ✅ 신용카드 불필요
- ✅ 월 750시간 (충분)
- ✅ 자동 SSL (HTTPS)

**제한:**
- ⚠️ 슬립 모드 (15분 후)
- ⚠️ 공유 CPU
- ⚠️ 512MB RAM

→ 소규모 약국 사용에는 충분합니다!

---

## 슬립 모드 체감 없애는 팁

앱이 시작될 때 서버를 자동으로 깨우므로, 사용자는 거의 체감하지 못합니다.

`main.js`에 이미 구현되어 있음:
```javascript
// 토큰 검증 시 자동으로 서버 호출 (서버 웜업)
const isValid = await verifyToken();
```

첫 번째 파싱 이벤트 전송 시에도 서버가 이미 깨어있을 가능성이 높습니다.

---

## 다른 무료 옵션들

### Supabase Edge Functions (완전 무료)
- 서버리스 함수
- 설정 복잡함
- 무제한 호출 (무료 플랜)

### Vercel (완전 무료)
- 서버리스 함수
- 월 100,000 호출
- 설정 약간 복잡

### Cloudflare Workers (완전 무료)
- 매일 100,000 요청
- 설정 복잡함

**→ Render가 가장 간단하고 안정적입니다!**

