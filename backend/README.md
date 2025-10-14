# 오토시럽 백엔드 API 서버

약국별 처방전 파싱 사용량을 집계하는 백엔드 API 서버입니다.

## 설정 방법

### 1. 패키지 설치

```bash
cd backend
npm install
```

### 2. 환경 변수 설정

`.env.example` 파일을 복사하여 `.env` 파일을 생성하고 값을 입력합니다.

```bash
cp .env.example .env
```

`.env` 파일 수정:

```env
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
JWT_SECRET=랜덤한_64자_이상의_문자열
ADMIN_API_KEY=관리자_API_키
PORT=3000
```

**JWT_SECRET 생성 방법:**
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### 3. 로컬 실행

```bash
npm run dev
```

서버가 http://localhost:3000 에서 실행됩니다.

### 4. 프로덕션 실행

```bash
npm start
```

## API 엔드포인트

### 공개 API

#### 1. 헬스 체크
```
GET /
```

#### 2. 약국 등록
```
POST /v1/auth/enroll
Content-Type: application/json

{
  "ykiin": "12345678",
  "biz_no": "123-45-67890",
  "name": "행복약국",
  "contact_email": "admin@pharmacy.com",
  "device": {
    "device_uid": "unique-device-id",
    "platform": "win32",
    "app_version": "1.3.0"
  }
}

응답:
{
  "success": true,
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "pharmacy": {
    "id": "uuid",
    "name": "행복약국",
    "ykiin": "12345678"
  }
}
```

#### 3. 파싱 이벤트 기록
```
POST /v1/events/parse
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "source": "pharmIT3000",
  "count": 1,
  "idempotency_key": "device_uid_file_path_mtime",
  "ts": "2025-10-14T12:34:56.789Z"
}

응답:
{
  "success": true,
  "event_id": "uuid",
  "message": "이벤트가 기록되었습니다."
}
```

#### 4. 토큰 검증
```
GET /v1/auth/verify
Authorization: Bearer {access_token}

응답:
{
  "success": true,
  "valid": true,
  "pharmacy": {
    "id": "uuid",
    "name": "행복약국",
    "ykiin": "12345678",
    "status": "active"
  }
}
```

### 관리자 API

#### 1. 월간 사용량 조회
```
GET /v1/admin/usage?month=2025-10
X-Admin-Key: {ADMIN_API_KEY}

응답:
{
  "success": true,
  "count": 5,
  "data": [
    {
      "month": "2025-10-01T00:00:00.000Z",
      "parse_count": 120,
      "first_seen": "2025-10-01T09:00:00.000Z",
      "last_seen": "2025-10-14T18:30:00.000Z",
      "pharmacy": {
        "ykiin": "12345678",
        "biz_no": "123-45-67890",
        "name": "행복약국",
        "contact_email": "admin@pharmacy.com"
      }
    }
  ]
}
```

#### 2. 특정 약국 사용량 조회
```
GET /v1/admin/usage/{ykiin}
X-Admin-Key: {ADMIN_API_KEY}

응답:
{
  "success": true,
  "pharmacy": {
    "ykiin": "12345678",
    "biz_no": "123-45-67890",
    "name": "행복약국",
    "contact_email": "admin@pharmacy.com",
    "created_at": "2025-10-01T09:00:00.000Z",
    "last_seen_at": "2025-10-14T18:30:00.000Z"
  },
  "usage": [
    {
      "month": "2025-10-01T00:00:00.000Z",
      "parse_count": 120,
      "first_seen": "2025-10-01T09:00:00.000Z",
      "last_seen": "2025-10-14T18:30:00.000Z"
    }
  ]
}
```

## 배포

Railway 또는 Render에 무료로 배포할 수 있습니다. 자세한 내용은 `DEPLOYMENT.md`를 참조하세요.

## 보안

- **절대 노출 금지**: `SUPABASE_SERVICE_KEY`, `JWT_SECRET`, `ADMIN_API_KEY`
- 환경 변수는 `.env` 파일에만 저장하고 Git에 커밋하지 마세요
- `.gitignore`에 `.env` 파일이 포함되어 있는지 확인하세요

## 라이센스

MIT

