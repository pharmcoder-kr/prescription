// 이팜 DAT 파서 스모크 테스트
const fs = require('fs');
const path = require('path');
const iconv = require('iconv-lite');
const moment = require('moment');

const src = fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8');

function sliceFn(name, endMarker) {
    const start = src.indexOf(name);
    if (start < 0) throw new Error(`not found: ${name}`);
    const end = endMarker ? src.indexOf(endMarker, start + 1) : src.length;
    if (end < 0) throw new Error(`end not found for ${name}`);
    return src.slice(start, end);
}

function logMessage(msg) { console.log('[log]', msg); }
function getRegisteredMedicineName() { return ''; }

eval(sliceFn('function decodeKoreanPrescriptionText(', '// 전역 변수'));
eval(sliceFn('function isEpharmDatPrescriptionContent(', '/** JVP(|JVPHEAD|'));

const samples = [
    {
        file: r('00065.dat'),
        expect: {
            name: '정다인',
            receipt: '2026111300065',
            meds: [
                ['678602150', 1, 2, 4, 8],
                ['671803380', 1, 2, 4, 8],
                ['671702030', 1, 2, 4, 8],
            ]
        }
    },
    {
        file: r('00066.dat'),
        expect: {
            name: '한유민',
            receipt: '2026111300066',
            meds: [
                ['678602150', 0.5, 3, 4, 6],
                ['643900710', 0.5, 3, 4, 6],
                ['656004740', 0.5, 3, 4, 6],
                ['670300190', 1, 3, 4, 12],
            ]
        }
    },
    {
        file: r('00067.dat'),
        expect: {
            name: '김명서',
            receipt: '2026111300067',
            meds: [
                ['671803380', 0.5, 2, 5, 5],
                ['643900710', 0.5, 2, 5, 5],
                ['670303991', 0.5, 2, 5, 5],
                ['670300182', 3, 2, 5, 30],
            ]
        }
    },
];

function r(name) {
    return path.join('c:\\Users\\lhjlh\\OneDrive\\문서\\카카오톡 받은 파일', name);
}

let failed = 0;
for (const s of samples) {
    const buf = fs.readFileSync(s.file);
    const { content, encoding } = decodeKoreanPrescriptionText(buf);
    console.log(`\n=== ${path.basename(s.file)} enc=${encoding} isDat=${isEpharmDatPrescriptionContent(content)} ===`);
    const parsed = parseEpharmDatPrescriptionContent(content, s.file, path.basename(s.file, '.dat'));
    if (!parsed) {
        console.log('FAIL: parsed null');
        failed++;
        continue;
    }
    const checks = [
        [parsed.patient.name === s.expect.name, `name ${parsed.patient.name}`],
        [parsed.patient.receipt_number === s.expect.receipt, `receipt ${parsed.patient.receipt_number}`],
        [parsed.patient.receipt_date === '2026-11-13', `date ${parsed.patient.receipt_date}`],
        [parsed.medicines.length === s.expect.meds.length, `med count ${parsed.medicines.length}`],
    ];
    s.expect.meds.forEach((exp, i) => {
        const m = parsed.medicines[i];
        const ok = m
            && m.pill_code === exp[0]
            && m.volume === exp[1]
            && m.daily === exp[2]
            && m.period === exp[3]
            && m.total === exp[4];
        checks.push([ok, `med${i + 1} ${m ? `${m.pill_code} ${m.volume}x${m.daily}x${m.period}=${m.total}` : 'missing'}`]);
    });
    for (const [ok, msg] of checks) {
        console.log(`${ok ? 'OK' : 'FAIL'} ${msg}`);
        if (!ok) failed++;
    }
}

console.log(failed ? `\nFAILED ${failed}` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
