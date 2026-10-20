// renderer.js에서 JVP 관련 함수만 추출해 실제 샘플 파일로 검증하는 테스트 하네스
const fs = require('fs');
const path = require('path');
const iconv = require('iconv-lite');
const moment = require('moment');

const src = fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8');

function extract(name) {
    const start = src.indexOf(`function ${name}(`);
    if (start < 0) throw new Error(`function not found: ${name}`);
    // 다음 최상위 function 앞까지를 대략 추출 (JVP 블록은 연속 배치)
    return start;
}

// decode + dose helpers + JVP 블록을 통째로 가져온다
const decodeStart = src.indexOf('function decodeKoreanPrescriptionText(');
const listStart = src.indexOf('function listPrescriptionFilesInPath()');
if (decodeStart < 0 || listStart < 0) throw new Error('slice markers not found');
const headerBlock = src.slice(decodeStart, src.indexOf('// 전역 변수', decodeStart));

const doseStart = src.indexOf('function parseDoseNumber(');
const withoutStart = src.indexOf('function parsePrescriptionFileWithoutEvent(');
if (doseStart < 0 || withoutStart < 0) throw new Error('dose markers not found');
const doseBlock = src.slice(doseStart, withoutStart);

const jvpStart = src.indexOf('/** JVP(|JVPHEAD|');
if (jvpStart < 0) throw new Error('jvp marker not found');
const jvpBlock = src.slice(jvpStart, listStart);

function logMessage(msg) { console.log('[log]', msg); }

eval(headerBlock);
eval(doseBlock);
eval(jvpBlock);

const samples = [
    '20261020000013.txt',
    '20261020000011.txt',
    '20261020000016.txt',
];
const base = 'C:\\Users\\lhjlh\\OneDrive\\문서\\ATC TEST';

let failed = 0;
for (const name of samples) {
    const filePath = path.join(base, name);
    const buffer = fs.readFileSync(filePath);
    const { content, encoding } = decodeKoreanPrescriptionText(buffer);
    const receiptNumber = path.basename(filePath, '.txt');
    console.log(`\n=== ${name} (encoding=${encoding}, isJvp=${isJvpPrescriptionContent(content)}) ===`);
    const parsed = parseJvpPrescriptionContent(content, filePath, receiptNumber);
    if (!parsed) { console.log('PARSE FAILED'); failed++; continue; }
    // 주민번호는 검증 출력에서 마스킹
    const p = { ...parsed.patient, resident_number: parsed.patient.resident_number ? '***마스킹***' : '' };
    console.log(JSON.stringify(p, null, 2));
    for (const m of parsed.medicines) {
        console.log(` - ${m.pill_code} | ${m.pill_name} | 1회량=${m.volume} 횟수=${m.daily} 일수=${m.period} 총량=${m.total}`);
    }
}

// 기대값 검증 (사용자 설명 기준)
function assert(cond, msg) {
    if (!cond) { console.log('ASSERT FAIL:', msg); failed++; }
}
{
    const fp = path.join(base, '20261020000013.txt');
    const { content } = decodeKoreanPrescriptionText(fs.readFileSync(fp));
    const r = parseJvpPrescriptionContent(content, fp, '20261020000013');
    assert(r.patient.name === '이학준', '환자명 이학준');
    assert(r.patient.age === 40, '만나이 40');
    assert(r.patient.receipt_time === '2026-10-20 17:45:00', `접수시간 ${r.patient.receipt_time}`);
    assert(r.patient.birth_date === '1986-05-28', '생년월일');
    assert(r.patient.institution_number === '54981245', '요양기관번호');
    assert(r.patient.doctor_code === '54358', '의사번호');
    assert(r.medicines.length === 4, `약품 4건 (실제 ${r.medicines.length})`);
    const setofen = r.medicines.find(m => m.pill_code === '645700890');
    assert(setofen && setofen.volume === 4 && setofen.daily === 3 && setofen.period === 5, '세토펜 4/3/5');
    const last = r.medicines[r.medicines.length - 1];
    assert(last.volume === 11 && last.daily === 3 && last.period === 123, `마지막 11/3/123 (실제 ${last.volume}/${last.daily}/${last.period})`);
    assert(last.total === 11 * 3 * 123, '총량 계산');
}
{
    const fp = path.join(base, '20261020000011.txt');
    const { content } = decodeKoreanPrescriptionText(fs.readFileSync(fp));
    const r = parseJvpPrescriptionContent(content, fp, '20261020000011');
    assert(r.medicines.length === 2, '파일11 약품 2건');
    assert(r.medicines[0].volume === 12 && r.medicines[0].daily === 3 && r.medicines[0].period === 10, `파일11 첫약품 12/3/10 (실제 ${r.medicines[0].volume}/${r.medicines[0].daily}/${r.medicines[0].period})`);
    assert(r.medicines[1].volume === 123 && r.medicines[1].daily === 3 && r.medicines[1].period === 15, `파일11 둘째 123/3/15 (실제 ${r.medicines[1].volume}/${r.medicines[1].daily}/${r.medicines[1].period})`);
}

