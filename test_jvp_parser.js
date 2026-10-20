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
    // 규칙: 떨어진 숫자=일수, 다음 숫자 첫자리=횟수, 나머지=1회량 ("4  35" → 1회량 5 / 3회 / 4일)
    assert(setofen && setofen.volume === 5 && setofen.daily === 3 && setofen.period === 4, `세토펜 5/3/4 (실제 ${setofen && `${setofen.volume}/${setofen.daily}/${setofen.period}`})`);
    const last = r.medicines[r.medicines.length - 1];
    assert(last.volume === 123 && last.daily === 3 && last.period === 11, `마지막 123/3/11 (실제 ${last.volume}/${last.daily}/${last.period})`);
    assert(last.total === 123 * 3 * 11, '총량 계산');
}
{
    const fp = path.join(base, '20261020000011.txt');
    const { content } = decodeKoreanPrescriptionText(fs.readFileSync(fp));
    const r = parseJvpPrescriptionContent(content, fp, '20261020000011');
    assert(r.medicines.length === 2, '파일11 약품 2건');
    assert(r.medicines[0].volume === 10 && r.medicines[0].daily === 3 && r.medicines[0].period === 12, `파일11 첫약품 10/3/12 (실제 ${r.medicines[0].volume}/${r.medicines[0].daily}/${r.medicines[0].period})`);
    assert(r.medicines[1].volume === 15 && r.medicines[1].daily === 3 && r.medicines[1].period === 123, `파일11 둘째 15/3/123 (실제 ${r.medicines[1].volume}/${r.medicines[1].daily}/${r.medicines[1].period})`);
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
    // 용량 함수 단독 검증 (처방일수 우선 규칙)
    const d0 = parseJvpDoseText('5  35');
    assert(d0.volume === 5 && d0.daily === 3 && d0.period === 5, '정수형 5(1회량)/3/5(일수)');
    const d = parseJvpDoseText('11 3123');
    assert(d.volume === 123 && d.daily === 3 && d.period === 11, '정수형 123/3/11');
    const d2 = parseJvpDoseText('123315');
    assert(d2.volume === 15 && d2.daily === 3 && d2.period === 123, '붙은 정수형 15/3/123');
    // 사용자 제공 정소라 예시 (정수/소수 공통 규칙)
    const cases = [
        ['3  21.5', 1.5, 2, 3], ['6  54', 4, 5, 6], ['9  87.5', 7.5, 8, 9],
        ['3  21', 1, 2, 3], ['9  87', 7, 8, 9],
    ];
    for (const [text, vol, daily, period] of cases) {
        const parsedDose = parseJvpDoseText(text);
        assert(parsedDose && parsedDose.volume === vol && parsedDose.daily === daily && parsedDose.period === period,
            `용량 "${text}" 기대 ${vol}/${daily}/${period} (실제 ${parsedDose ? `${parsedDose.volume}/${parsedDose.daily}/${parsedDose.period}` : 'null'})`);
    }
}

// 정소라 예시 전체 파일 검증 (소수 포함 / 정수만)
{
    const mk = (doseTexts) => {
        const names = ['암브로콜시럽_(1000mL)', '비알코에이시럽_(500mL)', '세토펜현탁액(아세트아미노펜)_(16g'];
        const codes = ['E643501834', 'E670500661', 'E645700891'];
        const body = codes.map((code, i) => {
            const namePad = 60 - iconv.encode(names[i], 'cp949').length;
            return `${code}${' '.repeat(6)}${names[i]}${' '.repeat(Math.max(0, namePad))}${doseTexts[i]}${' '.repeat(30)}`;
        }).join('');
        const header = ['10000000002', '16', '40', '2026102019:298605282111111', '19860528', '정소라', '2', '54981245', '54358'].join(' '.repeat(10));
        return `|JVPHEAD|${header}|JVPEND||JVMHEAD|  ${body}|JVMEND|`;
    };
    const expect = [[1.5, 2, 3], [4, 5, 6], [7.5, 8, 9]];
    const r1 = parseJvpPrescriptionContent(mk(['3  21.5', '6  54', '9  87.5']), 'synthetic_sora_decimal.txt', '20261020000101');
    assert(r1 && r1.patient.name === '정소라' && r1.medicines.length === 3, '정소라(소수) 환자/약품수');
    const expectInt = [[1, 2, 3], [4, 5, 6], [7, 8, 9]];
    const r2 = parseJvpPrescriptionContent(mk(['3  21', '6  54', '9  87']), 'synthetic_sora_int.txt', '20261020000102');
    assert(r2 && r2.medicines.length === 3, '정소라(정수) 약품수');
    [[r1, expect], [r2, expectInt]].forEach(([r, exp]) => {
        if (!r) return;
        exp.forEach(([vol, daily, period], i) => {
            const m = r.medicines[i];
            assert(m.volume === vol && m.daily === daily && m.period === period,
                `정소라 약품${i + 1} 기대 ${vol}/${daily}/${period} (실제 ${m.volume}/${m.daily}/${m.period})`);
        });
    });
}

console.log(failed === 0 ? '\nALL TESTS PASSED' : `\n${failed} FAILURES`);
process.exit(failed === 0 ? 0 : 1);
