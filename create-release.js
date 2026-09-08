const axios = require('axios');
const fs = require('fs');
const path = require('path');

const GITHUB_TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const OWNER = 'pharmcoder-kr';
const REPO = 'prescription';
const VERSION = '1.3.45';
const TAG = `v${VERSION}`;
const RELEASE_TITLE = `v${VERSION} - 이팜 처방전 연동`;

async function createRelease() {
  if (!GITHUB_TOKEN) {
    console.error('❌ GitHub Token이 필요합니다!');
    console.error('환경 변수 GH_TOKEN 또는 GITHUB_TOKEN을 설정해주세요.');
    process.exit(1);
  }

  const releaseNotes = `## v${VERSION}: 이팜 처방전 연동

### 주요 변경사항
- **이팜 TXT 처방전 연동 추가**: 환경설정에서 PM3000/팜플러스20, 유팜에 이어 **이팜** 선택 가능
- 이팜 고정폭 TXT에서 환자명·접수시간·접수번호·약품코드·투약정보 파싱
- 투약 코드 해석: 아침/점심/저녁 용량 + 일수 (예: \`101000005\` → 1회 1mL, 1일 2회, 5일, 총 10mL)
- 문자 용량 지원: \`b\`=0.5, \`c\`=0.75, \`y\`=0.3333, \`z\`=0.6667 (예: \`bbb000005\` → 총 7.5mL)
- 날짜 필터는 파일명 YYYYMMDD 기준 (PM과 동일)
- 등록된 조제기의 약품코드와 일치하는 항목만 약품명 표시, 미등록은 공란

### 사용 방법
1. 설정 → 처방조제프로그램 → **이팜** 선택
2. 이팜에서 생성한 TXT가 쌓이는 폴더를 처방전 경로로 지정
3. 처방연동조제 화면에서 날짜별 환자·약물 목록 확인 후 조제

### 참고
- PM3000, 유팜 파싱 로직은 변경하지 않았습니다

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

    // 1. 기존 릴리즈 확인 또는 생성
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

    // 2. 같은 이름의 기존 에셋 삭제
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

    // 3. 파일 업로드
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
