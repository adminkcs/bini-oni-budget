// 자주 쓰는 항목 — 최근 2주 / 정기 항목 제외 / 상위 3개
const { loadCommon, runner, evalIn, setState } = require('./_stub');
const r = runner();

const pad = n => String(n).padStart(2, '0');
const daysAgo = n => {
  const d = new Date(); d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
// 집계 기준이 '소분류'이므로 두 번째 인자는 소분류다
const tx = (날짜, 소분류, 내용 = '메모', 결제수단 = '카드', 비고 = '') =>
  ({ 일련번호: Math.random().toString(36).slice(2), 날짜, 대분류: '식비', 소분류,
     내용, 금액: -10000, 결제수단, 비고, 구분: '지출' });

function build(rows, regularSubCats, descMap) {
  const ctx = loadCommon();
  setState(ctx, {
    rawData: { '_정기소분류': regularSubCats || [] },
    allTransactions: rows,
    subCatDescMap: descMap || {}
  });
  ctx.buildQuickAddItems();
  return { ctx, items: evalIn(ctx, 'quickAddItems') };
}

console.log('=== 실제 거래 객체를 담는가 (빈 칩 버그 회귀) ===');
{
  const { items } = build([tx(daysAgo(1), '대중교통'), tx(daysAgo(2), '대중교통')]);
  r.check('1건 집계', items.length, 1);
  r.check('소분류가 undefined가 아님', items[0].소분류, '대중교통');
  r.check('결제수단 접근 가능', items[0].결제수단, '카드');
}

console.log('\n=== 내용이 아니라 소분류로 묶는가 ===');
{
  const { items } = build([
    tx(daysAgo(1), '대중교통', '지하철'),
    tx(daysAgo(2), '대중교통', '버스'),
    tx(daysAgo(3), '대중교통', '택시'),
    tx(daysAgo(1), '외식', '점심')
  ]);
  r.check('소분류 2종으로 묶임 (내용 4종이 아님)', items.length, 2);
  r.check('1위는 3회 쓴 대중교통', items[0].소분류, '대중교통');
}

console.log('\n=== 최근 2주 경계 ===');
{
  const { items } = build([
    tx(daysAgo(0), '오늘'), tx(daysAgo(13), '경계안'), tx(daysAgo(14), '경계밖'), tx(daysAgo(30), '한달전')
  ]);
  const names = items.map(i => i.소분류);
  r.check('오늘 포함', names.includes('오늘'), true);
  r.check('13일 전 포함', names.includes('경계안'), true);
  r.check('14일 전 제외', names.includes('경계밖'), false);
  r.check('30일 전 제외', names.includes('한달전'), false);
}

console.log('\n=== 정기 시트 등록 소분류 제외 ===');
{
  const rows = [];
  for (let i = 0; i < 5; i++) rows.push(tx(daysAgo(i), '월세'));   // 최다 사용
  for (let i = 0; i < 2; i++) rows.push(tx(daysAgo(i), '커피'));
  const { items } = build(rows, ['월세']);
  const names = items.map(i => i.소분류);
  r.check('정기 등록된 월세 제외 (손으로 입력했어도)', names.includes('월세'), false);
  r.check('커피는 남음', names.includes('커피'), true);
}

console.log('\n=== 자동입력 행은 비고로도 제외 (이중 방어) ===');
{
  const { items } = build([
    tx(daysAgo(1), '통신비', '메모', '이체', '정기지출 자동입력#abc123'),
    tx(daysAgo(1), '편의점')
  ], []);  // 정기 시트에 없어도
  const names = items.map(i => i.소분류);
  r.check('자동입력 행 제외', names.includes('통신비'), false);
  r.check('일반 건은 남음', names.includes('편의점'), true);
}

console.log('\n=== 상위 3개 · 사용 횟수 내림차순 ===');
{
  const rows = [];
  ['A','A','A','A', 'B','B','B', 'C','C', 'D'].forEach((n, i) => rows.push(tx(daysAgo(i % 10), n)));
  const { items } = build(rows);
  r.check('최대 3개', items.length, 3);
  r.check('1위 A', items[0].소분류, 'A');
  r.check('2위 B', items[1].소분류, 'B');
  r.check('3위 C', items[2].소분류, 'C');
  r.check('4위 D는 제외', items.map(i => i.소분류).includes('D'), false);
}

console.log('\n=== 동률이면 최근 사용 우선 ===');
{
  const { items } = build([tx(daysAgo(10), '오래된'), tx(daysAgo(1), '최근것')]);
  r.check('최근 건이 앞', items[0].소분류, '최근것');
}

console.log('\n=== 예외 상황 ===');
{
  r.check('거래 없음', build([]).items.length, 0);
  r.check('소분류 빈 건 제외', build([tx(daysAgo(1), '')]).items.length, 0);
  const income = { 일련번호: 'x', 날짜: daysAgo(1), 대분류: '수입', 소분류: '급여',
                   내용: '월급', 금액: 500000, 결제수단: '계좌', 비고: '', 구분: '수입' };
  r.check('수입은 대상 아님', build([income]).items.length, 0);
  r.check('_정기소분류 없어도 동작', build([tx(daysAgo(1), '점심')], undefined).items.length, 1);
}

console.log('\n=== 소분류 선택지 라벨 (설명 괄호 + … 줄임) ===');
{
  const { ctx } = build([], [], {
    '대중교통': '지하철, 버스',
    '외식': '점심 저녁 회식 배달 야식 간식 등 모든 외부 식사',
    '기타': ''
  });
  r.check('설명 있으면 괄호로 표기', ctx.subCatOptionLabel('대중교통'), '대중교통 (지하철, 버스)');
  r.check('설명 없으면 이름만', ctx.subCatOptionLabel('기타'), '기타');
  r.check('미등록 소분류도 이름만', ctx.subCatOptionLabel('신규'), '신규');

  const long = ctx.subCatOptionLabel('외식');
  r.check('긴 설명은 …로 줄임', long.endsWith('…)'), true);
  const inside = long.slice(long.indexOf('(') + 1, -1);
  r.check('설명 길이 상한 준수', inside.length <= evalIn(ctx, 'SUBCAT_DESC_MAX'), true);
  r.check('소분류명 자체는 안 잘림', long.startsWith('외식 ('), true);
}

r.done();
