-- pharmacies 테이블에 status 컬럼 추가
ALTER TABLE pharmacies ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';

-- 기존 레코드의 status를 'active'로 설정 (이미 등록된 약국들)
UPDATE pharmacies SET status = 'active' WHERE status IS NULL;

-- pharmacy_approvals 테이블 생성 (승인 이력 기록용)
CREATE TABLE IF NOT EXISTS pharmacy_approvals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pharmacy_id UUID REFERENCES pharmacies(id) ON DELETE CASCADE,
    previous_status TEXT,
    new_status TEXT NOT NULL,
    approved_by TEXT, -- 관리자 식별자 (예: 이메일)
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 인덱스 추가
CREATE INDEX IF NOT EXISTS idx_pharmacies_status ON pharmacies(status);
CREATE INDEX IF NOT EXISTS idx_pharmacy_approvals_pharmacy_id ON pharmacy_approvals(pharmacy_id);

-- 확인 쿼리
SELECT id, ykiin, name, status, created_at FROM pharmacies ORDER BY created_at DESC;
