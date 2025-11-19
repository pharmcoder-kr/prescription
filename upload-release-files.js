const axios = require('axios');
const fs = require('fs');

const GITHUB_TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const OWNER = 'pharmcoder-kr';
const REPO = 'prescription';
const VERSION = '1.3.10';
const TAG = `v${VERSION}`;

async function uploadReleaseFiles() {
  if (!GITHUB_TOKEN) {
    console.error('❌ GitHub Token이 필요합니다!');
    console.error('환경 변수 GH_TOKEN 또는 GITHUB_TOKEN을 설정해주세요.');
    process.exit(1);
  }

  try {
    console.log('===========================================');
    console.log('📤 GitHub Release 파일 업로드');
    console.log('===========================================');
    console.log(`Repository: ${OWNER}/${REPO}`);
    console.log(`Version: ${VERSION}`);
    console.log(`Tag: ${TAG}`);
    console.log('');
    
    // 1. 기존 Release 정보 가져오기
    console.log('1️⃣  기존 Release 정보 가져오기...');
    const releasesResponse = await axios.get(
      `https://api.github.com/repos/${OWNER}/${REPO}/releases`,
      {
        headers: {
          'Authorization': `token ${GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      }
    );
    
    // Draft 릴리즈도 포함하여 찾기
    let release = releasesResponse.data.find(r => r.tag_name === TAG);
    
    // Draft 릴리즈가 있으면 그것을 사용
    if (!release) {
      release = releasesResponse.data.find(r => r.draft === true && r.tag_name === TAG);
    }
    
    // 태그가 없지만 이름에 버전이 있는 경우도 확인
    if (!release) {
      release = releasesResponse.data.find(r => r.name && r.name.includes(VERSION));
    }
    
    if (!release) {
      console.error(`❌ ${TAG} 릴리즈를 찾을 수 없습니다.`);
      console.error('사용 가능한 릴리즈:');
      releasesResponse.data.slice(0, 5).forEach(r => {
        console.error(`   - ${r.tag_name || 'no tag'} (${r.draft ? 'Draft' : 'Published'}): ${r.name}`);
      });
      return;
    }
    
    console.log(`✅ Release 발견 (ID: ${release.id})`);
    console.log(`   URL: ${release.html_url}`);
    console.log('');
    
    // 2. 업로드할 파일 목록
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
    
    const uploadUrl = release.upload_url.replace('{?name,label}', '');
    
    // 3. 파일 업로드
    console.log('2️⃣  파일 업로드 중...');
    for (const file of filesToUpload) {
      if (!fs.existsSync(file.path)) {
        console.log(`⚠️  파일 없음: ${file.path}`);
        continue;
      }
      
      // 기존 파일이 있으면 삭제
      const existingAsset = release.assets.find(asset => asset.name === file.name);
      if (existingAsset) {
        console.log(`   기존 파일 삭제: ${file.name}`);
        await axios.delete(
          `https://api.github.com/repos/${OWNER}/${REPO}/releases/assets/${existingAsset.id}`,
          {
            headers: {
              'Authorization': `token ${GITHUB_TOKEN}`,
              'Accept': 'application/vnd.github.v3+json'
            }
          }
        );
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
    console.log('✅ 파일 업로드 완료!');
    console.log('===========================================');
    console.log('');
    console.log('🔗 Release URL:');
    console.log(`   ${release.html_url}`);
    console.log('');
    console.log('💡 이제 자동 업데이트가 정상 작동할 것입니다!');
    console.log('');
    
  } catch (error) {
    console.error('');
    console.error('❌ 파일 업로드 실패:', error.message);
    if (error.response) {
      console.error('상태 코드:', error.response.status);
      console.error('응답 데이터:', JSON.stringify(error.response.data, null, 2));
    }
    process.exit(1);
  }
}

uploadReleaseFiles();

