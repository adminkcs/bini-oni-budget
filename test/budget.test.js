// [STEP3B] 예산 집행률 · 전월 대비 · 검색/드릴다운 필터 회귀 테스트
const { loadCommon, runner, evalIn, setState } = require('./_stub');
const r = runner();

function setup(rows, budgets, ym) {
  const ctx = loadCommon({ elements: { 'month-filter': ym, 'start-date': '', 'end-date': '' } });
  setState(ctx, { rawData: { '예산_설정': budgets }, allTransactions: rows });
  ctx.buildBudgetMap();
  return ctx;
}

const tx = (날짜, 대분류, 소분류, 금액, 내용 = '', 비고 = '') =>
  ({ 날짜, 대분류, 소분류, 금액, 내용, 비고, 결제수단: '카드', 구분: 금액 < 0 ? '지출' : '수입' });

console.log('=== 년월 정규화 ===');
{
  const ctx = loadCommon();
  [['2026-09', '2026-09'], ['2026-9', '2026-09'], ['2026/9', '2026-09'],
   ['2026.09', '2026-09'], ['', ''], ['이상한값', '']]
    .forEach(([i, o]) => r.check(`"${i}"`, ctx.normalizeYearMonth(i), o));
}

console.log('\n=== 전월 계산 (연도 경계 포함) ===');
{
  const ctx = loadCommon();
  [['2026-09', '2026-08'], ['2026-01', '2025-12'], ['2026-03', '2026-02']]
    .forEach(([i, o]) => r.check(`${i} 의 전월`, ctx.prevYearMonth(i), o));
}

console.log('\n=== 예산 집행률 ===');
{
  const ctx = setup(
    [tx('2026-09-01', '식비', '외식', -300000), tx('2026-09-05', '식비', '장보기', -200000),
     tx('2026-09-03', '주거', '월세', -900000), tx('2026-08-30', '식비', '외식', -999999)],
    [{ 년월: '2026-09', 대분류: '식비', 예산액: 600000 },
     { 년월: '2026-09', 대분류: '주거', 예산액: 800000 }],
    '2026-09');
  const p = ctx.getBudgetProgress();
  const 식비 = p.find(x => x.대분류 === '식비');
  const 주거 = p.find(x => x.대분류 === '주거');
  r.check('식비 집행액 (전월 건 제외)', 식비.집행, 500000);
  r.check('식비 집행률', Math.round(식비.비율), 83);
  r.check('식비 잔액', 식비.잔액, 100000);
  r.check('주거 집행률 (초과)', Math.round(주거.비율), 113);
  r.check('주거 잔액 (음수)', 주거.잔액, -100000);
  r.check('초과 항목이 먼저 정렬됨', p[0].대분류, '주거');
}

console.log('\n=== 집행률 색상 임계값 ===');
{
  const ctx = loadCommon();
  [[0, 'var(--accent)'], [79.9, 'var(--accent)'], [80, '#E8890C'],
   [99.9, '#E8890C'], [100, 'var(--danger)'], [150, 'var(--danger)']]
    .forEach(([pct, c]) => r.check(`${pct}%`, ctx.budgetColor(pct), c));
}

console.log('\n=== 예산 미설정 시 안내 ===');
{
  const ctx = setup([tx('2026-09-01', '식비', '외식', -1000)], [], '2026-09');
  r.check('빈 배열 반환', ctx.getBudgetProgress().length, 0);
  r.check('안내 문구 포함', ctx.renderBudgetHtml().includes('예산이 설정되지 않았습니다'), true);
}

console.log('\n=== 월별 합계 · 전월 대비 ===');
{
  const ctx = setup(
    [tx('2026-09-01', '식비', '외식', -100000), tx('2026-09-02', '수입', '급여', 500000),
     tx('2026-08-01', '식비', '외식', -80000), tx('2026-08-02', '수입', '급여', 400000)],
    [], '2026-09');
  const cur = ctx.monthTotals('2026-09');
  const prev = ctx.monthTotals('2026-08');
  r.check('당월 지출', cur.expense, 100000);
  r.check('당월 수입', cur.income, 500000);
  r.check('당월 순잔액', cur.net, 400000);
  r.check('전월 지출', prev.expense, 80000);

  // 지출 증가는 나쁜 신호 -> 빨강
  const up = ctx.deltaHtml(cur.expense, prev.expense, true);
  r.check('지출 증가는 danger', up.includes('var(--danger)'), true);
  r.check('증가 화살표', up.includes('▲'), true);
  r.check('증감률 25.0%', up.includes('25.0%'), true);

  // 수입 증가는 좋은 신호 -> 초록
  const inc = ctx.deltaHtml(cur.income, prev.income, false);
  r.check('수입 증가는 ok', inc.includes('var(--ok)'), true);

  r.check('전월 0이면 비교 불가 안내', ctx.deltaHtml(100, 0, true).includes('전월 데이터 없음'), true);
  r.check('동일하면 동일 안내', ctx.deltaHtml(100, 100, true).includes('전월과 동일'), true);
}

console.log('\n=== 검색 · 드릴다운 필터 ===');
{
  const rows = [
    tx('2026-09-01', '식비', '외식', -10000, '점심 김밥'),
    tx('2026-09-02', '식비', '장보기', -20000, '마트', '주말 장'),
    tx('2026-09-03', '주거', '월세', -900000, '9월 월세')
  ];
  const ctx = loadCommon({ elements: { 'month-filter': '2026-09', 'start-date': '2026-09-01', 'end-date': '2026-09-30' } });
  setState(ctx, { rawData: {}, allTransactions: rows }); ctx.buildBudgetMap();

  r.check('필터 없음', ctx.getFilteredTransactions().length, 3);

  setState(ctx, { searchKeyword: '김밥' });
  r.check('내용 검색', ctx.getFilteredTransactions().length, 1);

  setState(ctx, { searchKeyword: '주말' });
  r.check('비고 검색', ctx.getFilteredTransactions().length, 1);

  setState(ctx, { searchKeyword: '', drilldownMain: '식비' });
  r.check('드릴다운(식비)', ctx.getFilteredTransactions().length, 2);
  r.check('드릴다운 시 소분류 집계',
    JSON.stringify(ctx.groupExpenses(ctx.getFilteredTransactions())),
    JSON.stringify({ '외식': 10000, '장보기': 20000 }));

  setState(ctx, { drilldownMain: null });
  r.check('평상시 대분류 집계',
    JSON.stringify(ctx.groupExpenses(ctx.getFilteredTransactions())),
    JSON.stringify({ '식비': 30000, '주거': 900000 }));

  evalIn(ctx, "filterState.대분류.add('주거')");
  r.check('대분류 다중필터', ctx.getFilteredTransactions().length, 1);
  evalIn(ctx, 'filterState.대분류.clear()');

  r.check('팔레트 순환', ctx.paletteAt(8), ctx.paletteAt(0));
}

r.done();
