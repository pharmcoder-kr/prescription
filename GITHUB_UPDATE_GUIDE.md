# GitHub 릴리즈를 통한 자동 업데이트 가이드

이 문서는 시럽조제기 연결 관리자 앱의 자동 업데이트 기능을 사용하는 방법을 안내합니다.

## 📋 목차

1. [사전 준비](#사전-준비)
2. [GitHub 리포지토리 설정](#github-리포지토리-설정)
3. [첫 번째 릴리즈 만들기](#첫-번째-릴리즈-만들기)
4. [새 버전 업데이트하기](#새-버전-업데이트하기)
5. [자동 업데이트 작동 방식](#자동-업데이트-작동-방식)
6. [문제 해결](#문제-해결)
7. [GitHub 대안](#github-대안)

---

## 🎯 사전 준비

### 1. GitHub 계정 만들기
- [GitHub](https://github.com) 접속
- 우측 상단 "Sign up" 클릭
- 이메일, 비밀번호, 사용자명 입력하여 계정 생성

### 2. 필요한 도구 설치
- **Git**: [https://git-scm.com/downloads](https://git-scm.com/downloads)
- **Node.js**: [https://nodejs.org](https://nodejs.org) (LTS 버전 권장)

### 3. Git 초기 설정
```bash
git config --global user.name "your-name"
git config --global user.email "your-email@example.com"
```

---

## 📦 GitHub 리포지토리 설정

### 1. 새 리포지토리 만들기

1. GitHub에 로그인 후 우측 상단 `+` 버튼 클릭 → `New repository` 선택
2. 리포지토리 정보 입력:
   - **Repository name**: `prescription` (또는 원하는 이름)
   - **Description**: "시럽조제기 연결 관리자"
   - **Public** 또는 **Private** 선택 (Public 권장, 무료로 자동 업데이트 가능)
   - ✅ Add a README file (선택사항)
3. `Create repository` 클릭

### 2. package.json 수정

프로젝트의 `package.json` 파일을 열고 다음 부분을 수정:

```json
"build": {
  "publish": {
    "provider": "github",
    "owner": "YOUR_GITHUB_USERNAME",    // ← 본인의 GitHub 사용자명
    "repo": "prescription"              // ← 위에서 만든 리포지토리 이름
  }
}
```

**예시:**
- GitHub 사용자명: `kimcoding`
- 리포지토리 이름: `prescription`

```json
"publish": {
  "provider": "github",
  "owner": "kimcoding",
  "repo": "prescription"
}
```

### 3. 로컬 프로젝트를 GitHub에 연결

터미널(명령 프롬프트)에서 프로젝트 폴더로 이동:

```bash
cd C:\Users\lhjlh\prescription
```

Git 초기화 및 GitHub에 연결:

```bash
# Git 초기화 (이미 되어 있으면 스킵)
git init

# GitHub 리포지토리 연결
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/prescription.git

# 현재 브랜치 이름 확인 및 변경 (필요시)
git branch -M main

# 모든 파일 추가
git add .

# 커밋
git commit -m "Initial commit"

# GitHub에 푸시
git push -u origin main
```

---

## 🚀 첫 번째 릴리즈 만들기

### 1. GitHub Personal Access Token 생성

자동 업데이트를 위해서는 GitHub 토큰이 필요합니다.

1. GitHub 우측 상단 프로필 클릭 → `Settings`
2. 좌측 하단 `Developer settings` 클릭
3. `Personal access tokens` → `Tokens (classic)` 클릭
4. `Generate new token` → `Generate new token (classic)` 선택
5. 토큰 설정:
   - **Note**: "Prescription App Release"
   - **Expiration**: `No expiration` (또는 원하는 기간)
   - **Scopes**: ✅ `repo` (전체 선택)
6. `Generate token` 클릭
7. **⚠️ 생성된 토큰 복사 및 안전한 곳에 보관** (다시 볼 수 없음!)

### 2. 환경 변수 설정

**Windows:**

1. 시스템 환경 변수 설정:
   - `Win + R` → `sysdm.cpl` 입력 → 실행
   - `고급` 탭 → `환경 변수` 클릭
   - `사용자 변수` 섹션에서 `새로 만들기` 클릭
   - 변수 이름: `GH_TOKEN`
   - 변수 값: 위에서 복사한 GitHub 토큰
   - 확인

2. **또는** 명령 프롬프트에서 임시로 설정:
   ```cmd
   set GH_TOKEN=your_github_token_here
   ```

3. **또는** PowerShell에서:
   ```powershell
   $env:GH_TOKEN="your_github_token_here"
   ```

### 3. 앱 빌드 및 릴리즈

```bash
# 의존성 설치 (처음 한 번만)
npm install

# 빌드 및 GitHub에 릴리즈 자동 업로드
npm run build
```

또는 수동으로 릴리즈 만들기:

```bash
# 빌드만 하기 (GitHub에 업로드 안 함)
npm run dist

# electron-builder로 수동 릴리즈
npx electron-builder --win --x64 --publish always
```

### 4. GitHub에서 릴리즈 확인

1. GitHub 리포지토리 페이지 접속
2. 우측 `Releases` 섹션 확인
3. 새로운 릴리즈 (v1.0.0)가 생성되었는지 확인
4. 릴리즈 파일:
   - `시럽조제기 연결 관리자 Setup 1.0.0.exe`
   - `latest.yml` (자동 업데이트 정보 파일)

---

## 🔄 새 버전 업데이트하기

### 1. 버전 번호 업데이트

`package.json`에서 버전 번호 변경:

```json
{
  "version": "1.0.1"  // 1.0.0 → 1.0.1
}
```

**버전 번호 규칙 (Semantic Versioning):**
- **Major** (1.0.0 → 2.0.0): 큰 변경사항, 호환성 깨짐
- **Minor** (1.0.0 → 1.1.0): 새로운 기능 추가
- **Patch** (1.0.0 → 1.0.1): 버그 수정

### 2. 변경사항 커밋

```bash
git add .
git commit -m "버전 1.0.1: 버그 수정 및 성능 개선"
git push origin main
```

### 3. 새 릴리즈 빌드 및 배포

```bash
# 환경 변수 설정 (필요시)
set GH_TOKEN=your_github_token_here

# 빌드 및 GitHub에 릴리즈
npm run build
```

또는:

```bash
npx electron-builder --win --x64 --publish always
```

### 4. 릴리즈 노트 작성 (선택사항)

GitHub 릴리즈 페이지에서 수동으로 릴리즈 노트 작성:

1. 리포지토리 → `Releases` 클릭
2. 최신 릴리즈 클릭 → `Edit` 버튼
3. Release notes 작성:
   ```markdown
   ## v1.0.1 업데이트 내용
   
   ### 🐛 버그 수정
   - 네트워크 연결 안정성 개선
   - 약물 전송 오류 수정
   
   ### ✨ 새로운 기능
   - 자동 업데이트 기능 추가
   
   ### 🔧 개선사항
   - UI/UX 개선
   - 성능 최적화
   ```
4. `Update release` 클릭

---

## ⚙️ 자동 업데이트 작동 방식

### 사용자 관점

1. **자동 확인**: 앱 시작 5초 후 자동으로 업데이트 확인
2. **알림 표시**: 새 버전이 있으면 모달 창 표시
   - 현재 버전
   - 새로운 버전
   - 릴리즈 노트
3. **사용자 선택**:
   - **다운로드**: 업데이트 다운로드 시작
   - **나중에**: 모달 닫기, 다음 앱 시작 시 다시 확인
4. **다운로드 진행**: 진행률 표시
5. **설치 선택**:
   - **지금 설치**: 앱 종료 후 즉시 업데이트 설치
   - **나중에 설치**: 앱 종료 시 자동으로 업데이트 설치

### 수동 확인

- 우측 상단 새로고침 버튼(⟳) 클릭하여 수동으로 업데이트 확인 가능

### 업데이트 파일 위치

- Windows: `%LOCALAPPDATA%\시럽조제기 연결 관리자-updater\`

---

## 🔧 문제 해결

### 1. "업데이트를 확인할 수 없습니다" 오류

**원인:**
- 인터넷 연결 문제
- GitHub 리포지토리가 Private이고 접근 권한이 없음
- `package.json`의 설정이 잘못됨

**해결:**
- 인터넷 연결 확인
- GitHub 리포지토리를 Public으로 변경하거나, Private인 경우 GH_TOKEN 설정 확인
- `package.json`의 `owner`와 `repo` 이름이 정확한지 확인

### 2. "GH_TOKEN is not set" 오류

**해결:**
```bash
# Windows CMD
set GH_TOKEN=your_github_token_here

# Windows PowerShell
$env:GH_TOKEN="your_github_token_here"

# 영구 설정 (환경 변수)
제어판 → 시스템 → 고급 시스템 설정 → 환경 변수
```

### 3. 빌드 실패

**원인:**
- Node.js 모듈이 설치되지 않음
- 파일 권한 문제

**해결:**
```bash
# 모듈 재설치
rm -rf node_modules
npm install

# 캐시 클리어
npm cache clean --force
```

### 4. Private 리포지토리에서 업데이트 안 됨

**해결:**

1. 리포지토리를 Public으로 변경 (권장)

**또는**

2. Private 리포지토리용 설정 추가:

`main.js`에 추가:
```javascript
autoUpdater.setFeedURL({
  provider: 'github',
  owner: 'YOUR_GITHUB_USERNAME',
  repo: 'YOUR_REPO_NAME',
  token: 'YOUR_GITHUB_TOKEN'  // 보안 주의!
});
```

**⚠️ 주의:** 토큰을 코드에 직접 넣으면 보안 위험이 있으므로 환경 변수를 사용하세요.

---

## 🆚 GitHub 대안

버전 관리가 처음이신 분들을 위한 여러 대안이 있습니다:

### 1. **GitHub (권장) ⭐**

**장점:**
- 무료 (Public 리포지토리)
- electron-updater와 완벽한 호환
- 대용량 파일 지원
- 버전 관리 + 자동 업데이트 한 번에 해결
- 전 세계에서 가장 많이 사용

**단점:**
- 초기 학습 곡선이 있음
- 영어 위주 인터페이스

**추천 대상:** 대부분의 사용자

---

### 2. **GitLab**

**장점:**
- GitHub와 유사한 인터페이스
- 무료 Private 리포지토리 무제한
- electron-updater 지원
- CI/CD 기능 강력

**단점:**
- GitHub보다 약간 느림
- 설정이 복잡할 수 있음

**설정 방법:**
```json
"publish": {
  "provider": "gitlab",
  "owner": "YOUR_GITLAB_USERNAME",
  "repo": "prescription"
}
```

**추천 대상:** Private 리포지토리를 많이 사용하는 경우

---

### 3. **AWS S3 + CloudFront**

**장점:**
- 빠른 다운로드 속도
- 안정적인 서비스
- 커스터마이징 자유도 높음

**단점:**
- 비용 발생 (소규모는 거의 무료)
- 설정이 복잡함
- 버전 관리 별도로 필요

**설정 방법:**
```json
"publish": {
  "provider": "s3",
  "bucket": "your-bucket-name",
  "region": "ap-northeast-2"
}
```

**추천 대상:** AWS 경험이 있고 고성능이 필요한 경우

---

### 4. **자체 서버 (HTTP Server)**

**장점:**
- 완전한 제어
- 비용 없음 (서버가 있다면)

**단점:**
- 서버 관리 필요
- 보안 설정 필요
- 대역폭 제한 가능

**설정 방법:**
```json
"publish": {
  "provider": "generic",
  "url": "https://your-domain.com/updates"
}
```

**추천 대상:** 자체 서버가 있고 IT 지식이 충분한 경우

---

### 5. **간단한 대안: Google Drive / Dropbox (비추천)**

**장점:**
- 사용하기 쉬움
- 익숙한 인터페이스

**단점:**
- 자동 업데이트 지원 안 됨
- 수동으로 다운로드 링크 공유 필요
- 버전 관리 안 됨

**사용 방법:**
- 빌드된 설치 파일을 Google Drive에 업로드
- 공유 링크 생성하여 사용자에게 전달
- 사용자가 수동으로 다운로드 후 설치

**추천 대상:** 사용자가 극소수이고 자동 업데이트가 필요 없는 경우

---

## 📊 비교표

| 서비스 | 난이도 | 비용 | 자동 업데이트 | 버전 관리 | 추천도 |
|--------|--------|------|---------------|-----------|--------|
| **GitHub** | ⭐⭐ | 무료 | ✅ | ✅ | ⭐⭐⭐⭐⭐ |
| **GitLab** | ⭐⭐ | 무료 | ✅ | ✅ | ⭐⭐⭐⭐ |
| **AWS S3** | ⭐⭐⭐⭐ | 유료 | ✅ | ❌ | ⭐⭐⭐ |
| **자체 서버** | ⭐⭐⭐⭐⭐ | 무료* | ✅ | ❌ | ⭐⭐ |
| **Google Drive** | ⭐ | 무료 | ❌ | ❌ | ⭐ |

---

## 💡 초보자 추천 워크플로우

### 방법 1: GitHub Desktop 사용 (가장 쉬움)

1. **GitHub Desktop 설치**: [https://desktop.github.com/](https://desktop.github.com/)
2. 프로그램 실행 후 GitHub 계정으로 로그인
3. `File` → `Add Local Repository` → 프로젝트 폴더 선택
4. 변경사항 확인 → 좌측 하단에 커밋 메시지 입력 → `Commit to main`
5. 상단 `Push origin` 버튼 클릭

### 방법 2: VS Code 사용

1. **VS Code 설치**: [https://code.visualstudio.com/](https://code.visualstudio.com/)
2. 프로젝트 폴더 열기
3. 좌측 Source Control 아이콘 클릭
4. 변경사항 확인 → `+` 버튼으로 스테이징
5. 메시지 입력 → `✓` 버튼으로 커밋
6. `...` 메뉴 → `Push` 클릭

---

## 📚 참고 자료

- [GitHub 공식 가이드 (한국어)](https://docs.github.com/ko)
- [electron-builder 문서](https://www.electron.build/)
- [electron-updater 문서](https://www.electron.build/auto-update)
- [Semantic Versioning](https://semver.org/lang/ko/)

---

## 🆘 지원

문제가 발생하면:
1. 이 가이드의 [문제 해결](#문제-해결) 섹션 확인
2. GitHub 리포지토리의 Issues 탭에서 질문
3. electron-builder 커뮤니티에 문의

---

**마지막 업데이트**: 2025년 10월 9일


