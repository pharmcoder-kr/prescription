# 완전 무료 백엔드 옵션 비교

## 🆓 영구 무료 백엔드 서비스

### ✅ 추천 1위: Render (가장 쉬움)

**장점:**
- ✅ 완전 무료 (신용카드 불필요)
- ✅ 설정 매우 간단 (5분)
- ✅ Railway와 사용법 동일
- ✅ 자동 배포, HTTPS 포함
- ✅ 월 750시간 (하루 24시간 사용 가능)

**단점:**
- ⚠️ 15분 비활동 시 슬립 모드
- ⚠️ 첫 요청 시 30초 대기 (이후 정상)

**배포 가이드:** [RENDER_DEPLOY.md](./RENDER_DEPLOY.md)

---

### 2위: Vercel (서버리스)

**장점:**
- ✅ 완전 무료
- ✅ 슬립 모드 없음 (항상 빠름)
- ✅ 월 100,000 함수 호출
- ✅ 자동 HTTPS

**단점:**
- ⚠️ 서버리스 함수로 변환 필요 (복잡)
- ⚠️ Express 서버 그대로 사용 불가

---

### 3위: Fly.io

**장점:**
- ✅ 무료 플랜 (3개 앱)
- ✅ 슬립 모드 없음
- ✅ Docker 지원

**단점:**
- ⚠️ 신용카드 필요 (청구 안 됨)
- ⚠️ 설정 복잡

---

## 💡 추천: Render 사용

가장 간단하고 안정적입니다.

### 빠른 시작 (5분)

1. https://render.com 가입
2. "New +" → "Web Service"
3. GitHub 저장소 연결
4. Root Directory: `backend` 설정
5. 환경 변수 추가
6. 배포!

자세한 가이드: [RENDER_DEPLOY.md](./RENDER_DEPLOY.md)

---

## 슬립 모드 걱정 해결

앱 시작 시 자동으로 서버를 깨우므로, 실제로는 거의 문제가 없습니다.

**이미 구현된 기능:**
- 앱 시작 → 토큰 검증 → 서버 웜업
- 첫 파싱 시 서버 이미 깨어있음

---

## 비용 비교

| 서비스 | 무료 플랜 | 신용카드 | 슬립 모드 | 난이도 |
|--------|----------|----------|----------|--------|
| **Render** | ✅ 750h/월 | ❌ 불필요 | ⚠️ 15분 후 | ⭐ 쉬움 |
| Vercel | ✅ 100K호출 | ❌ 불필요 | ✅ 없음 | ⭐⭐ 보통 |
| Fly.io | ✅ 3개 앱 | ⚠️ 필요 | ✅ 없음 | ⭐⭐⭐ 어려움 |
| Railway | ⚠️ 30일 체험 | ✅ 필요 | ✅ 없음 | ⭐ 쉬움 |

---

## GitHub 저장소 없이 배포하는 방법

### 방법 1: GitHub 저장소 생성 (5분)

```bash
# 1. GitHub.com에서 새 저장소 생성

# 2. 로컬에서 푸시
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/your-username/prescription.git
git branch -M main
git push -u origin main

# 3. Render에서 저장소 연결
```

### 방법 2: Render CLI 사용

```bash
npm install -g @renderinc/cli
render login
cd backend
render deploy
```

---

## 📞 어떤 것을 선택해야 할까요?

### 개발자 아니고 간단하게 → **Render**
- GitHub에 코드 올리고
- Render 연결하면 끝

### 성능 중요, 기술 이해도 있음 → Vercel
- 서버리스 함수로 변환 필요
- 항상 빠른 응답

### 예산 있음, 프로덕션 → Railway (유료)
- 가장 안정적
- 슬립 모드 없음
- 월 $5부터

---

## ✅ 결론

**Render 무료 플랜**이 가장 적합합니다:
- 설정 간단 (5분)
- 완전 무료
- 슬립 모드는 앱에서 자동 해결

**배포 가이드:** [RENDER_DEPLOY.md](./RENDER_DEPLOY.md)

