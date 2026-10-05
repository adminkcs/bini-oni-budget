// 등록/수정 모달: 저장 실패 시 입력 보존, 사라진 대분류 보완, 정기 자동입력 표시 보존
const { loadCommon, runner, evalIn, setState } = require('./_stub');
const r = runner();

const CATS = [
  { 대분류: '생활', 소분류: '외식', 노출여부: 'Y' },
  { 대분류: '통신/구독', 소분류: '통신', 노출여부: 'Y' },
  { 대분류: '수입', 소분류: '입금', 노출여부: 'Y' }
];

/** google.script.run 대역: 마지막 호출을 기록하고, 응답은 테스트가 직접 넘긴다 */
function setup(txns = []) {
  const ctx = loadCommon();
  const calls = [];
  const runner = (ok, fail) => new Proxy({}, {
    get: (_, name) => {
      if (name === 'withSuccessHandler') return f => runner(f, fail);
      if (name === 'withFailureHandler') return f => runner(ok, f);
      return arg => calls.push({ name, arg, ok, fail });
    }
  });
  ctx.google = { script: { run: runner(null, null) } };
  ctx.setTimeout = () => 0; ctx.clearTimeout = () => {}; // 토스트 타이머
  setState(ctx, { rawData: { '분류_설정': CATS, '예산_설정': [] }, allTransactions: txns });
  evalIn(ctx, 'buildFormOptions(); buildFilterOptions();');
  const el = id => ctx.document.getElementById(id);
  return { ctx, calls, el };
}

function fillNew(el, v) {
  el('reg-date').value = v.날짜; el('reg-sub-cat').value = v.소분류; el('reg-main-cat').value = v.대분류;
  el('reg-content').value = v.내용; el('reg-amount').value = String(v.금액);
  el('reg-payment').value = '__etc__'; el('reg-payment-etc').value = v.결제수단; el('reg-note').value = v.비고 || '';
}

console.log('=== 새 등록 실패 → 입력값으로 모달을 다시 연다 ===');
{
  const { ctx, calls, el } = setup();
  ctx.openRegisterModal();
  fillNew(el, { 날짜: '2026-10-05', 대분류: '생활', 소분류: '외식', 내용: '점심 김밥', 금액: 8000, 결제수단: '카드' });
  ctx.submitRegister();
  r.check('저장 호출', calls[0].name, 'saveTransaction');
  el('reg-content').value = ''; el('reg-amount').value = ''; // 모달이 닫히며 다른 값으로 바뀐 상황
  calls[0].fail({ message: '네트워크 오류' });
  r.check('내용 복원', el('reg-content').value, '점심 김밥');
  r.check('금액 복원', String(el('reg-amount').value), '8000');
  r.check('결제수단 복원', el('reg-payment-etc').value, '카드');
  r.check('오류 안내 표시', /네트워크 오류/.test(el('reg-error').innerText), true);
  r.check('임시 행은 목록에서 제거', evalIn(ctx, 'allTransactions.length'), 0);
  r.check('다시 연 입력은 한 번 쓰고 버림', evalIn(ctx, 'registerDraft'), null);
}

console.log('\n=== 로그인 필요(정적 웹) → 다시 열지 않고 보관, + 누르면 불러옴 ===');
{
  const { ctx, calls, el } = setup();
  ctx.openRegisterModal();
  fillNew(el, { 날짜: '2026-10-05', 대분류: '생활', 소분류: '외식', 내용: '커피', 금액: 4500, 결제수단: '카드' });
  ctx.submitRegister();
  el('reg-content').value = '';
  calls[0].fail({ message: '로그인이 필요합니다.', relogin: true });
  r.check('바로 다시 채우지 않음(로그인 버튼을 가리지 않게)', el('reg-content').value, '');
  r.check('입력 보관', evalIn(ctx, 'registerDraft && registerDraft.payload.내용'), '커피');
  ctx.openRegisterModal();
  r.check('+ 누르면 불러옴', el('reg-content').value, '커피');
  r.check('불러온 뒤 보관본 비움', evalIn(ctx, 'registerDraft'), null);
}

console.log('\n=== 서버가 ok:false로 거절해도 입력 복원 ===');
{
  const { ctx, calls, el } = setup();
  ctx.openRegisterModal();
  fillNew(el, { 날짜: '2026-10-05', 대분류: '생활', 소분류: '외식', 내용: '저녁', 금액: 20000, 결제수단: '카드' });
  ctx.submitRegister();
  el('reg-content').value = '';
  calls[0].ok({ ok: false, message: '다른 사용자가 처리 중입니다.' });
  r.check('내용 복원', el('reg-content').value, '저녁');
}

console.log('\n=== 수정 실패 → 원래 거래 복원 + 고친 값으로 수정 창 다시 열기 ===');
{
  const orig = { 일련번호: 'a1', 날짜: '2026-10-01', 대분류: '생활', 소분류: '외식', 내용: '점심', 금액: -9000, 결제수단: '카드', 비고: '', 구분: '지출' };
  const { ctx, calls, el } = setup([orig]);
  ctx.openEditModal(orig);
  el('reg-amount').value = '12000';
  ctx.submitRegister();
  calls[0].fail({ message: '시간 초과' });
  r.check('목록은 원래 금액으로', evalIn(ctx, 'allTransactions[0].금액'), -9000);
  r.check('수정 창에 고친 금액', String(el('reg-amount').value), '12000');
  r.check('수정 대상 유지', evalIn(ctx, 'editingTxn && editingTxn.일련번호'), 'a1');
}

console.log('\n=== 분류 이름이 바뀐 과거 거래도 수정 창이 열린다 ===');
{
  const old = { 일련번호: 'o1', 날짜: '2026-08-01', 대분류: '옛대분류', 소분류: '옛소분류', 내용: 'x', 금액: -1000, 결제수단: '현금', 비고: '', 구분: '지출' };
  const { ctx, el } = setup([old]);
  ctx.openEditModal(old);
  r.check('대분류 값 유지(선택지 보충)', el('reg-main-cat').value, '옛대분류');
  r.check('선택지에 추가됨', el('reg-main-cat').options.some(o => o.value === '옛대분류'), true);
  r.check('소분류 값 유지', el('reg-sub-cat').value, '옛소분류');
}

console.log('\n=== 정기 자동입력 거래 수정: 비고 표시 보존 ===');
{
  const auto = { 일련번호: 'p1', 날짜: '2026-10-15', 대분류: '통신/구독', 소분류: '통신', 내용: '휴대폰요금', 금액: -35500, 결제수단: '카드', 비고: '정기지출 자동입력#R1', 구분: '지출' };
  const { ctx, calls, el } = setup([auto]);
  ctx.openEditModal(auto);
  el('reg-note').value = '이번 달 할인';
  ctx.submitRegister();
  r.check('표시 + 메모', calls[0].arg.비고, '정기지출 자동입력#R1 이번 달 할인');

  const s2 = setup([auto]);
  s2.ctx.openEditModal(auto);
  s2.ctx.submitRegister(); // 비고를 건드리지 않음
  r.check('그대로면 중복 없이 유지', s2.calls[0].arg.비고, '정기지출 자동입력#R1');

  const manual = Object.assign({}, auto, { 일련번호: 'm1', 비고: '' });
  const s3 = setup([manual]);
  s3.ctx.openEditModal(manual);
  s3.el('reg-note').value = '메모';
  s3.ctx.submitRegister();
  r.check('일반 거래는 손대지 않음', s3.calls[0].arg.비고, '메모');
}

r.done();
