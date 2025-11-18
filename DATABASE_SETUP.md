# 데이터베이스 스키마 업데이트 가이드

회원가입 기능을 사용하려면 `pharmacies` 테이블에 `username`과 `password_hash` 컬럼을 추가해야 합니다.

## Supabase에서 스키마 업데이트

1. Supabase 대시보드 접속: https://supabase.com/dashboard
2. 프로젝트 선택: `autosyrup-billing`
3. 왼쪽 메뉴에서 **"SQL Editor"** 클릭
4. **"New query"** 클릭
5. 아래 SQL 코드를 복사하여 실행:

```sql
-- pharmacies 테이블에 username과 password_hash 컬럼 추가
ALTER TABLE pharmacies ADD COLUMN IF NOT EXISTS username TEXT UNIQUE;
ALTER TABLE pharmacies ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- username에 인덱스 추가 (로그인 성능 향상)
CREATE INDEX IF NOT EXISTS idx_pharmacies_username ON pharmacies(username);

-- 확인 쿼리
SELECT id, username, name, ykiin, status, created_at FROM pharmacies ORDER BY created_at DESC;
```

## 실행 결과 확인

실행 후 "Success. No rows returned" 메시지가 나오면 성공입니다.

## 기존 데이터가 있는 경우

기존에 등록된 약국 데이터가 있다면:
- `username`과 `password_hash`는 NULL로 설정됩니다
- 새로운 회원가입만 ID/PW로 로그인 가능합니다
- 기존 데이터는 레거시 방식으로 관리할 수 있습니다

## 문제 해결

### 에러: "column does not exist"
- SQL이 제대로 실행되지 않았을 수 있습니다
- 다시 한 번 SQL Editor에서 실행해보세요

### 에러: "duplicate key value violates unique constraint"
- `username` 컬럼에 UNIQUE 제약조건이 이미 있는 경우
- 이는 정상입니다. 이미 컬럼이 추가된 것입니다

