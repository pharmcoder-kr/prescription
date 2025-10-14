const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const path = require('path');
require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// Supabase 클라이언트 초기화
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY // 서버에서만 사용, 절대 클라이언트 노출 금지
);

// JWT 시크릿 키 (환경 변수에서 읽기)
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');

// 미들웨어
app.use(cors());
app.use(express.json());

// 관리자 페이지 라우트
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// 요청 로깅 미들웨어
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ============================================
// 인증 미들웨어
// ============================================
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: '인증 토큰이 필요합니다.' });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ error: '유효하지 않은 토큰입니다.' });
    }
    req.user = decoded; // { pharmacy_id, device_id, device_uid }
    next();
  });
}

// ============================================
// API 엔드포인트
// ============================================

// 헬스 체크
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: '오토시럽 백엔드 API 서버',
    version: '1.0.0'
  });
});

// 약국 등록 (Enrollment)
app.post('/v1/auth/enroll', async (req, res) => {
  try {
    const { ykiin, biz_no, name, contact_email, device } = req.body;

    // 필수 필드 검증
    if (!ykiin || !biz_no || !name || !device || !device.device_uid) {
      return res.status(400).json({ 
        error: '필수 정보가 누락되었습니다.',
        required: ['ykiin', 'biz_no', 'name', 'device.device_uid']
      });
    }

    // 1. 약국 정보 upsert (요양기관번호 기준) - 기본 상태는 pending
    const { data: pharmacy, error: pharmacyError } = await supabase
      .from('pharmacies')
      .upsert(
        {
          ykiin: ykiin.trim(),
          biz_no: biz_no.trim(),
          name: name.trim(),
          contact_email: contact_email?.trim() || null,
          status: 'pending', // 기본 상태는 승인 대기
          last_seen_at: new Date().toISOString()
        },
        { onConflict: 'ykiin' }
      )
      .select()
      .single();

    if (pharmacyError) {
      console.error('약국 등록 오류:', pharmacyError);
      return res.status(500).json({ error: '약국 정보 저장 중 오류가 발생했습니다.' });
    }

    // 2. 기기 정보 upsert (device_uid 기준)
    const { data: deviceData, error: deviceError } = await supabase
      .from('devices')
      .upsert(
        {
          pharmacy_id: pharmacy.id,
          device_uid: device.device_uid,
          platform: device.platform || 'unknown',
          app_version: device.app_version || '1.0.0',
          last_seen_at: new Date().toISOString()
        },
        { onConflict: 'device_uid' }
      )
      .select()
      .single();

    if (deviceError) {
      console.error('기기 등록 오류:', deviceError);
      return res.status(500).json({ error: '기기 정보 저장 중 오류가 발생했습니다.' });
    }

    // 3. JWT 토큰 발급 (1년 만료)
    const token = jwt.sign(
      {
        pharmacy_id: pharmacy.id,
        device_id: deviceData.id,
        device_uid: device.device_uid,
        ykiin: pharmacy.ykiin,
        scope: 'device:event:write'
      },
      JWT_SECRET,
      { expiresIn: '365d' }
    );

    console.log(`✅ 약국 등록 완료 (승인 대기): ${name} (${ykiin})`);

    res.status(200).json({
      success: true,
      access_token: token,
      pharmacy: {
        id: pharmacy.id,
        name: pharmacy.name,
        ykiin: pharmacy.ykiin,
        status: pharmacy.status
      },
      message: '등록이 완료되었습니다. 관리자 승인 후 사용 가능합니다.'
    });

  } catch (error) {
    console.error('등록 처리 중 오류:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 파싱 이벤트 기록
app.post('/v1/events/parse', authenticateToken, async (req, res) => {
  try {
    const { source, count, idempotency_key, ts } = req.body;
    const { pharmacy_id, device_id } = req.user;

    // 필수 필드 검증
    if (!idempotency_key) {
      return res.status(400).json({ 
        error: 'idempotency_key가 필요합니다.' 
      });
    }

    // 약국 승인 상태 확인
    const { data: pharmacy, error: pharmacyError } = await supabase
      .from('pharmacies')
      .select('status')
      .eq('id', pharmacy_id)
      .single();

    if (pharmacyError || !pharmacy) {
      return res.status(404).json({ error: '약국 정보를 찾을 수 없습니다.' });
    }

    if (pharmacy.status !== 'active') {
      return res.status(403).json({ 
        error: '관리자 승인이 필요합니다. 승인 후 사용 가능합니다.',
        status: pharmacy.status
      });
    }

    // 파싱 이벤트 저장
    const { data: event, error: eventError } = await supabase
      .from('parse_events')
      .insert({
        pharmacy_id,
        device_id,
        source: source || 'pharmIT3000',
        count: count || 1,
        idempotency_key,
        ts: ts || new Date().toISOString()
      })
      .select()
      .single();

    if (eventError) {
      // 중복 키 에러는 무시 (이미 기록된 이벤트)
      if (eventError.code === '23505') {
        console.log(`⚠️ 중복 이벤트 무시: ${idempotency_key}`);
        return res.status(200).json({ 
          success: true, 
          message: '이미 기록된 이벤트입니다.',
          duplicate: true
        });
      }
      console.error('이벤트 저장 오류:', eventError);
      return res.status(500).json({ error: '이벤트 저장 중 오류가 발생했습니다.' });
    }

    // 약국 last_seen_at 업데이트
    await supabase
      .from('pharmacies')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('id', pharmacy_id);

    console.log(`📥 파싱 이벤트 기록: pharmacy_id=${pharmacy_id}, count=${count || 1}`);

    res.status(200).json({
      success: true,
      event_id: event.id,
      message: '이벤트가 기록되었습니다.'
    });

  } catch (error) {
    console.error('이벤트 기록 중 오류:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 관리자 승인 API
app.post('/v1/admin/approve', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    if (adminKey !== ADMIN_API_KEY) {
      return res.status(401).json({ error: '관리자 권한이 필요합니다.' });
    }

    const { pharmacy_id, action, reason } = req.body; // action: 'approve' | 'reject'
    
    if (!pharmacy_id || !action) {
      return res.status(400).json({ 
        error: 'pharmacy_id와 action이 필요합니다.' 
      });
    }

    const newStatus = action === 'approve' ? 'active' : 'rejected';
    
    // 약국 상태 업데이트
    const { data: pharmacy, error: pharmacyError } = await supabase
      .from('pharmacies')
      .update({ 
        status: newStatus,
        last_seen_at: new Date().toISOString()
      })
      .eq('id', pharmacy_id)
      .select()
      .single();

    if (pharmacyError) {
      return res.status(500).json({ error: '약국 상태 업데이트 실패' });
    }

    // 승인 로그 저장
    const { error: logError } = await supabase
      .from('pharmacy_approvals')
      .insert({
        pharmacy_id: pharmacy_id,
        approved_by: 'admin', // 실제로는 관리자 ID
        status: action,
        reason: reason || null
      });

    if (logError) {
      console.error('승인 로그 저장 실패:', logError);
    }

    console.log(`✅ 약국 ${action} 완료: ${pharmacy.name} (${pharmacy.ykiin})`);

    res.status(200).json({
      success: true,
      message: `약국이 ${action === 'approve' ? '승인' : '거부'}되었습니다.`,
      pharmacy: {
        id: pharmacy.id,
        name: pharmacy.name,
        ykiin: pharmacy.ykiin,
        status: pharmacy.status
      }
    });

  } catch (error) {
    console.error('승인 처리 중 오류:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 승인 대기 목록 조회
app.get('/v1/admin/pending', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    if (adminKey !== ADMIN_API_KEY) {
      return res.status(401).json({ error: '관리자 권한이 필요합니다.' });
    }

    const { data: pharmacies, error } = await supabase
      .from('pharmacies')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (error) {
      return res.status(500).json({ error: '승인 대기 목록 조회 실패' });
    }

    res.status(200).json({
      success: true,
      count: pharmacies.length,
      data: pharmacies
    });

  } catch (error) {
    console.error('승인 대기 목록 조회 중 오류:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 처리 완료 목록 조회 (승인/거부된 약국들)
app.get('/v1/admin/processed', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    if (adminKey !== ADMIN_API_KEY) {
      return res.status(401).json({ error: '관리자 권한이 필요합니다.' });
    }

    const { data: pharmacies, error } = await supabase
      .from('pharmacies')
      .select('*')
      .in('status', ['active', 'rejected'])
      .order('last_seen_at', { ascending: false });

    if (error) {
      return res.status(500).json({ error: '처리 완료 목록 조회 실패' });
    }

    res.status(200).json({
      success: true,
      count: pharmacies.length,
      data: pharmacies
    });

  } catch (error) {
    console.error('처리 완료 목록 조회 중 오류:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 통계 조회
app.get('/v1/admin/stats', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    if (adminKey !== ADMIN_API_KEY) {
      return res.status(401).json({ error: '관리자 권한이 필요합니다.' });
    }

    const { data: stats, error } = await supabase
      .from('pharmacies')
      .select('status');

    if (error) {
      return res.status(500).json({ error: '통계 조회 실패' });
    }

    const statsData = {
      total: stats.length,
      pending: stats.filter(p => p.status === 'pending').length,
      active: stats.filter(p => p.status === 'active').length,
      rejected: stats.filter(p => p.status === 'rejected').length
    };

    res.status(200).json({
      success: true,
      stats: statsData
    });

  } catch (error) {
    console.error('통계 조회 중 오류:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 토큰 검증 (앱에서 토큰 유효성 확인용)
app.get('/v1/auth/verify', authenticateToken, async (req, res) => {
  try {
    const { pharmacy_id } = req.user;

    // 약국 정보 조회
    const { data: pharmacy, error } = await supabase
      .from('pharmacies')
      .select('id, name, ykiin, status')
      .eq('id', pharmacy_id)
      .single();

    if (error || !pharmacy) {
      return res.status(404).json({ error: '약국 정보를 찾을 수 없습니다.' });
    }

    res.status(200).json({
      success: true,
      valid: true,
      pharmacy: {
        id: pharmacy.id,
        name: pharmacy.name,
        ykiin: pharmacy.ykiin,
        status: pharmacy.status
      }
    });

  } catch (error) {
    console.error('토큰 검증 중 오류:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// ============================================
// 관리자 API (별도 인증 필요)
// ============================================

// 관리자 인증 미들웨어
function authenticateAdmin(req, res, next) {
  const adminKey = req.headers['x-admin-key'];
  
  if (!adminKey || adminKey !== process.env.ADMIN_API_KEY) {
    return res.status(403).json({ error: '관리자 권한이 필요합니다.' });
  }
  
  next();
}

// 월간 사용량 조회 (관리자 전용)
app.get('/v1/admin/usage', authenticateAdmin, async (req, res) => {
  try {
    const { month } = req.query; // 예: 2025-10

    let query = supabase
      .from('monthly_usage')
      .select(`
        pharmacy_id,
        month,
        parse_count,
        first_seen,
        last_seen,
        pharmacies (
          ykiin,
          biz_no,
          name,
          contact_email
        )
      `)
      .order('month', { ascending: false });

    // 특정 월로 필터링
    if (month) {
      const monthDate = new Date(month + '-01');
      query = query.eq('month', monthDate.toISOString());
    }

    const { data, error } = await query;

    if (error) {
      console.error('사용량 조회 오류:', error);
      return res.status(500).json({ error: '사용량 조회 중 오류가 발생했습니다.' });
    }

    // 데이터 가공
    const usage = data.map(item => ({
      month: item.month,
      parse_count: item.parse_count,
      first_seen: item.first_seen,
      last_seen: item.last_seen,
      pharmacy: {
        ykiin: item.pharmacies.ykiin,
        biz_no: item.pharmacies.biz_no,
        name: item.pharmacies.name,
        contact_email: item.pharmacies.contact_email
      }
    }));

    console.log(`📊 사용량 조회: ${usage.length}개 약국`);

    res.status(200).json({
      success: true,
      count: usage.length,
      data: usage
    });

  } catch (error) {
    console.error('사용량 조회 중 오류:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 특정 약국의 사용량 조회 (관리자 전용)
app.get('/v1/admin/usage/:ykiin', authenticateAdmin, async (req, res) => {
  try {
    const { ykiin } = req.params;

    // 약국 정보 조회
    const { data: pharmacy, error: pharmacyError } = await supabase
      .from('pharmacies')
      .select('*')
      .eq('ykiin', ykiin)
      .single();

    if (pharmacyError || !pharmacy) {
      return res.status(404).json({ error: '약국을 찾을 수 없습니다.' });
    }

    // 월간 사용량 조회
    const { data: usage, error: usageError } = await supabase
      .from('monthly_usage')
      .select('*')
      .eq('pharmacy_id', pharmacy.id)
      .order('month', { ascending: false });

    if (usageError) {
      console.error('사용량 조회 오류:', usageError);
      return res.status(500).json({ error: '사용량 조회 중 오류가 발생했습니다.' });
    }

    res.status(200).json({
      success: true,
      pharmacy: {
        ykiin: pharmacy.ykiin,
        biz_no: pharmacy.biz_no,
        name: pharmacy.name,
        contact_email: pharmacy.contact_email,
        created_at: pharmacy.created_at,
        last_seen_at: pharmacy.last_seen_at
      },
      usage: usage.map(item => ({
        month: item.month,
        parse_count: item.parse_count,
        first_seen: item.first_seen,
        last_seen: item.last_seen
      }))
    });

  } catch (error) {
    console.error('사용량 조회 중 오류:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// ============================================
// 서버 시작
// ============================================
app.listen(PORT, () => {
  console.log('===========================================');
  console.log('🚀 오토시럽 백엔드 API 서버 시작');
  console.log(`📡 포트: ${PORT}`);
  console.log(`🌐 환경: ${process.env.NODE_ENV || 'development'}`);
  console.log('===========================================');
});

// 에러 핸들링
process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled Rejection:', error);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});

