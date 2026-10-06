// 일련번호 형식 통일: normalizeTxnIds가 앱 형식(12자리 16진수 글자)이 아닌 ID만 바꾸는지,
// 시트 직접 입력(onEdit)이 앱과 같은 12자리 형식을 붙이는지
const { loadCode, runner } = require('./_stub');
const r = runner();

const HEAD = ['일련번호', '날짜', '대분류', '소분류', '내용', '금액'];

function fakeSheet(name, rows) {
  const data = rows;
  return {
    data,
    getName: () => name,
    getLastRow: () => data.length,
    getRange: (row, col, nr = 1, nc = 1) => ({
      getValues: () => data.slice(row - 1, row - 1 + nr).map(x => { const o = []; for (let j = 0; j < nc; j++) o.push(x[col - 1 + j] === undefined ? '' : x[col - 1 + j]); return o; }),
      setValues: v => v.forEach((vr, i) => { vr.forEach((c, j) => { data[row - 1 + i][col - 1 + j] = c; }); }),
      setValue: v => { data[row - 1][col - 1] = v; }
    })
  };
}

let uid = 0;
function setup(sheets) {
  const ctx = loadCode('Asia/Seoul');
  ctx.SpreadsheetApp = { getActiveSpreadsheet: () => ({ getSheetByName: n => sheets[n] || null }), getUi: () => { throw new Error('no ui'); }, flush() {} };
  ctx.LockService = { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) };
  // 12자리로 잘리므로 앞 12자가 매번 달라지게 만든다
  ctx.Utilities.getUuid = () => (++uid).toString(16).padStart(12, '0') + '-0000-0000';
  ctx.logRun = () => {};
  return ctx;
}

console.log('=== normalizeTxnIds ===');
{
  const log = fakeSheet('가계부_내역', [
    HEAD.slice(),
    ['0123456789ab', '2026-10-01', '생활', '외식', '앱 형식', -1000],   // 그대로
    ['a99a3eaa', '2026-09-10', '생활', '외식', '8자리', -2000],         // 변경
    [862123400000, '2026-09-30', '생활', '생활용품', '숫자형', -3000],  // 변경
    ['', '2026-09-29', '생활', '외식', 'ID 없음', -4000],               // 변경
    ['', '', '', '', '', ''],                                            // 빈 행: 그대로
    ['i9j0k1l2', '2026-09-01', '생활', '외식', '16진수 아님', -5000]    // 변경
  ]);
  const inc = fakeSheet('수입', [HEAD.slice(), ['3e5a7b9c', '2026-08-24', '수입', '입금', '급여', 100]]);
  const ctx = setup({ '가계부_내역': log, '수입': inc });
  ctx.normalizeTxnIds();

  const ids = log.data.slice(1).map(x => x[0]);
  r.check('앱 형식 ID는 그대로', ids[0], '0123456789ab');
  r.check('빈 행은 그대로', ids[4], '');
  const changed = [ids[1], ids[2], ids[3], ids[5], inc.data[1][0]];
  r.check('바뀐 ID는 모두 글자형(앞 따옴표)', changed.every(v => typeof v === 'string' && v[0] === "'"), true);
  r.check('바뀐 ID는 모두 12자리 16진수', changed.every(v => /^[0-9a-f]{12}$/.test(v.slice(1))), true);
  r.check('새 ID끼리 겹치지 않음', new Set(changed).size, changed.length);
  r.check('다른 칸은 그대로', log.data[3].slice(1).join('|'), '2026-09-30|생활|생활용품|숫자형|-3000');

  // 다시 돌리면 바꿀 것이 없다 (시트가 따옴표를 떼고 저장한 상태를 흉내)
  log.data.forEach(x => { if (typeof x[0] === 'string' && x[0][0] === "'") x[0] = x[0].slice(1); });
  inc.data.forEach(x => { if (typeof x[0] === 'string' && x[0][0] === "'") x[0] = x[0].slice(1); });
  const before = JSON.stringify(log.data) + JSON.stringify(inc.data);
  ctx.normalizeTxnIds();
  r.check('두 번째 실행은 변경 없음', JSON.stringify(log.data) + JSON.stringify(inc.data), before);
}

console.log('\n=== isAppTxnId ===');
{
  const ctx = setup({});
  r.check('12자리 16진수 글자', ctx.isAppTxnId('08defa38d7a1'), true);
  r.check('숫자형은 아님', ctx.isAppTxnId(123456789012), false);
  r.check('8자리는 아님', ctx.isAppTxnId('a99a3eaa'), false);
  r.check('대문자는 아님', ctx.isAppTxnId('08DEFA38D7A1'), false);
}

