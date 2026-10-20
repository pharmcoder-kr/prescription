const axios = require('axios');
const fs = require('fs');
const path = require('path');

const GITHUB_TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const OWNER = 'pharmcoder-kr';
const REPO = 'prescription';
const VERSION = '1.3.52';
const TAG = `v${VERSION}`;
const RELEASE_TITLE = `v${VERSION} - PM3000/팜플러스20 JVP 양식(|JVPHEAD|) 처방전 추가 지원`;

async function createRelease() {
  if (!GITHUB_TOKEN) {
    console.error('❌ GitHub Token이 필요합니다!');
    console.error('환경 변수 GH_TOKEN 또는 GITHUB_TOKEN을 설정해주세요.');
    process.exit(1);
  }

  const releaseNotes = `## v${VERSION}: PM3000/팜플러스20 JVP 양식 처방전 추가 지원

### 주요 변경사항
- **JVP 고정폭 양식 자동 인식**: PM3000/팜플러스20 모드에서 파일 내용에 \`|JVPHEAD|\`/\`|JVMHEAD|\` 마커가 있는 처방전도 자동으로 파싱합니다 (기존 백슬래시 양식은 그대로 동작)
  - 환자명, 접수시간(예: 20261020 17:45), 만나이, 생년월일, 요양기관번호, 의사번호 인식
  - 약품코드: 앞 알파벳(E/T 등)을 제외한 9자리 숫자 (예: E645702251 → 645702251)
  - 1회복용량/1일 복용횟수/처방일수: 고정 컬럼으로 해석 (1회량 앞 3칸, 횟수 1자리, 나머지는 일수)
    - 예) \`5  35\` → 5 / 3 / 5, \`11 3123\` → 11 / 3 / 123, \`123315\` → 123 / 3 / 15
- 파싱 결과는 기존과 동일하게 환자 목록·약품 테이블(1회량/횟수/일수/총량)에 표시됩니다

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
