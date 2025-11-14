const axios = require('axios');
const fs = require('fs');

const GITHUB_TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const OWNER = 'pharmcoder-kr';
const REPO = 'prescription';
const TAG = 'v1.3.1';

async function updateRelease() {
  if (!GITHUB_TOKEN) {
    console.error('❌ GitHub Token이 필요합니다!');
    process.exit(1);
  }

  try {
    console.log('===========================================');
    console.log('🔄 GitHub Release 업데이트');
    console.log('===========================================');
    
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
    
    const release = releasesResponse.data.find(r => r.tag_name === TAG);
    if (!release) {
      console.error(`❌ ${TAG} 릴리즈를 찾을 수 없습니다.`);
      return;
    }
    
    console.log(`✅ Release 발견 (ID: ${release.id})`);
    
    // 2. 기존 latest.yml 파일 삭제
    console.log('2️⃣  기존 latest.yml 파일 삭제...');
    const latestYmlAsset = release.assets.find(asset => asset.name === 'latest.yml');
    if (latestYmlAsset) {
      await axios.delete(
        `https://api.github.com/repos/${OWNER}/${REPO}/releases/assets/${latestYmlAsset.id}`,
        {
          headers: {
            'Authorization': `token ${GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github.v3+json'
          }
        }
      );
      console.log('✅ 기존 latest.yml 삭제 완료');
    }
    
    // 3. 새로운 latest.yml 업로드
    console.log('3️⃣  새로운 latest.yml 업로드...');
    const latestYmlData = fs.readFileSync('release/latest.yml');
    const uploadUrl = release.upload_url.replace('{?name,label}', '');
    
    await axios.post(
      `${uploadUrl}?name=latest.yml`,
      latestYmlData,
      {
        headers: {
          'Authorization': `token ${GITHUB_TOKEN}`,
          'Content-Type': 'text/yaml',
          'Content-Length': latestYmlData.length
        }
      }
    );
    
    console.log('✅ 새로운 latest.yml 업로드 완료');
    console.log('');
    console.log('===========================================');
    console.log('✅ Release 업데이트 완료!');
    console.log('===========================================');
    console.log('');
    console.log('🔗 Release URL:');
    console.log(`   ${release.html_url}`);
    console.log('');
    console.log('💡 이제 자동 업데이트가 정상 작동할 것입니다!');
    console.log('');
    
  } catch (error) {
    console.error('');
    console.error('❌ Release 업데이트 실패:', error.message);
    if (error.response) {
      console.error('상태 코드:', error.response.status);
      console.error('응답 데이터:', JSON.stringify(error.response.data, null, 2));
    }
    process.exit(1);
  }
}

updateRelease();