console.log('\n=== onEdit: 시트 직접 입력 시 12자리 ===');
{
  const log = fakeSheet('가계부_내역', [HEAD.slice(), ['', '2026-10-06', '생활', '외식', '직접 입력', -1000]]);
  const ctx = setup({ '가계부_내역': log });
  ctx.onEdit({ range: { getSheet: () => log, getRow: () => 2, getColumn: () => 5, getNumRows: () => 1, getNumColumns: () => 1 } });
  const v = log.data[1][0];
  r.check('글자형 12자리 16진수', typeof v === 'string' && /^'[0-9a-f]{12}$/.test(v), true);
}

console.log('\n=== normalizeRegularIds: 정기 ID + 비고 #ID 함께 변경 ===');
{
  const TXN = ['일련번호', '날짜', '대분류', '소분류', '내용', '금액', '결제수단', '비고'];
  const reg = fakeSheet('정기_수입지출_설정_및_휴일기준', [
    ['일련번호', '항목명'],
    ['6c5c6767', '월급'],
    ['i9j0k1l2', '현대해상'],
    ['0123456789ab', '이미 12자리'],
    ['', '새 항목(ID 없음)'],
    ['dupdup01', '중복 A'],
    ['dupdup01', '중복 B'],
    ['', '']
  ]);
  const log = fakeSheet('가계부_내역', [
    TXN.slice(),
    ['aaaaaaaaaaa1', '2026-10-05', '보험', '건강/생명', '현대해상', -65510, '카드', '정기지출 자동입력#i9j0k1l2'],
    ['aaaaaaaaaaa2', '2026-09-05', '보험', '건강/생명', '현대해상', -65510, '카드', '정기지출 자동입력#i9j0k1l2 메모 덧붙임'],
    ['aaaaaaaaaaa3', '2026-10-05', '생활', '외식', '직접 입력', -1000, '카드', '#i9j0k1l2'],              // 자동입력 표시 없음: 그대로
    ['aaaaaaaaaaa4', '2026-10-06', '생활', '외식', '옛 형식', -1000, '카드', '정기지출 자동입력'],        // ID 없음: 그대로
    ['aaaaaaaaaaa5', '2026-10-07', '생활', '외식', '중복', -1000, '카드', '정기지출 자동입력#dupdup01']   // 중복 ID: 그대로
  ]);
  const inc = fakeSheet('수입', [TXN.slice(), ['bbbbbbbbbbb1', '2026-10-01', '수입', '입금', '월급', 4980000, '계좌', '정기수입 자동입력#6c5c6767']]);
  const ctx = setup({ '정기_수입지출_설정_및_휴일기준': reg, '가계부_내역': log, '수입': inc });
  ctx.normalizeRegularIds();

  const strip = v => (typeof v === 'string' && v[0] === "'") ? v.slice(1) : v;
  const regIds = reg.data.slice(1).map(x => strip(x[0]));
  const newHyundai = regIds[1], newSalary = regIds[0];
  r.check('옛 ID는 12자리로', [regIds[0], regIds[1], regIds[3]].every(v => /^[0-9a-f]{12}$/.test(v)), true);
  r.check('12자리 ID는 그대로', regIds[2], '0123456789ab');
  r.check('중복 ID는 건너뜀', regIds[4] + '|' + regIds[5], 'dupdup01|dupdup01');
  r.check('빈 행은 그대로', regIds[6], '');
  r.check('지출 비고 #ID 변경', strip(log.data[1][7]), '정기지출 자동입력#' + newHyundai);
  r.check('메모 덧붙인 비고도 변경', strip(log.data[2][7]), '정기지출 자동입력#' + newHyundai + ' 메모 덧붙임');
  r.check('자동입력 표시 없는 비고는 그대로', log.data[3][7], '#i9j0k1l2');
  r.check('ID 없는 옛 비고는 그대로', log.data[4][7], '정기지출 자동입력');
  r.check('중복 ID 비고는 그대로', log.data[5][7], '정기지출 자동입력#dupdup01');
  r.check('수입 비고 #ID 변경', strip(inc.data[1][7]), '정기수입 자동입력#' + newSalary);

  // 바뀐 뒤에도 이미 들어간 행을 '입력됨'으로 알아보는지 (중복 입력 방지 유지)
  log.data.forEach(x => { x[7] = strip(x[7]); });
  const keys = ctx.buildRegularDoneKeysInRange(log, '2026-10-01', '2026-10-31');
  r.check('새 ID로 중복 판정 유지', ctx.isRegularDone(keys, '2026-10-05', newHyundai, '현대해상', '5', 31), true);
}

r.done();
