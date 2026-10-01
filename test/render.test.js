// 첫 로딩: 이번 달로 시작하고 날짜 범위만 맞춘 뒤 그리지 않는다 (이중 그리기 방지)
// 월 이동: ◀▶ 한 달씩 + 월 표에서 고르기
const { loadCommon, runner, evalIn, pad } = require('./_stub');
const r = runner();

const now = new Date();
const thisYm = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

const ctx = loadCommon({ elements: { 'month-filter': '', 'start-date': '', 'end-date': '' } });
evalIn(ctx, 'globalThis.__renders = 0; globalThis.renderView = function () { globalThis.__renders++; };');
const el = id => ctx.document.getElementById(id);
const nav = () => el('month-nav').innerHTML;

console.log('=== 첫 로딩 (initDateRange) ===');
ctx.initDateRange();
r.check('그리지 않음', ctx.__renders, 0);
r.check('기본값 = 이번 달', el('month-filter').value, thisYm);
r.check('시작일', el('start-date').value, `${thisYm}-01`);
r.check('종료일', el('end-date').value, `${thisYm}-${pad(lastDay)}`);
r.check('막대 표시', nav().includes(`${now.getFullYear()}년 ${now.getMonth() + 1}월`), true);
r.check('월 표는 닫힌 상태', nav().includes('mpick-grid'), false);

console.log('\n=== ◀ ▶ 한 달씩 (연도 경계) ===');
evalIn(ctx, "document.getElementById('month-filter').value = '2026-01'");
ctx.shiftMonth(-1);
r.check('1월 ◀ → 전년 12월', el('month-filter').value, '2025-12');
r.check('한 번 그림', ctx.__renders, 1);
ctx.shiftMonth(1);
r.check('12월 ▶ → 다음 해 1월', el('month-filter').value, '2026-01');
r.check('종료일 갱신', el('end-date').value, '2026-01-31');

console.log('\n=== 월 표 ===');
ctx.toggleMonthPicker();
r.check('열림', nav().includes('mpick-grid'), true);
r.check('12개월 버튼', (nav().match(/class="mpick-month/g) || []).length, 12);
r.check('현재 월 강조', /mpick-month selected[^>]*>1월/.test(nav()), true);
ctx.shiftPickerYear(-1);
r.check('표 연도만 바뀜(선택은 그대로)', nav().includes('2025년') && el('month-filter').value === '2026-01', true);
const before = ctx.__renders;
ctx.pickMonth('02');
r.check('고르면 이동', el('month-filter').value, '2025-02');
r.check('고르면 닫힘', nav().includes('mpick-grid'), false);
r.check('고를 때 한 번 그림', ctx.__renders, before + 1);
r.check('2월 말일', el('end-date').value, '2025-02-28');

ctx.toggleMonthPicker();
evalIn(ctx, `setMonth('${thisYm}')`);
r.check('이번 달로', el('month-filter').value, thisYm);

r.done();
