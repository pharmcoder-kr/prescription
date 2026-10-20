const axios = require('axios');
const fs = require('fs');
const path = require('path');

const GITHUB_TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const OWNER = 'pharmcoder-kr';
const REPO = 'prescription';
const VERSION = '1.3.54';
const TAG = `v${VERSION}`;
const RELEASE_TITLE = `v${VERSION} - JVP 용량 해석 규칙 정정 (처방일수·횟수·1회량 순서)`;

async function createRelease() {
  if (!GITHUB_TOKEN) {
    console.error('❌ GitHub Token이 필요합니다!');
    console.error('환경 변수 GH_TOKEN 또는 GITHUB_TOKEN을 설정해주세요.');
    process.exit(1);
  }

  const releaseNotes = `## v${VERSION}: JVP 용량 해석 규칙 정정

### 주요 변경사항
- **JVP 용량 필드 순서 정정**: 정수·소수 처방 모두 동일한 규칙으로 해석합니다
  - 혼자 떨어진 숫자 = 처방일수, 다음 숫자의 첫자리 = 1일 복용횟수, 그 뒤에 붙은 숫자 = 1회 복용량
  - 정수 예) \`3  21\` → 1회량 1 / 2회 / 3일, \`6  54\` → 4 / 5회 / 6일, \`9  87\` → 7 / 8회 / 9일
  - 소수 예) \`3  21.5\` → 1회량 1.5 / 2회 / 3일, \`9  87.5\` → 7.5 / 8회 / 9일, \`5  25.5\` → 5.5 / 2회 / 5일
  - 공백 없이 붙은 형태(\`123315\`)도 같은 순서(123일 / 3회 / 1회량 15)로 해석합니다
- 1회량과 처방일수 표시가 바로잡힙니다. 총량(1회량×횟수×일수)은 기존과 동일합니다

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
      'Authorization': `token ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json'
    };

    console.log('1️⃣  기존 Release 확인 중...');
    let releaseResponse;
    let releaseId;
    let uploadUrl;

    const existingReleases = await axios.get(
      `https://api.github.com/repos/${OWNER}/${REPO}/releases`,
      { headers: apiHeaders }
    );

    const existing = existingReleases.data.find(release => release.tag_name === TAG);

    if (existing) {
      console.log(`✅ 기존 Release 발견 (ID: ${existing.id})`);
      releaseId = existing.id;
      uploadUrl = existing.upload_url.replace('{?name,label}', '');

      releaseResponse = await axios.patch(
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
      releaseResponse = await axios.post(
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
        const shouldDelete = filesToUpload.some(file => file.name === asset.name);
        if (shouldDelete) {
          console.log(`   삭제 중: ${asset.name}`);
          await axios.delete(
            `https://api.github.com/repos/${OWNER}/${REPO}/releases/assets/${asset.id}`,
            { headers: apiHeaders }
          );
          console.log(`   ✅ 삭제 완료: ${asset.name}`);
        }
      }
    } catch (error) {
      console.log('   기존 에셋 확인 중 오류 (무시하고 계속):', error.message);
    }
    console.log('');

    console.log('3️⃣  파일 업로드 중...');
    for (const file of filesToUpload) {
      if (!fs.existsSync(file.path)) {
        console.log(`⚠️  파일 없음: ${file.path}`);
        continue;
      }

      const fileData = fs.readFileSync(file.path);
      const fileSize = fs.statSync(file.path).size;
      const fileSizeMB = (fileSize / 1024 / 1024).toFixed(2);

      console.log(`   업로드: ${file.name} (${fileSizeMB} MB)`);

      try {
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
      } catch (error) {
        console.log(`   ❌ 업로드 실패: ${file.name} - ${error.message}`);
        if (error.response) {
          console.log(`      상태 코드: ${error.response.status}`);
          console.log(`      응답: ${JSON.stringify(error.response.data)}`);
        }
      }
    }

    console.log('');
    console.log('===========================================');
    console.log('✅ Release 작업 완료!');
    console.log(`🔗 URL: ${releaseResponse.data.html_url}`);
    console.log('===========================================');
  } catch (error) {
    console.error('❌ Release 생성 실패:', error.message);
    if (error.response) {
      console.error('상태 코드:', error.response.status);
      console.error('응답:', JSON.stringify(error.response.data, null, 2));
    }
    process.exit(1);
  }
}

createRelease();
