const axios = require('axios');
const fs = require('fs');
const path = require('path');

const GITHUB_TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const OWNER = 'pharmcoder-kr';
const REPO = 'prescription';
const VERSION = '1.3.7';
const TAG = `v${VERSION}`;

async function createRelease() {
  if (!GITHUB_TOKEN) {
    console.error('❌ GitHub Token이 필요합니다!');
    console.error('환경 변수 GH_TOKEN 또는 GITHUB_TOKEN을 설정해주세요.');
    process.exit(1);
  }

  const releaseNotes = `## 주요 변경사항

### 🌐 네트워크 스캔 개선
- **정확한 네트워크 범위 감지**: 실제 사용 중인 네트워크 인터페이스를 우선적으로 선택
- **Wi-Fi 우선 선택**: Wi-Fi 인터페이스를 자동으로 우선 선택하여 정확한 스캔 범위 감지
- **다중 네트워크 지원**: 여러 네트워크 인터페이스가 있을 때 콤보박스에서 선택 가능
- **가상 어댑터 제외**: VMware, VirtualBox 등 가상 어댑터는 낮은 우선순위로 설정
- **네트워크 정보 표시**: 콤보박스에 인터페이스 이름과 IP 주소를 함께 표시

### 🔧 기술적 개선
- 네트워크 감지 로직 개선 (main.js)
- 모든 네트워크 인터페이스 감지 기능 추가
- 네트워크 스캔 모달에서 네트워크 정보 재감지 기능 추가

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
        name: `v${VERSION} - 네트워크 스캔 개선`,
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

