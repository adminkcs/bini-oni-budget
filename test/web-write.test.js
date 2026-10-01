// 정적 웹 쓰기 규칙(web/sheets-write.js)이 서버 save/update/deleteTransaction과 같은 결과를 내는지 검증
const fs = require('fs'), vm = require('vm'), path = require('path');
const { runner, loadCode } = require('./_stub');
const W = require('../web/sheets-write.js');
const r = runner();

const HEADERS = ['일련번호', '날짜', '대분류', '소분류', '내용', '금액', '결제수단', '비고', '입력자', '입력시각', '수정시각', '삭제여부'];

/** 서버 코드를 가짜 시트 위에서 실행한다. writes에 setValues/setValue 호출을 모은다 */
function server(existingRows) {
  const writes = [];
  const data = [HEADERS].concat(existingRows || []);
  const sheet = {
    getDataRange: () => ({ getValues: () => data }),
    getLastColumn: () => HEADERS.length,
    getRange: (row, col, nr, nc) => ({
      setValues: v => writes.push({ row, col, values: v }),
      setValue: v => writes.push({ row, col, values: [[v]] }),
      setNumberFormat() {}
    }),
    deleteRow() {}
  };
  const ctx = {
    console, Logger: { log() {} },
    Utilities: { getUuid: () => 'abcdef12-3456-7890-abcd-ef1234567890', formatDate: () => '2026-10-01' },
    Session: { getActiveUser: () => ({ getEmail: () => 'me@example.com' }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => '["me@example.com"]' }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => sheet, getSpreadsheetTimeZone: () => 'Asia/Seoul' }) },
    DriveApp: {}, ScriptApp: {}, Sheets: {}
  };
  vm.createContext(ctx);
  for (const f of ['Code.js', 'Dashboard.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx);
  return { ctx, writes };
}

const good = { 구분: '지출', 날짜: '2026-10-01', 대분류: ' 생활 ', 소분류: '외식', 내용: ' 점심 ', 금액: '9000', 결제수단: '카드', 비고: '' };

console.log('=== 검증 문구 (서버와 동일) ===');
const bad = [
  Object.assign({}, good, { 구분: '이체' }),
  Object.assign({}, good, { 날짜: '2026/10/01' }),
  Object.assign({}, good, { 대분류: '  ' }),
  Object.assign({}, good, { 소분류: 'undefined' }),
  Object.assign({}, good, { 결제수단: '' }),
  Object.assign({}, good, { 금액: '0' }),
  Object.assign({}, good, { 금액: 'abc' })
];
bad.forEach(e => {
  const s = server().ctx.saveTransaction(e).message;
  r.check(`저장: ${s}`, W.validate(e), s);
});
r.check('정상 입력은 통과', W.validate(good), null);

console.log('\n=== 저장: 행 값과 반환값 ===');
{
  const { ctx, writes } = server();
  const res = ctx.saveTransaction(good);
  const srvRow = writes[0].values[0];
  const webRow = W.newRow(good, srvRow[0], 'me@example.com', new Date());
  r.check('서버 일련번호 형식(12자리)', /^[0-9a-f]{12}$/.test(srvRow[0]), true);
  r.check('웹 일련번호 형식(12자리)', /^[0-9a-f]{12}$/.test(W.newId()), true);
  const pick = row => JSON.stringify([row[0], row[2], row[3], row[4], row[5], row[6], row[7], row[8], row[10], row[11]]);
  r.check('A·C~I·K·L 값 동일(날짜·입력시각 제외)', pick(webRow), pick(srvRow));
  r.check('날짜는 문자열로 넣어 시트가 날짜로 변환', webRow[1], '2026-10-01');
  r.check('행 길이 12(A~L)', webRow.length, srvRow.length);
  r.check('반환값 동일', JSON.stringify({ ok: true, txn: W.clientTxn(good, res.txn.일련번호) }), JSON.stringify(res));
  const inc = Object.assign({}, good, { 구분: '수입', 금액: 500 });
  r.check('수입은 양수(서버와 동일)', W.clientTxn(inc, 'x').금액, server().ctx.saveTransaction(inc).txn.금액);
  r.check('수입 시트 선택', W.sheetOf('수입'), '수입');
}

console.log('\n=== 수정 ===');
{
  const existing = [['id1', '', '', '', '', -1, '', '', 'a@b', '', '', ''], ['id2', '', '', '', '', -2, '', '', '', '', '', '']];
  const { ctx, writes } = server(existing);
  const e = Object.assign({}, good, { 일련번호: 'id2' });
  const res = ctx.updateTransaction(e);
  const rowWrite = writes.find(w => w.col === 1);
  r.check('찾은 행 번호 동일', W.findRows([['일련번호']].concat(existing.map(x => [x[0]])), 'id2')[0], rowWrite.row);
  const pick = row => JSON.stringify([row[0], row[2], row[3], row[4], row[5], row[6], row[7]]);
  r.check('A~H 값 동일(날짜 제외)', pick(W.updateRow(e)), pick(rowWrite.values[0]));
  r.check('서버도 수정시각은 K열(11)', writes.some(w => w.col === 11), true);
  r.check('반환값 동일', JSON.stringify({ ok: true, txn: W.clientTxn(e, 'id2') }), JSON.stringify(res));
  r.check('없는 행 문구', server(existing).ctx.updateTransaction(Object.assign({}, e, { 일련번호: 'zz' })).message, '거래를 찾지 못했습니다.');
  r.check('중복 감지', W.findRows([['h'], ['d'], ['d']], 'd').length, 2);
}

console.log('\n=== 삭제 ===');
{
  const existing = [['id1', '', '', '', '', -1, '', '', '', '', '', '']];
  const { ctx, writes } = server(existing);
  const res = ctx.deleteTransaction({ 구분: '지출', 일련번호: 'id1' });
  r.check('서버는 L열(12)에 Y', JSON.stringify(writes.find(w => w.col === 12).values), JSON.stringify([['Y']]));
  r.check('웹 삭제 표시도 Y', W.DELETED_FLAG, 'Y');
  r.check('반환값 동일', JSON.stringify(res), JSON.stringify({ ok: true, removed: { 일련번호: 'id1', 구분: '지출' } }));
  r.check('열 위치: 수정시각 K=11, 삭제여부 L=12', `${ctx.COL.UPDATED_AT},${ctx.COL.DELETED}`, '11,12');
}

console.log('\n=== 정렬 시각 (새벽 4시에만) ===');
{
  const ctx = loadCode();
  r.check('04시 KST → 정렬', ctx.isSortHour(new Date(Date.UTC(2026, 9, 1, 19, 10))), true);
  r.check('10시 KST → 건너뜀', ctx.isSortHour(new Date(Date.UTC(2026, 9, 1, 1, 10))), false);
}

r.done();
