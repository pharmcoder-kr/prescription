-- device_logs 테이블: 약국에서 "문제사항 보내기" 시 ESP32 로그 저장
CREATE TABLE IF NOT EXISTS device_logs (
  id BIGSERIAL PRIMARY KEY,
  username TEXT,                    -- 약국 로그인 ID
  pharmacy_name TEXT,               -- 약국명
  pharmacy_ykiin TEXT,              -- 요양기관번호
  device_uid TEXT,                  -- PC 고유 ID
  mac TEXT NOT NULL,                -- ESP32 MAC 주소
  ip TEXT,                          -- ESP32 IP 주소
  nickname TEXT,                    -- 기기 별명 (약품명)
  firmware_version TEXT,            -- ESP32 펌웨어 버전
  firmware_model TEXT,              -- ESP32 모델 (loadcell/hospital/basic)
  hmi_version TEXT,                 -- HMI LCD 버전
  log_text TEXT NOT NULL,           -- ESP32 로그 내용
  app_version TEXT,                 -- 오토시럽 앱 버전
  platform TEXT,                    -- OS (win32 등)
  reported_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_device_logs_reported_at ON device_logs(reported_at DESC);
CREATE INDEX IF NOT EXISTS idx_device_logs_mac ON device_logs(mac);
CREATE INDEX IF NOT EXISTS idx_device_logs_pharmacy ON device_logs(pharmacy_ykiin);

-- RLS 비활성화 (서버측 service key로만 접근)
ALTER TABLE device_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON device_logs FOR ALL USING (true) WITH CHECK (true);
