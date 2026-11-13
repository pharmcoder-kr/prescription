const axios = require('axios');
const fs = require('fs');
const path = require('path');

const GITHUB_TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const OWNER = 'pharmcoder-kr';
const REPO = 'prescription';
const VERSION = '1.3.60';
const TAG = `v${VERSION}`;
const RELEASE_TITLE = `v${VERSION} - 이팜 DAT 처방전 연동`;

async function createRelease() {
  if (!GITHUB_TOKEN) {
    console.error('❌ GitHub Token이 필요합니다!');
    console.error('환경 변수 GH_TOKEN 또는 GITHUB_TOKEN을 설정해주세요.');
    process.exit(1);
  }

  const releaseNotes = `## v${VERSION}: 이팜 신규 DAT 처방전 포맷 지원

### 주요 변경사항
- **이팜 DAT 파싱**: 소수 1회량(\`0.25\`, \`0.5\`, \`8.5\` 등)이 숫자로 들어간 \`.dat\` 파일을 인식합니다
- **기존 TXT 유지**: 구형 JVM 문자코드(\`a\`~\`x\`) \`.txt\` 양식도 그대로 지원합니다
- **파일 감시**: 이팜 선택 시 \`.txt\` / \`.dat\` 모두 자동 감지합니다
- **총량 계산**: DAT는 \`1회량 × 횟수 × 일수\`로 총량을 계산해 조제 연동합니다

### 참고
- ESP32로는 기존과 같이 총량을 **정수 mL로 올림**(\`Math.ceil\`)해 전달합니다 (예: 76.5 → 77)

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

    const apiHeaders = {
      Authorization: `token ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json'
    };

    console.log('1️⃣  기존 Release 확인 중...');
    let releaseId;
    let uploadUrl;

    const existingReleases = await axios.get(
      `https://api.github.com/repos/${OWNER}/${REPO}/releases`,
      { headers: apiHeaders }
    );

    const existing = existingReleases.data.find((release) => release.tag_name === TAG);

    if (existing) {
      console.log(`✅ 기존 Release 발견 (ID: ${existing.id})`);
      releaseId = existing.id;
      uploadUrl = existing.upload_url.replace('{?name,label}', '');

      await axios.patch(
        `https://api.github.com/repos/${OWNER}/${REPO}/releases/${releaseId}`,
        {
          name: RELEASE_TITLE,
          body: releaseNotes,
          draft: false
        },
        { headers: apiHeaders }
      );
      console.log('✅ Release 내용 업데이트 완료');
    } else {
      console.log('📦 새 Release 생성 중...');
      const releaseResponse = await axios.post(
        `https://api.github.com/repos/${OWNER}/${REPO}/releases`,
        {
          tag_name: TAG,
          name: RELEASE_TITLE,
          body: releaseNotes,
          draft: false,
          prerelease: false
        },
        { headers: apiHeaders }
      );
      releaseId = releaseResponse.data.id;
      uploadUrl = releaseResponse.data.upload_url.replace('{?name,label}', '');
      console.log(`✅ Release 생성 완료 (ID: ${releaseId})`);
    }

    console.log('');

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

    console.log('2️⃣  기존 에셋 확인 중...');
    try {
      const assetsResponse = await axios.get(
        `https://api.github.com/repos/${OWNER}/${REPO}/releases/${releaseId}/assets`,
        { headers: apiHeaders }
      );

      for (const asset of assetsResponse.data) {
        const shouldReplace = filesToUpload.some((f) => f.name === asset.name);
        if (shouldReplace) {
          console.log(`🗑️  기존 에셋 삭제: ${asset.name}`);
          await axios.delete(
            `https://api.github.com/repos/${OWNER}/${REPO}/releases/assets/${asset.id}`,
            { headers: apiHeaders }
          );
        }
      }
    } catch (e) {
      console.log(`⚠️  에셋 목록 조회/삭제 중 경고: ${e.message}`);
    }

    console.log('');
    console.log('3️⃣  파일 업로드 중...');

    for (const file of filesToUpload) {
      const filePath = path.join(__dirname, file.path);
      if (!fs.existsSync(filePath)) {
        console.log(`⚠️  파일 없음 (건너뜀): ${file.path}`);
        continue;
      }

      const fileSize = fs.statSync(filePath).size;
      console.log(`📤 업로드: ${file.name} (${(fileSize / 1024 / 1024).toFixed(2)} MB)`);

      const fileData = fs.readFileSync(filePath);
      await axios.post(`${uploadUrl}?name=${encodeURIComponent(file.name)}`, fileData, {
        headers: {
          ...apiHeaders,
          'Content-Type': file.contentType,
          'Content-Length': fileSize
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      });
      console.log(`✅ 업로드 완료: ${file.name}`);
    }

    console.log('');
    console.log('===========================================');
    console.log('🎉 Release 완료!');
    console.log(`🔗 https://github.com/${OWNER}/${REPO}/releases/tag/${TAG}`);
    console.log('===========================================');
  } catch (error) {
    console.error('❌ Release 실패:', error.response?.data || error.message);
    process.exit(1);
  }
}

createRelease();
