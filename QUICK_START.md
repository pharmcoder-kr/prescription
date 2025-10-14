# 빠른 시작 가이드 (5분 완성)

로그인 기능을 빠르게 테스트하는 방법입니다.

## 1단계: 백엔드 없이 로컬 테스트 (등록 화면만 확인)

```bash
# 패키지 설치
npm install

# 개발 모드 실행
npm start
```

앱 실행 시 등록 화면이 나타납니다. "나중에 등록하기" 클릭하면 오프라인 모드로 사용 가능합니다.

---

## 2단계: 실제 백엔드 연결 (완전한 기능)

### A. Supabase 설정 (3분)

1. https://supabase.com 가입
2. 새 프로젝트 생성: `autosyrup-billing`
3. SQL Editor에서 다음 실행:

```sql
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

CREATE TABLE devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID REFERENCES pharmacies(id) ON DELETE CASCADE,
  device_uid TEXT UNIQUE NOT NULL,
  platform TEXT,
  app_version TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW()
);

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

CREATE OR REPLACE VIEW monthly_usage AS
SELECT
  pharmacy_id,
  DATE_TRUNC('month', ts) AS month,
  COUNT(*) AS parse_count,
  MIN(ts) AS first_seen,
  MAX(ts) AS last_seen
FROM parse_events
GROUP BY pharmacy_id, DATE_TRUNC('month', ts);

CREATE INDEX idx_parse_events_pharmacy_ts ON parse_events(pharmacy_id, ts);
CREATE INDEX idx_parse_events_ts ON parse_events(ts);
CREATE INDEX idx_parse_events_idempotency ON parse_events(idempotency_key);
```

4. Project Settings → API에서 다음 복사:
   - `Project URL`
   - `service_role` 키

### B. Railway 배포 (2분)

1. https://railway.app 가입 (GitHub 계정 사용)
2. "New Project" → "Empty Service"
3. Variables 탭에서 환경 변수 추가:

```
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
JWT_SECRET=(아래 명령어 실행 결과)
ADMIN_API_KEY=my-secret-admin-key-123
PORT=3000
NODE_ENV=production
```

**JWT_SECRET 생성:**
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

4. Settings → Networking → "Generate Domain"
5. 생성된 URL 복사

### C. 백엔드 코드 배포

#### 방법 1: GitHub 연결 (추천)

1. GitHub에 저장소 생성 후 푸시:
```bash
git add .
git commit -m "Add login feature"
git push origin main
```

2. Railway에서 "New Service" → "GitHub Repo" → 저장소 선택
3. Root Directory: `/backend` 설정

#### 방법 2: Railway CLI

```bash
# Railway CLI 설치
npm install -g @railway/cli

# 로그인
railway login

# backend 폴더로 이동
cd backend

# 프로젝트 연결
railway link

# 배포
railway up
```

### D. Electron 앱 설정

`main.js` 31번째 줄 수정:

```javascript
const API_BASE = 'https://your-railway-url.railway.app';
```

Railway에서 생성된 실제 URL로 변경하세요!

---

## 3단계: 테스트

```bash
# 앱 실행
npm start
```

1. **등록 화면**에 테스트 정보 입력:
   - 약국명: 테스트약국
   - 요양기관번호: 12345678
   - 사업자번호: 123-45-67890
   
2. "등록하기" 클릭

3. 처방전 파일 추가 후 파싱

4. 콘솔에서 확인:
   ```
   ✅ 파싱 이벤트 전송 성공
   ```

---

## 4단계: 사용량 확인

### 브라우저에서 확인

```
https://your-railway-url.railway.app/v1/admin/usage?month=2025-10
```

Headers에 다음 추가:
```
X-Admin-Key: my-secret-admin-key-123
```

### curl로 확인

```bash
curl -H "X-Admin-Key: my-secret-admin-key-123" \
  https://your-railway-url.railway.app/v1/admin/usage?month=2025-10
```

---

## 완료!

이제 앱이 자동으로 파싱 횟수를 집계합니다.

**다음 단계:**
- 자세한 가이드: [SETUP_GUIDE.md](./SETUP_GUIDE.md)
- 백엔드 배포: [backend/DEPLOYMENT.md](./backend/DEPLOYMENT.md)
- API 문서: [backend/README.md](./backend/README.md)

---

## 자주 묻는 질문

### Q: 등록하지 않고 사용할 수 있나요?
A: 네, "나중에 등록하기" 클릭하면 오프라인 모드로 사용 가능합니다. 단, 파싱 횟수는 집계되지 않습니다.

### Q: 개인정보는 안전한가요?
A: 네, 요양기관번호/사업자번호/약국명만 수집되며, 환자 정보나 처방 내역은 절대 전송되지 않습니다.

### Q: 비용이 얼마나 드나요?
A: Railway 무료 플랜(월 $5 크레딧)으로 충분합니다. 약 500시간 실행 가능합니다.

### Q: keytar 빌드 오류가 나요
A: Windows Build Tools 설치 필요:
```bash
npm install --global windows-build-tools
```

그 후 재설치:
```bash
npm install keytar --build-from-source
```

