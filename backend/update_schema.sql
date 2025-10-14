-- 약국 상태에 pending 추가
ALTER TABLE pharmacies 
ADD COLUMN status TEXT DEFAULT 'pending';

-- 기존 데이터는 active로 설정
UPDATE pharmacies SET status = 'active' WHERE status IS NULL;

-- 상태별 인덱스 추가
CREATE INDEX idx_pharmacies_status ON pharmacies(status);

-- 관리자 승인 로그 테이블 추가
CREATE TABLE pharmacy_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID REFERENCES pharmacies(id) ON DELETE CASCADE,
  approved_by TEXT, -- 관리자 ID 또는 이메일
  approved_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT NOT NULL, -- 'approved', 'rejected'
  reason TEXT, -- 승인/거부 사유
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 승인 로그 인덱스
CREATE INDEX idx_pharmacy_approvals_pharmacy_id ON pharmacy_approvals(pharmacy_id);
CREATE INDEX idx_pharmacy_approvals_status ON pharmacy_approvals(status);
