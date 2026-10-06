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
      setValues: v => v.forEach((vr, i) => { vr.forEach((c, j) => { data[row - 1 + i][col - 1 + j] = c; }); })
    })
  };
}

let uid = 0;
function setup(sheets) {
  const ctx = loadCode('Asia/Seoul');
  ctx.SpreadsheetApp = { getActiveSpreadsheet: () => ({ getSheetByName: n => sheets[n] || null }), getUi: () => { throw new Error('no ui'); } };
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

r.done();
