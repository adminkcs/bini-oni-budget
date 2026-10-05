// 정기 자동입력 멱등성: 월간 일괄 등록 → 일간 실행, 지정일 변경, 비고 수정 시 중복이 생기지 않는지
// 가짜 시트 위에서 insertRegularExpensesForMonth / insertRegularExpenses를 실제로 돌린다.
const { loadCode, runner } = require('./_stub');
const r = runner();

const TXN_HEAD = ['일련번호', '날짜', '대분류', '소분류', '내용', '금액', '결제수단', '비고', '입력자', '입력시각', '수정시각', '삭제여부'];
const REG_HEAD = ['일련번호', '항목명', '구분', '소분류', '지정일', '금액', '결제수단'];

function fakeSheet(rows) {
  const data = rows;
  return {
    data,
    getLastRow: () => data.length,
    getLastColumn: () => data[0].length,
    getDataRange: () => ({ getValues: () => data.map(x => x.slice()) }),
    getRange: (row, col, nr = 1, nc = 1) => ({
      getValues: () => data.slice(row - 1, row - 1 + nr).map(x => x.slice(col - 1, col - 1 + nc)),
      setValues: v => v.forEach((vr, i) => { data[row - 1 + i] = data[row - 1 + i] || []; vr.forEach((c, j) => { data[row - 1 + i][col - 1 + j] = c; }); })
    })
  };
}

let uid = 0;
function setup(regRows) {
  const ctx = loadCode('Asia/Seoul');
  const sheets = {
    '가계부_내역': fakeSheet([TXN_HEAD.slice()]),
    '수입': fakeSheet([TXN_HEAD.slice()]),
    '정기_수입지출_설정_및_휴일기준': fakeSheet([REG_HEAD.slice()].concat(regRows)),
    '분류_설정': fakeSheet([['대분류', '소분류'], ['통신/구독', '통신']])
  };
  ctx.SpreadsheetApp = { getActiveSpreadsheet: () => ({ getSpreadsheetTimeZone: () => 'Asia/Seoul', getSheetByName: n => sheets[n] || null }), flush() {} };
  ctx.LockService = { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) };
  ctx.Utilities.getUuid = () => 'id-' + (++uid);
  // 시트 정렬·실행로그는 이 테스트의 관심사가 아니다
  ctx.sortRegularSheet = () => {};
  ctx.logRun = () => {};
  return { ctx, sheets };
}

const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
function runDay(ctx, dateStr) {
  const [y, m] = dateStr.split('-').map(Number);
  ctx.getTodayInfo = () => ctx.buildDayInfo(dateStr, lastDay(y, m));
  ctx.insertRegularExpenses();
}
function runMonth(ctx, dateStr) {
  const [y, m] = dateStr.split('-').map(Number);
  ctx.getTodayInfo = () => ctx.buildDayInfo(dateStr, lastDay(y, m));
  ctx.insertRegularExpensesForMonth();
}
const rowsOf = (sheet, regId) => sheet.data.slice(1).filter(x => String(x[7]).indexOf('#' + regId) !== -1);
// 날짜 칸은 Date(시트 시간대 자정). vm 영역이 달라 instanceof 대신 getTime 유무로 판별한다
const ymdKst = d => (d && typeof d.getTime === 'function') ? new Date(d.getTime() + 9 * 3600000).toISOString().slice(0, 10) : d;
const datesOf = (sheet, regId) => rowsOf(sheet, regId).map(x => ymdKst(x[1])).sort().join(',');

console.log('=== 월간 일괄 → 일간 실행: 중복 없음 ===');
{
  const { ctx, sheets } = setup([['R1', '휴대폰요금', '지출', '통신', '15', -35500, '카드']]);
  runMonth(ctx, '2026-10-01');
  r.check('1일 일괄 등록 1건', rowsOf(sheets['가계부_내역'], 'R1').length, 1);
  runDay(ctx, '2026-10-15');
  r.check('15일 일간 실행은 건너뜀', rowsOf(sheets['가계부_내역'], 'R1').length, 1);
}

console.log('\n=== 월 중간에 지정일 변경(15→20): 같은 달에 다시 넣지 않음 ===');
{
  const { ctx, sheets } = setup([['R1', '휴대폰요금', '지출', '통신', '15', -35500, '카드']]);
  runMonth(ctx, '2026-10-01');
  sheets['정기_수입지출_설정_및_휴일기준'].data[1][4] = '20';
  runDay(ctx, '2026-10-20');
  r.check('10월은 1건 유지', rowsOf(sheets['가계부_내역'], 'R1').length, 1);
  runMonth(ctx, '2026-11-01');
  r.check('11월은 새 지정일(20일)로 등록', datesOf(sheets['가계부_내역'], 'R1'), '2026-10-15,2026-11-20');
}

