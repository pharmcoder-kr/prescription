-- pharmacies 테이블에 username과 password_hash 컬럼 추가
ALTER TABLE pharmacies ADD COLUMN IF NOT EXISTS username TEXT UNIQUE;
ALTER TABLE pharmacies ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- username에 인덱스 추가 (로그인 성능 향상)
CREATE INDEX IF NOT EXISTS idx_pharmacies_username ON pharmacies(username);

-- 확인 쿼리
SELECT id, username, name, ykiin, status, created_at FROM pharmacies ORDER BY created_at DESC;

