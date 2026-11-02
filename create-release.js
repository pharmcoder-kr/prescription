const axios = require('axios');
const fs = require('fs');
const path = require('path');

const GITHUB_TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const OWNER = 'pharmcoder-kr';
const REPO = 'prescription';
const VERSION = '1.3.55';
const TAG = `v${VERSION}`;
const RELEASE_TITLE = `v${VERSION} - 문제사항 로그 블랙박스(당일 ESP·PC 묶음 전송)`;

async function createRelease() {
  if (!GITHUB_TOKEN) {
    console.error('❌ GitHub Token이 필요합니다!');
    console.error('환경 변수 GH_TOKEN 또는 GITHUB_TOKEN을 설정해주세요.');
    process.exit(1);
  }

  const releaseNotes = `## v${VERSION}: 문제사항 로그 블랙박스 안정화

### 주요 변경사항
- **문제사항 보내기**: 기기 실시간 \`/logs\`만 의존하지 않고, **당일 ESP 로그 + PC 스냅샷 + PC 앱 로그**를 묶어 서버로 전송합니다
- **PC 상시 기록**: 앱 로그를 날짜별 파일로 저장하고, 연결된 기기의 ESP 로그를 주기적으로 스냅샷합니다 (전원 재부팅 후에도 PC에 남은 기록 전송 가능)
- **버전 캐시**: 기기가 꺼져 있어도 이전에 확인한 FW/모델/HMI 버전을 함께 표시합니다
- **HMI LCD 버전 조회**: OTA 직후 \`/version\` 실패를 줄이기 위한 재시도·안정화 대기 추가
- **관리자/백엔드**: 긴 로그 본문 수용, 상세 화면에서 섹션·타임아웃 안내 개선

### 참고 (ESP 펌웨어)
- 기기 쪽 LittleFS 일별 블랙박스(\`261102_BLACK_BOX\` **1.0.49**)는 별도 플래시/OTA가 필요합니다
- PC 1.3.55만 업데이트해도 스냅샷·앱 로그 묶음 전송은 바로 적용됩니다

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