console.log('\n=== 자동입력 행의 비고에 메모를 덧붙여도 중복 없음 ===');
{
  const { ctx, sheets } = setup([['R1', '휴대폰요금', '지출', '통신', '15', -35500, '카드']]);
  runMonth(ctx, '2026-10-01');
  const row = rowsOf(sheets['가계부_내역'], 'R1')[0];
  row[7] = "'" + '정기지출 자동입력#R1 이번 달 할인'; // 화면 수정은 asText로 감싸 저장된다
  row[7] = String(row[7]).replace(/^'/, '');        // 시트가 돌려주는 값에는 따옴표가 없다
  runDay(ctx, '2026-10-15');
  r.check('15일 일간 실행은 건너뜀', rowsOf(sheets['가계부_내역'], 'R1').length, 1);
}

console.log('\n=== 복수 지정일(5, 15, 25) → (6, 15, 25)로 변경 ===');
{
  const { ctx, sheets } = setup([['R2', '학원비', '지출', '통신', '5, 15, 25', -100000, '이체']]);
  runMonth(ctx, '2026-10-01');
  r.check('일괄 3건', rowsOf(sheets['가계부_내역'], 'R2').length, 3);
  runDay(ctx, '2026-10-25');
  r.check('25일 일간 실행은 건너뜀', rowsOf(sheets['가계부_내역'], 'R2').length, 3);
  sheets['정기_수입지출_설정_및_휴일기준'].data[1][4] = '6, 15, 25';
  runDay(ctx, '2026-10-06');
  r.check('6일로 바꿔도 이번 달 3건 유지', rowsOf(sheets['가계부_내역'], 'R2').length, 3);
}

console.log('\n=== 요일 지정은 날짜 기준만 (매주 넣어야 함) ===');
{
  const { ctx, sheets } = setup([['R3', '주간 용돈', '지출', '통신', '매주 월요일', -10000, '현금']]);
  runMonth(ctx, '2026-10-01');
  r.check('10월 월요일 4번(5·12·19·26일)', rowsOf(sheets['가계부_내역'], 'R3').length, 4);
  runDay(ctx, '2026-10-12');
  r.check('월요일 일간 실행은 건너뜀', rowsOf(sheets['가계부_내역'], 'R3').length, 4);
}

console.log('\n=== 월 중간에 새로 추가한 항목은 정상 등록 ===');
{
  const { ctx, sheets } = setup([['R1', '휴대폰요금', '지출', '통신', '15', -35500, '카드']]);
  runMonth(ctx, '2026-10-01');
  sheets['정기_수입지출_설정_및_휴일기준'].data.push(['R4', '새 구독', '지출', '통신', '20', -9900, '카드']);
  runDay(ctx, '2026-10-20');
  r.check('새 항목 20일 등록', rowsOf(sheets['가계부_내역'], 'R4').length, 1);
  runDay(ctx, '2026-10-20');
  r.check('같은 날 다시 실행해도 1건', rowsOf(sheets['가계부_내역'], 'R4').length, 1);
}

console.log('\n=== 31일 지정: 짧은 달은 말일에 1번 ===');
{
  const { ctx, sheets } = setup([['R5', '카드대금', '지출', '통신', '31', -300000, '이체']]);
  runMonth(ctx, '2026-11-01');
  r.check('11월은 30일에 1건', datesOf(sheets['가계부_내역'], 'R5'), '2026-11-30');
  runDay(ctx, '2026-11-30');
  r.check('30일 일간 실행은 건너뜀', rowsOf(sheets['가계부_내역'], 'R5').length, 1);
}

console.log('\n=== 수입은 수입 시트로, 지출과 별도 판정 ===');
{
  const { ctx, sheets } = setup([['R6', '월급', '수입', '입금', '1', 4980000, '이체']]);
  runDay(ctx, '2026-10-01');
  runMonth(ctx, '2026-10-01');
  r.check('수입 시트 1건', rowsOf(sheets['수입'], 'R6').length, 1);
  r.check('지출 시트 0건', rowsOf(sheets['가계부_내역'], 'R6').length, 0);
  r.check('수입은 양수', rowsOf(sheets['수입'], 'R6')[0][5], 4980000);
}

console.log('\n=== 보조 함수 ===');
r.check('비고에서 ID 추출(메모 포함)', ctx2().regularIdFromNote('정기지출 자동입력#ab12 메모'), 'ab12');
r.check('지정일 "5, 15, 25" → 3일', ctx2().scheduledDaysInMonth('5, 15, 25', 31), 3);
r.check('2월 "30, 31" → 말일 1일', ctx2().scheduledDaysInMonth('30, 31', 28), 1);
r.check('요일 지정은 null', ctx2().scheduledDaysInMonth('매주 월요일', 31), null);
function ctx2() { return loadCode('Asia/Seoul'); }

r.done();