// 소수점 포함 처방 (사용자 제공 예시) — 합성 JVP 파일로 전체 파싱 검증
{
    const drugs = [
        // [코드(알파벳+9자리), 약품명, 용량문자열, 기대 1회량, 기대 횟수, 기대 일수]
        ['E670500661', '비알코에이시럽_(500mL)', '5  25.5', 5.5, 2, 5],
        ['E643501834', '암브로콜시럽_(1000mL)', '5  26.5', 6.5, 2, 5],
        ['T672300240', '타이레놀8시간이알서방정(아세트아미노펜', '3  31.25', 1.25, 3, 3],
        ['E645700891', '세토펜현탁액(아세트아미노펜)_(16g', '6  37.5', 7.5, 3, 6],
    ];
    const body = drugs.map(([code, drugName, doseText]) => {
        const namePad = 60 - iconv.encode(drugName, 'cp949').length;
        return `${code}${' '.repeat(6)}${drugName}${' '.repeat(Math.max(0, namePad))}${doseText}${' '.repeat(30)}`;
    }).join('');
    const header = [
        '10000000003', '12', '40', '2026102019:098607191234567', '19860719',
        '테스트', '1', '54981245', '54358',
    ].join(' '.repeat(10));
    const content = `|JVPHEAD|${header}|JVPEND||JVMHEAD|  ${body}|JVMEND|`;
    const r = parseJvpPrescriptionContent(content, 'synthetic_decimal.txt', '20261020000099');
    assert(!!r, '소수 합성 파일 파싱 성공');
    if (r) {
        assert(r.medicines.length === 4, `소수 약품 4건 (실제 ${r.medicines.length})`);
        drugs.forEach(([code, , , vol, daily, period], i) => {
            const m = r.medicines[i];
            const ok = m && m.pill_code === code.slice(1) && m.volume === vol && m.daily === daily && m.period === period
                && m.total === Math.round(vol * daily * period * 1000) / 1000;
            assert(ok, `소수 약품${i + 1} ${code} 기대 ${vol}/${daily}/${period} (실제 ${m ? `${m.volume}/${m.daily}/${m.period} 총량=${m.total}` : '없음'})`);
        });
    }
    // 용량 함수 단독 검증
    assert(parseJvpDoseText('5  35').volume === 5, '정수형 유지 5/3/5');
    const d = parseJvpDoseText('11 3123');
    assert(d.volume === 11 && d.daily === 3 && d.period === 123, '정수형 유지 11/3/123');
    const d2 = parseJvpDoseText('123315');
    assert(d2.volume === 123 && d2.daily === 3 && d2.period === 15, '붙은 정수형 유지 123/3/15');
}

console.log(failed === 0 ? '\nALL TESTS PASSED' : `\n${failed} FAILURES`);
process.exit(failed === 0 ? 0 : 1);
