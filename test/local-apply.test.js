// [PERF] 저장/수정/삭제 후 전체 재조회 없이 로컬 반영이 정확한지 검증
const { loadCommon, runner, evalIn, setState } = require('./_stub');
const r = runner();

function ctxWith(rows) {
  const ctx = loadCommon({ elements: { 'month-filter': '2026-09', 'start-date': '2026-09-01', 'end-date': '2026-09-30' } });
  setState(ctx, { rawData: { '분류_설정': [], '예산_설정': [] }, allTransactions: rows });
  return ctx;
}
const tx = (id, 날짜, 대분류, 소분류, 금액, 결제수단 = '카드', 내용 = '', 구분 = 금액 < 0 ? '지출' : '수입') =>
  ({ 일련번호: id, 날짜, 대분류, 소분류, 금액, 결제수단, 내용, 비고: '', 구분 });

console.log('=== 저장: 목록에 추가 ===');
{
  const ctx = ctxWith([tx('a1', '2026-09-01', '식비', '외식', -10000)]);
  ctx.applyLocalChange('save', tx('b2', '2026-09-02', '주거', '월세', -900000, '이체'));
  const all = evalIn(ctx, 'allTransactions');
  r.check('건수', all.length, 2);
  r.check('추가된 일련번호', all[1].일련번호, 'b2');
  r.check('금액 부호 보존', all[1].금액, -900000);
  r.check('새 결제수단이 옵션에 반영', evalIn(ctx, 'paymentOptions.indexOf("이체") !== -1'), true);
}

console.log('\n=== 수정: 같은 건을 교체 (중복 추가 아님) ===');
{
  const ctx = ctxWith([tx('a1', '2026-09-01', '식비', '외식', -10000), tx('b2', '2026-09-02', '주거', '월세', -900000)]);
  ctx.applyLocalChange('update', tx('a1', '2026-09-05', '식비', '장보기', -55000, '카드', '마트'));
  const all = evalIn(ctx, 'allTransactions');
  r.check('건수 유지', all.length, 2);
  const t = all.find(x => x.일련번호 === 'a1');
  r.check('날짜 반영', t.날짜, '2026-09-05');
  r.check('소분류 반영', t.소분류, '장보기');
  r.check('금액 반영', t.금액, -55000);
  r.check('내용 반영', t.내용, '마트');
}

console.log('\n=== 삭제: 해당 건만 제거 ===');
{
  const ctx = ctxWith([tx('a1', '2026-09-01', '식비', '외식', -10000), tx('b2', '2026-09-02', '주거', '월세', -900000)]);
  ctx.applyLocalChange('delete', { 일련번호: 'a1', 구분: '지출' });
  const all = evalIn(ctx, 'allTransactions');
  r.check('건수', all.length, 1);
  r.check('남은 건', all[0].일련번호, 'b2');
}

console.log('\n=== 같은 일련번호라도 구분이 다르면 별개 ===');
{
  const ctx = ctxWith([tx('x9', '2026-09-01', '식비', '외식', -10000, '카드', '', '지출'),
                       tx('x9', '2026-09-01', '수입', '급여', 500000, '계좌', '', '수입')]);
  ctx.applyLocalChange('delete', { 일련번호: 'x9', 구분: '지출' });
  const all = evalIn(ctx, 'allTransactions');
  r.check('지출만 제거됨', all.length, 1);
  r.check('수입은 남음', all[0].구분, '수입');
}

console.log('\n=== 서버 응답(txn)이 화면 형태로 정규화되는가 ===');
{
  const ctx = ctxWith([]);
  // 서버 toClientTxn()이 돌려주는 형태 그대로
  ctx.applyLocalChange('save', {
    일련번호: 'c3', 날짜: '2026-09-11', 대분류: '생활 소비', 소분류: '외식',
    내용: '점심', 금액: -12000, 결제수단: '현금', 비고: '', 구분: '지출'
  });
  const t = evalIn(ctx, 'allTransactions')[0];
  r.check('구분 유지', t.구분, '지출');
  r.check('금액 숫자 변환', typeof t.금액, 'number');
  r.check('필터에 걸림', ctx.getFilteredTransactions().length, 1);
}

console.log('\n=== 낙관적 저장: 임시 ID -> 서버 확정 행 교체 ===');
{
  const ctx = ctxWith([]);
  const tempId = '__tmp_1_abc';
  // 1) 낙관적으로 먼저 추가
  ctx.applyLocalChange('save', { 일련번호: tempId, 날짜: '2026-09-11', 대분류: '식비', 소분류: '외식',
                                 내용: '점심', 금액: -12000, 결제수단: '현금', 비고: '', 구분: '지출' });
  r.check('즉시 화면에 반영', evalIn(ctx, 'allTransactions').length, 1);
  r.check('임시 ID 판별', ctx.isPendingId(tempId), true);
  r.check('정상 ID는 임시 아님', ctx.isPendingId('abc123'), false);

  // 2) 서버 응답 도착 -> 임시 제거 후 확정 행 추가
  ctx.applyLocalChange('delete', { 일련번호: tempId, 구분: '지출' });
  ctx.applyLocalChange('save', { 일련번호: 'srv001', 날짜: '2026-09-11', 대분류: '식비', 소분류: '외식',
                                 내용: '점심', 금액: -12000, 결제수단: '현금', 비고: '', 구분: '지출' });
  const all = evalIn(ctx, 'allTransactions');
  r.check('중복 없이 1건 유지', all.length, 1);
  r.check('확정 ID로 교체됨', all[0].일련번호, 'srv001');
}

console.log('\n=== 낙관적 저장 실패: 임시 항목이 남지 않아야 함 ===');
{
  const ctx = ctxWith([tx('keep', '2026-09-01', '식비', '외식', -1000)]);
  const tempId = '__tmp_2_def';
  ctx.applyLocalChange('save', { 일련번호: tempId, 날짜: '2026-09-11', 대분류: '주거', 소분류: '월세',
                                 내용: 'x', 금액: -900000, 결제수단: '이체', 비고: '', 구분: '지출' });
  r.check('낙관적 추가 후 2건', evalIn(ctx, 'allTransactions').length, 2);
  ctx.applyLocalChange('delete', { 일련번호: tempId, 구분: '지출' });  // 실패 롤백
  const all = evalIn(ctx, 'allTransactions');
  r.check('롤백 후 1건', all.length, 1);
  r.check('기존 건은 보존', all[0].일련번호, 'keep');
}

console.log('\n=== 낙관적 삭제 실패: 원래 항목 복원 ===');
{
  const original = tx('d1', '2026-09-03', '주거', '월세', -900000, '이체', '9월 월세');
  const ctx = ctxWith([original]);
  ctx.applyLocalChange('delete', { 일련번호: 'd1', 구분: '지출' });
  r.check('삭제 직후 0건', evalIn(ctx, 'allTransactions').length, 0);
  ctx.applyLocalChange('save', original); // 롤백
  const all = evalIn(ctx, 'allTransactions');
  r.check('복원 후 1건', all.length, 1);
  r.check('내용 보존', all[0].내용, '9월 월세');
  r.check('금액 보존', all[0].금액, -900000);
}

r.done();
