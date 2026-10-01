// 첫 로딩 이중 그리기 방지: initDateRange는 날짜 범위만 맞추고 그리지 않는다
const { loadCommon, runner, evalIn, setState } = require('./_stub');
const r = runner();

const ctx = loadCommon({ elements: { 'month-filter': '', 'start-date': '', 'end-date': '' } });
evalIn(ctx, 'globalThis.__renders = 0; globalThis.renderView = function () { globalThis.__renders++; };');
setState(ctx, { allTransactions: [{ 날짜: '2026-09-05' }, { 날짜: '2026-10-28' }] });

console.log('=== 첫 로딩 (initDateRange) ===');
ctx.initDateRange();
r.check('그리지 않음', ctx.__renders, 0);
r.check('최근 거래 월 선택', ctx.document.getElementById('month-filter').value, '2026-10');
r.check('시작일', ctx.document.getElementById('start-date').value, '2026-10-01');
r.check('종료일', ctx.document.getElementById('end-date').value, '2026-10-31');

console.log('\n=== 사용자가 월 변경 (handleMonthChange) ===');
ctx.document.getElementById('month-filter').value = '2026-09';
ctx.handleMonthChange();
r.check('한 번 그림', ctx.__renders, 1);
r.check('종료일 갱신', ctx.document.getElementById('end-date').value, '2026-09-30');

r.done();
