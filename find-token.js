const keytar = require('keytar');

async function findToken() {
  console.log('===========================================');
  console.log('🔍 모든 가능한 토큰 위치 확인');
  console.log('===========================================');
  console.log('');
  
  const possibleCombinations = [
    { service: 'AutoSyrupLink', account: 'device-token' },
    { service: 'auto-syrup', account: 'auth-token' },
    { service: 'AutoSyrup', account: 'auth-token' },
    { service: 'auto-syrup-link', account: 'device-token' },
  ];
  
  let found = false;
  
  for (const combo of possibleCombinations) {
    try {
      const token = await keytar.getPassword(combo.service, combo.account);
      
      if (token) {
        console.log(`✅ 토큰 발견!`);
        console.log(`   서비스명: ${combo.service}`);
        console.log(`   계정명: ${combo.account}`);
        console.log(`   토큰 길이: ${token.length}자`);
        console.log('');
        
        // 토큰 디코딩은 생략
        
        console.log('');
        found = true;
      }
    } catch (error) {
      // 무시
    }
  }
  
  if (!found) {
    console.log('❌ 어떤 위치에서도 토큰을 찾을 수 없습니다.');
    console.log('');
    console.log('💡 이는 다음을 의미합니다:');
    console.log('   1. 실제로 토큰이 저장되지 않았음');
    console.log('   2. 약국 등록을 처음부터 다시 해야 함');
  }
  
  console.log('===========================================');
}

findToken();

