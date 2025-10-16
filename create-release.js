const axios = require('axios');
const fs = require('fs');
const path = require('path');

const GITHUB_TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const OWNER = 'pharmcoder-kr';
const REPO = 'prescription';
const VERSION = '1.3.4';
const TAG = `v${VERSION}`;

async function createRelease() {
  if (!GITHUB_TOKEN) {
    console.error('❌ GitHub Token이 필요합니다!');
    console.error('환경 변수 GH_TOKEN 또는 GITHUB_TOKEN을 설정해주세요.');
    process.exit(1);
  }

  const releaseNotes = `## 주요 변경사항

### 🚀 성능 개선
- **앱 시작 속도 대폭 개선**: 로컬 토큰이 있으면 서버 검증 없이 즉시 실행
- **처방전 리스트 즉시 로딩**: 컴퓨터를 껐다가 켜도 빠른 시작
- **오프라인 사용성 향상**: 서버 다운 시에도 정상 작동
- **백그라운드 검증**: 서버 상태 확인은 백그라운드에서만 수행

### 🔧 기술적 개선
- \`auth:is-enrolled\` 핸들러 최적화 (로컬 토큰만 확인)
- \`checkAndUpdatePharmacyStatus\` 함수 최적화
- 서버 타임아웃이 UI를 차단하지 않도록 수정

## 설치 방법
아래의 \`auto-syrup-setup-${VERSION}.exe\` 파일을 다운로드하여 실행하세요.

## 업데이트 방법
기존 사용자는 프로그램 실행 시 자동으로 업데이트 알림을 받습니다.`;

  try {
    console.log('===========================================');
    console.log('📦 GitHub Release 생성 시작');
    console.log('===========================================');
    console.log(`Repository: ${OWNER}/${REPO}`);
    console.log(`Version: ${VERSION}`);
    console.log(`Tag: ${TAG}`);
    console.log('');

    // 1. Draft Release 생성
    console.log('1️⃣  Draft Release 생성 중...');
    const releaseResponse = await axios.post(
      `https://api.github.com/repos/${OWNER}/${REPO}/releases`,
      {
        tag_name: TAG,
        name: `v${VERSION} - 앱 시작 속도 개선`,
        body: releaseNotes,
        draft: true,
        prerelease: false
      },
      {
        headers: {
          'Authorization': `token ${GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      }
    );

    const releaseId = releaseResponse.data.id;
    const uploadUrl = releaseResponse.data.upload_url.replace('{?name,label}', '');
    console.log(`✅ Draft Release 생성 완료 (ID: ${releaseId})`);
    console.log('');

    // 2. 파일 업로드
    const filesToUpload = [
      {
        path: `release/auto-syrup-setup-${VERSION}.exe`,
        name: `auto-syrup-setup-${VERSION}.exe`,
        contentType: 'application/x-msdownload'
      },
      {
        path: `release/auto-syrup-setup-${VERSION}.exe.blockmap`,
        name: `auto-syrup-setup-${VERSION}.exe.blockmap`,
        contentType: 'application/octet-stream'
      },
      {
        path: 'release/latest.yml',
        name: 'latest.yml',
        contentType: 'text/yaml'
      }
    ];

    console.log('2️⃣  파일 업로드 중...');
    for (const file of filesToUpload) {
      if (!fs.existsSync(file.path)) {
        console.log(`⚠️  파일 없음: ${file.path}`);
        continue;
      }

      const fileData = fs.readFileSync(file.path);
      const fileSize = fs.statSync(file.path).size;
      const fileSizeMB = (fileSize / 1024 / 1024).toFixed(2);

      console.log(`   업로드: ${file.name} (${fileSizeMB} MB)`);

      await axios.post(
        `${uploadUrl}?name=${encodeURIComponent(file.name)}`,
        fileData,
        {
          headers: {
            'Authorization': `token ${GITHUB_TOKEN}`,
            'Content-Type': file.contentType,
            'Content-Length': fileSize
          },
          maxContentLength: Infinity,
          maxBodyLength: Infinity
        }
      );

      console.log(`   ✅ 업로드 완료: ${file.name}`);
    }

    console.log('');
    console.log('===========================================');
    console.log('✅ Release 생성 완료!');
    console.log('===========================================');
    console.log('');
    console.log('🔗 Release URL:');
    console.log(`   ${releaseResponse.data.html_url}`);
    console.log('');
    console.log('💡 다음 단계:');
    console.log('   1. 위 URL로 이동하여 Release 내용 확인');
    console.log('   2. "Publish release" 버튼 클릭하여 공개');
    console.log('');

  } catch (error) {
    console.error('');
    console.error('❌ Release 생성 실패:', error.message);
    if (error.response) {
      console.error('상태 코드:', error.response.status);
      console.error('응답 데이터:', JSON.stringify(error.response.data, null, 2));
    }
    process.exit(1);
  }
}

createRelease();

