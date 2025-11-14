const axios = require('axios');

async function checkRelease() {
  try {
    console.log('===========================================');
    console.log('🔍 GitHub Release 확인');
    console.log('===========================================');
    
    // Release 정보 가져오기
    const response = await axios.get('https://api.github.com/repos/pharmcoder-kr/prescription/releases');
    const releases = response.data;
    
    console.log(`총 ${releases.length}개의 릴리즈가 있습니다.`);
    console.log('');
    
    // v1.3.1 릴리즈 찾기
    const release131 = releases.find(r => r.tag_name === 'v1.3.1');
    
    if (!release131) {
      console.log('❌ v1.3.1 릴리즈를 찾을 수 없습니다.');
      return;
    }
    
    console.log('✅ v1.3.1 릴리즈 발견!');
    console.log(`   제목: ${release131.name}`);
    console.log(`   상태: ${release131.draft ? 'Draft' : 'Published'}`);
    console.log(`   생성일: ${release131.created_at}`);
    console.log(`   발행일: ${release131.published_at || '미발행'}`);
    console.log('');
    
    console.log('📁 첨부된 파일들:');
    release131.assets.forEach((asset, index) => {
      console.log(`   ${index + 1}. ${asset.name}`);
      console.log(`      크기: ${(asset.size / 1024 / 1024).toFixed(2)} MB`);
      console.log(`      다운로드 URL: ${asset.browser_download_url}`);
      console.log('');
    });
    
    // 다운로드 URL 테스트
    console.log('🔗 다운로드 URL 테스트:');
    for (const asset of release131.assets) {
      if (asset.name.includes('auto-syrup-setup-1.3.1.exe')) {
        try {
          const downloadResponse = await axios.head(asset.browser_download_url);
          console.log(`   ✅ ${asset.name}: ${downloadResponse.status} OK`);
        } catch (error) {
          console.log(`   ❌ ${asset.name}: ${error.response?.status || error.message}`);
        }
      }
    }
    
  } catch (error) {
    console.error('❌ 오류 발생:', error.message);
  }
}

checkRelease();

