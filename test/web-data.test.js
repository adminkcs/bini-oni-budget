// 정적 웹 시험판(web/sheets-data.js)이 서버 getDashboardData와 같은 데이터를 만드는지 검증
const fs = require('fs'), vm = require('vm'), path = require('path');
const { runner, OFF, pad } = require('./_stub');
const SheetsData = require('../web/sheets-data.js');
const r = runner();

const serial = (y, m, d) => Date.UTC(y, m - 1, d) / 86400000 + 25569;
const TXN_H = ['일련번호', '날짜', '대분류', '소분류', '내용', '금액', '결제수단', '비고', '입력자', '입력시각', '수정시각', '삭제여부', '_분류유효성_대분류', '_분류유효성_소분류'];
const values = {
  '가계부_내역': [TXN_H,
    ['a1', serial(2026, 10, 1), '생활', '외식', '점심', -9000, '카드', '', 'x@y', 46296.5, '', '', '', ''],
    ['a2', serial(2026, 10, 28) + 0.75, '보험', '휴대폰보험', '보험료', -990, '카드', '정기지출 자동입력#1'],
    ['a3', serial(2026, 9, 30), '생활', '식비', '삭제된 행', -100, '현금', '', '', '', '', 'Y'],
    [],
    ['a4', '2026-10-05', '생활', '쇼핑', '글자 날짜', -5000, '카드'],
    ['a5', '', '생활', '외식', '날짜 없음', -1, '카드'],
    ['   ', '  ', '', '', '', '', ''],
    ['', '', '', '', '', '', '', '', '', '', '', '', '', 'X']],
  '수입': [TXN_H, ['i1', serial(2026, 9, 21), '수입', '입금', '급여', 4980000, '계좌이체'], [], [], ['', '', '', '', '', '', '', '', '', '', '', '', '', '']],
  '분류_설정': [['대분류', '소분류', '설명', '노출여부', '우선순위'], ['생활', '외식', '식당', 'Y', 100], [], ['보험', '건강/생명', '', 'N', 200]],
  '예산_설정': [['년월', '대분류', '예산액', ''], [serial(2026, 10, 1), '생활', 1250000, '메모'], ['2026-09', '교육', 1300000], []],
  '정기_수입지출_설정_및_휴일기준': [['일련번호', '항목명', '구분', '소분류', '지정일'], ['r1', '월급', '수입', '입금', 1], ['r2', '보험', '지출', '  ', 2], ['r3', '구독', '지출', '구독', 4]]
};

function loadServer(sheetTz) {
  const Utilities = {
    formatDate(date, tz, fmt) {
      const off = OFF[tz]; const s = new Date(date.getTime() + off * 60000);
      if (fmt === 'Z') return (off < 0 ? '-' : '+') + pad(Math.floor(Math.abs(off) / 60)) + pad(Math.abs(off) % 60);
      return `${s.getUTCFullYear()}-${pad(s.getUTCMonth() + 1)}-${pad(s.getUTCDate())}`;
    }
  };
  const order = ['가계부_내역', '수입', '분류_설정', '예산_설정', '정기_수입지출_설정_및_휴일기준'];
  const ctx = {
    Utilities, console, Logger: { log() {} },
    Session: { getActiveUser: () => ({ getEmail: () => 'me@example.com' }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => '["me@example.com"]' }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getId: () => 'sid', getSpreadsheetTimeZone: () => sheetTz }) },
    Sheets: { Spreadsheets: { Values: { batchGet: () => ({ valueRanges: order.map(n => ({ values: values[n] })) }) } } },
    LockService: {}, DriveApp: {}, ScriptApp: {}
  };
  vm.createContext(ctx);
  for (const f of ['Code.js', 'Dashboard.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx);
  return ctx;
}

console.log('=== 서버 getDashboardData와 시험판 toDashboardData 동일성 ===');
const web = JSON.stringify(SheetsData.toDashboardData(values));
for (const tz of ['Asia/Seoul', 'America/Los_Angeles']) {
  const server = JSON.stringify(loadServer(tz).getDashboardData());
  r.check(`시트 TZ ${tz}: 결과 JSON 일치`, server === web, true);
  if (server !== web) { console.log(' 서버:', server); console.log(' 웹  :', web); }
}

console.log('\n=== 변환 규칙 ===');
const d = SheetsData.toDashboardData(values);
r.check('지출: 삭제·빈 행·날짜 없는 행 제외 → 3건', d['가계부_내역'].length, 3);
r.check('일련번호 날짜 → 문자열', d['가계부_내역'][0].날짜, '2026-10-01');
r.check('소수부(시각) 버림', d['가계부_내역'][1].날짜, '2026-10-28');
r.check('글자 날짜는 그대로', d['가계부_내역'][2].날짜, '2026-10-05');
r.check('A~H만 전달(입력자 없음)', '입력자' in d['가계부_내역'][0], false);
r.check('수입: 빈 행 제외 → 1건', d['수입'].length, 1);
r.check('예산 년월 일련번호 변환', d['예산_설정'][0].년월, '2026-10-01');
r.check('정기 소분류(공백 제외)', d['_정기소분류'].join(','), '입금,구독');
r.check('batchGet 범위 순서', SheetsData.RANGES.join('|'), "'가계부_내역'|'수입'|'분류_설정'|'예산_설정'|'정기_수입지출_설정_및_휴일기준'");

r.done();
