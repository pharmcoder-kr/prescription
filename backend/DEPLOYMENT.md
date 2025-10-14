# 백엔드 배포 가이드

백엔드 API 서버를 무료로 배포하는 방법입니다.

## 옵션 1: Railway (추천)

Railway는 무료 플랜을 제공하며, Git 연동으로 자동 배포가 가능합니다.

### 1. Railway 가입

1. https://railway.app 접속
2. "Start a New Project" 클릭
3. GitHub 계정으로 로그인

### 2. 프로젝트 생성

1. "Deploy from GitHub repo" 선택
2. 저장소 선택 (또는 "Deploy from repo" → Empty Service)
3. "Add variables" 클릭하여 환경 변수 추가:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_KEY`
   - `JWT_SECRET`
   - `ADMIN_API_KEY`
   - `PORT` (Railway는 자동으로 설정하지만 3000으로 설정)

### 3. 배포

1. Railway가 자동으로 빌드 및 배포
2. "Generate Domain" 클릭하여 공개 URL 생성
3. 생성된 URL을 메모 (예: https://your-app.railway.app)

### 4. Electron 앱 설정

Electron 앱의 `API_BASE` 값을 Railway URL로 변경:

```javascript
const API_BASE = 'https://your-app.railway.app';
```

## 옵션 2: Render

Render도 무료 플랜을 제공합니다.

### 1. Render 가입

1. https://render.com 접속
2. GitHub 계정으로 로그인

### 2. 웹 서비스 생성

1. "New +" → "Web Service" 클릭
2. GitHub 저장소 연결
3. 설정:
   - **Name**: autosyrup-backend
   - **Environment**: Node
   - **Build Command**: `cd backend && npm install`
   - **Start Command**: `cd backend && npm start`
   - **Instance Type**: Free

### 3. 환경 변수 추가

"Environment" 섹션에서 다음 변수 추가:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `JWT_SECRET`
- `ADMIN_API_KEY`
- `PORT=3000`

### 4. 배포

1. "Create Web Service" 클릭
2. 자동으로 빌드 및 배포 시작
3. 생성된 URL 메모 (예: https://autosyrup-backend.onrender.com)

### 주의사항

Render 무료 플랜은 15분 동안 요청이 없으면 슬립 모드로 전환됩니다.
첫 요청 시 다시 깨어나는 데 30초 정도 걸릴 수 있습니다.

## 옵션 3: Vercel (서버리스 함수)

Vercel은 서버리스 함수로 배포할 수 있습니다.

### 1. 프로젝트 구조 변경

`backend/api/` 폴더를 만들고 서버리스 함수로 변환해야 합니다.
(고급 사용자 전용)

## 배포 확인

배포 후 브라우저에서 다음 URL 접속하여 확인:

```
https://your-deployed-url.com/
```

다음과 같은 응답이 나오면 성공:

```json
{
  "status": "ok",
  "message": "오토시럽 백엔드 API 서버",
  "version": "1.0.0"
}
```

## 배포 후 Electron 앱 설정

`main.js` 또는 별도의 설정 파일에 배포된 API URL을 설정:

```javascript
const API_BASE = 'https://your-deployed-url.com';
```

## 트러블슈팅

### 배포 실패 시

1. 로그 확인 (Railway 또는 Render 대시보드)
2. 환경 변수가 모두 설정되었는지 확인
3. `package.json`의 `engines` 필드 확인
4. Node.js 버전 확인 (최소 18.0.0)

### CORS 오류 시

`server.js`의 CORS 설정 확인:

```javascript
app.use(cors({
  origin: '*', // 프로덕션에서는 특정 도메인만 허용 권장
  credentials: true
}));
```

## 모니터링

무료 모니터링 서비스:
- **UptimeRobot**: https://uptimerobot.com (서버 다운 감지)
- **LogRocket**: https://logrocket.com (에러 추적)

## 비용

- **Railway**: 월 $5 크레딧 무료 (약 500시간 실행 가능)
- **Render**: 무료 플랜 (월 750시간, 슬립 모드 있음)
- **Vercel**: 무료 플랜 (서버리스 함수 100,000 호출/월)

## 권장 사항

1. **Railway 추천**: 슬립 모드 없이 안정적
2. **Render**: 비용 제로, 슬립 모드 감안
3. **Vercel**: 서버리스 함수 경험 있으면 OK

