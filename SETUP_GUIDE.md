# 오토시럽 로그인 기능 설치 가이드

## 📋 목차

1. [개요](#개요)
2. [Supabase 설정](#1-supabase-설정)
3. [백엔드 API 배포](#2-백엔드-api-배포)
4. [Electron 앱 설정](#3-electron-앱-설정)
5. [패키지 설치](#4-패키지-설치)
6. [테스트](#5-테스트)
7. [빌드 및 배포](#6-빌드-및-배포)
8. [사용량 확인](#7-사용량-확인)

---

## 개요

이 가이드는 약국별 처방전 파싱 사용량을 집계하기 위한 로그인 기능을 구현하는 방법을 설명합니다.

**수집되는 데이터:**
- 요양기관번호
- 사업자번호
- 약국명
- 파싱 횟수 (월별)

**절대 수집하지 않는 데이터:**
- 환자 개인정보
- 처방 내역
- 의약품 상세 정보

---

## 1. Supabase 설정

### 1.1 Supabase 프로젝트 생성

1. https://supabase.com 접속
2. "Start your project" 클릭하여 회원가입
3. "New Project" 클릭
4. 프로젝트 정보 입력:
   - **Name**: `autosyrup-billing`
   - **Database Password**: 강력한 비밀번호 설정 (저장!)
   - **Region**: `Northeast Asia (Seoul)` 선택
5. "Create new project" 클릭 (2-3분 소요)

### 1.2 데이터베이스 테이블 생성

1. 왼쪽 메뉴에서 **"SQL Editor"** 클릭
2. **"New query"** 클릭
3. 아래 SQL 코드를 복사하여 실행:

```sql
-- 1. 약국 정보 테이블
CREATE TABLE pharmacies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ykiin TEXT UNIQUE NOT NULL,
  biz_no TEXT NOT NULL,
  name TEXT NOT NULL,
  contact_email TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT DEFAULT 'active'
);

-- 2. 기기 정보 테이블
CREATE TABLE devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID REFERENCES pharmacies(id) ON DELETE CASCADE,
  device_uid TEXT UNIQUE NOT NULL,
  platform TEXT,
  app_version TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. 파싱 이벤트 테이블
CREATE TABLE parse_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID REFERENCES pharmacies(id) ON DELETE CASCADE,
  device_id UUID REFERENCES devices(id) ON DELETE CASCADE,
  source TEXT DEFAULT 'pharmIT3000',
  ts TIMESTAMPTZ DEFAULT NOW(),
  count INTEGER DEFAULT 1,
  idempotency_key TEXT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. 월간 사용량 뷰
CREATE OR REPLACE VIEW monthly_usage AS
SELECT
  pharmacy_id,
  DATE_TRUNC('month', ts) AS month,
  COUNT(*) AS parse_count,
  MIN(ts) AS first_seen,
  MAX(ts) AS last_seen
FROM parse_events
GROUP BY pharmacy_id, DATE_TRUNC('month', ts);

-- 인덱스 생성
CREATE INDEX idx_parse_events_pharmacy_ts ON parse_events(pharmacy_id, ts);
CREATE INDEX idx_parse_events_ts ON parse_events(ts);
CREATE INDEX idx_parse_events_idempotency ON parse_events(idempotency_key);
```

### 1.3 API 키 확인

1. 왼쪽 메뉴에서 **"Project Settings"** (톱니바퀴 아이콘) 클릭
2. **"API"** 메뉴 클릭
3. 다음 정보를 메모장에 복사:
   - `Project URL` (예: https://xxxxx.supabase.co)
   - `anon public` 키 (공개 API 키)
   - `service_role` 키 (관리자 API 키, **절대 노출 금지**)

---

## 2. 백엔드 API 배포

### 2.1 Railway 배포 (추천)

Railway는 무료 플랜을 제공하며 가장 간단합니다.

#### A. Railway 가입 및 프로젝트 생성

1. https://railway.app 접속
2. "Start a New Project" 클릭
3. GitHub 계정으로 로그인

#### B. 배포 설정

1. "Empty Project" 선택
2. "New" → "GitHub Repo" 클릭
3. 저장소 연결 또는 "Empty Service" 선택

**GitHub 저장소가 있는 경우:**
1. 저장소 선택
2. Root Directory: `/backend` 설정

**GitHub 저장소가 없는 경우:**
1. Empty Service 선택
2. Railway CLI를 통해 배포:

```bash
# Railway CLI 설치
npm install -g @railway/cli

# 로그인
railway login

# backend 폴더로 이동
cd backend

# 배포
railway up
```

#### C. 환경 변수 설정

Railway 대시보드에서 "Variables" 탭 클릭 후 다음 변수 추가:

```
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
JWT_SECRET=(아래 명령어로 생성한 값)
ADMIN_API_KEY=(임의의 강력한 문자열)
PORT=3000
NODE_ENV=production
```

**JWT_SECRET 생성:**
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

#### D. 도메인 생성

1. "Settings" → "Networking" 클릭
2. "Generate Domain" 클릭
3. 생성된 URL 복사 (예: https://autosyrup-backend-production.up.railway.app)

### 2.2 배포 확인

브라우저에서 배포된 URL 접속:
```
https://your-railway-url.railway.app/
```

다음과 같은 응답이 나오면 성공:
```json
{
  "status": "ok",
  "message": "오토시럽 백엔드 API 서버",
  "version": "1.0.0"
}
```

---

## 3. Electron 앱 설정

### 3.1 API URL 설정

`main.js` 파일을 열고 31번째 줄의 `API_BASE` 값을 변경:

```javascript
const API_BASE = 'https://your-railway-url.railway.app';
```

**주의:** Railway에서 생성한 실제 URL로 변경하세요!

---

## 4. 패키지 설치

프로젝트 루트 디렉토리에서 다음 명령어 실행:

```bash
npm install
```

새로 추가된 패키지:
- `keytar`: 보안 토큰 저장
- `uuid`: 디바이스 고유 ID 생성

---

## 5. 테스트

### 5.1 개발 모드 실행

```bash
npm start
```

### 5.2 등록 테스트

1. 앱 실행 시 "약국 등록" 창이 자동으로 표시됩니다
2. 다음 정보 입력:
   - **약국명**: 행복약국
   - **요양기관번호**: 12345678 (8~10자리)
   - **사업자번호**: 123-45-67890
   - **담당자 이메일**: test@pharmacy.com (선택)
3. "등록하기" 클릭
4. 성공 메시지 확인

### 5.3 파싱 이벤트 테스트

1. 처방전 파일 경로 설정
2. 처방전 파일 추가 (.txt 또는 .xml)
3. 파일 파싱 후 콘솔에서 다음 메시지 확인:
   ```
   ✅ 파싱 이벤트 전송 성공: 파일명.txt
   ```

### 5.4 Supabase에서 확인

1. Supabase 대시보드 → "Table Editor" 이동
2. `parse_events` 테이블 확인
3. 파싱 이벤트가 기록되었는지 확인

---

## 6. 빌드 및 배포

### 6.1 앱 빌드

```bash
npm run build
```

빌드된 설치 파일은 `release/` 폴더에 생성됩니다.

### 6.2 주의사항

**keytar 빌드 문제 해결:**

Windows에서 keytar 빌드 오류가 발생하면:

1. **Visual Studio Build Tools 설치:**
   ```bash
   npm install --global windows-build-tools
   ```

2. **또는 Python 2.7 설치:**
   - https://www.python.org/downloads/release/python-2718/
   - 환경 변수에 Python 경로 추가

3. **빌드 재시도:**
   ```bash
   npm install keytar --build-from-source
   npm run build
   ```

---

## 7. 사용량 확인

### 7.1 월간 사용량 조회 (관리자)

배포된 API 서버에 요청:

```bash
curl -H "X-Admin-Key: YOUR_ADMIN_API_KEY" \
  https://your-railway-url.railway.app/v1/admin/usage?month=2025-10
```

### 7.2 특정 약국 사용량 조회

```bash
curl -H "X-Admin-Key: YOUR_ADMIN_API_KEY" \
  https://your-railway-url.railway.app/v1/admin/usage/12345678
```

### 7.3 웹 대시보드 (선택)

간단한 웹 대시보드를 만들려면:

1. `backend/` 폴더에 `dashboard.html` 생성:

```html
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <title>오토시럽 사용량 대시보드</title>
    <style>
        body { font-family: sans-serif; padding: 20px; }
        table { width: 100%; border-collapse: collapse; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #4CAF50; color: white; }
    </style>
</head>
<body>
    <h1>오토시럽 월간 사용량</h1>
    <div>
        <label>월 선택:</label>
        <input type="month" id="monthPicker" value="2025-10">
        <button onclick="loadUsage()">조회</button>
    </div>
    <table id="usageTable">
        <thead>
            <tr>
                <th>약국명</th>
                <th>요양기관번호</th>
                <th>사업자번호</th>
                <th>파싱 횟수</th>
                <th>첫 사용</th>
                <th>마지막 사용</th>
            </tr>
        </thead>
        <tbody id="usageBody"></tbody>
    </table>

    <script>
        const API_BASE = 'https://your-railway-url.railway.app';
        const ADMIN_KEY = 'YOUR_ADMIN_API_KEY';

        async function loadUsage() {
            const month = document.getElementById('monthPicker').value;
            const response = await fetch(`${API_BASE}/v1/admin/usage?month=${month}`, {
                headers: { 'X-Admin-Key': ADMIN_KEY }
            });
            const data = await response.json();
            
            const tbody = document.getElementById('usageBody');
            tbody.innerHTML = '';
            
            data.data.forEach(item => {
                const row = `<tr>
                    <td>${item.pharmacy.name}</td>
                    <td>${item.pharmacy.ykiin}</td>
                    <td>${item.pharmacy.biz_no}</td>
                    <td>${item.parse_count}</td>
                    <td>${new Date(item.first_seen).toLocaleString()}</td>
                    <td>${new Date(item.last_seen).toLocaleString()}</td>
                </tr>`;
                tbody.innerHTML += row;
            });
        }

        loadUsage();
    </script>
</body>
</html>
```

2. Railway에 정적 파일 서빙 추가 (선택)

---

## 🎉 완료!

이제 앱이 약국별로 파싱 횟수를 자동으로 집계합니다.

### 정기 과금 프로세스

1. **월 말일**: Railway 대시보드에서 월간 사용량 조회
2. **약국 수 확인**: 파싱 횟수 ≥ 1인 약국 수 집계
3. **PharmIT3000에 지불**: 약국 수 × API 사용료

---

## ⚠️ 보안 주의사항

### 절대 노출 금지

- `SUPABASE_SERVICE_KEY`
- `JWT_SECRET`
- `ADMIN_API_KEY`

### Git 커밋 전 확인

```bash
# .gitignore에 다음이 포함되어 있는지 확인
backend/.env
backend/node_modules/
auth-token.txt
device-uid.txt
```

---

## 🆘 문제 해결

### 등록 창이 뜨지 않아요

1. DevTools 열기 (F12)
2. Console 탭에서 오류 확인
3. `main.js`의 `API_BASE` 값이 올바른지 확인

### 파싱 이벤트가 전송되지 않아요

1. 토큰이 저장되었는지 확인:
   ```
   %APPDATA%\오토시럽\auth-token.txt
   ```
2. 네트워크 연결 확인
3. Railway 서버가 실행 중인지 확인

### keytar 빌드 오류

Windows Build Tools 설치:
```bash
npm install --global windows-build-tools
```

---

## 📞 지원

문의사항이 있으시면 다음 채널로 연락주세요:
- 이메일: support@pharmcoder.kr
- GitHub Issues: https://github.com/pharmcoder-kr/prescription/issues

