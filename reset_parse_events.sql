-- 파싱 이벤트 데이터 초기화 스크립트
-- Supabase SQL Editor에서 실행하세요

-- 1. parse_events 테이블의 모든 데이터 삭제
DELETE FROM parse_events;

-- 2. monthly_usage 뷰가 있다면 확인 (자동으로 0이 될 것)
-- 뷰는 실제 테이블이므로 데이터가 없으면 자동으로 0개로 표시됩니다.

-- 3. 삭제된 행 수 확인
SELECT 'parse_events 테이블이 초기화되었습니다.' as message;

-- 4. 현재 상태 확인
SELECT 
    COUNT(*) as remaining_events,
    '남은 파싱 이벤트 수' as description
FROM parse_events;
