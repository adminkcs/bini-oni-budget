// [STEP3] 감사 컬럼 · 소프트 삭제 스키마 회귀 테스트
const { loadCode, runner } = require('./_stub');
const ctx = loadCode('Asia/Seoul');
const r = runner();

console.log('=== 컬럼 정의 일관성 ===');
r.check('TXN_COL_COUNT', ctx.TXN_COL_COUNT, 12);
r.check('헤더 개수 == 컬럼 수', ctx.TXN_HEADERS.length, ctx.TXN_COL_COUNT);
['ID','DATE','MAIN','SUB','CONTENT','AMOUNT','PAYMENT','NOTE','CREATED_BY','CREATED_AT','UPDATED_AT','DELETED']
  .forEach((k, i) => r.check(`COL.${k} = ${i + 1}`, ctx.COL[k], i + 1));
r.check('A~H 기존 순서 유지', ctx.TXN_HEADERS.slice(0, 8).join(','),
        '일련번호,날짜,대분류,소분류,내용,금액,결제수단,비고');
r.check('감사 컬럼은 뒤에만 추가', ctx.TXN_HEADERS.slice(8).join(','),
        '입력자,입력시각,수정시각,삭제여부');

console.log('\n=== buildTxnRow ===');
const at = new Date(Date.UTC(2026, 8, 11, 3, 0, 0));
const row = ctx.buildTxnRow({
  id: 'abc12345', date: ctx.toDateObject('2026-09-11'), main: '식비', sub: '외식',
  content: '점심', amount: -10000, payment: '현금', note: '메모',
  actor: 'user@example.com', at: at
});
r.check('행 길이', row.length, 12);
r.check('일련번호', row[ctx.COL.ID - 1], 'abc12345');
r.check('날짜(시트 TZ 자정)', ctx.Utilities.formatDate(row[ctx.COL.DATE - 1], 'Asia/Seoul', 'yyyy-MM-dd HH:mm'), '2026-09-11 00:00');
r.check('금액 음수 유지', row[ctx.COL.AMOUNT - 1], -10000);
r.check('입력자', row[ctx.COL.CREATED_BY - 1], 'user@example.com');
r.check('입력시각', row[ctx.COL.CREATED_AT - 1], at);
r.check('수정시각은 비어 있음', row[ctx.COL.UPDATED_AT - 1], '');
r.check('삭제여부는 비어 있음', row[ctx.COL.DELETED - 1], '');

console.log('\n=== 정기 자동입력은 SYSTEM ===');
const sysRow = ctx.buildTxnRow({
  id: 'x', date: ctx.toDateObject('2026-09-11'), main: '주거', sub: '월세',
  content: '월세', amount: -500000, payment: '자동이체', note: '정기지출 자동입력#r1',
  actor: ctx.SYSTEM_ACTOR
});
r.check('입력자 = SYSTEM', sysRow[ctx.COL.CREATED_BY - 1], 'SYSTEM');
r.check('입력시각 자동 기록',
        Object.prototype.toString.call(sysRow[ctx.COL.CREATED_AT - 1]), '[object Date]'); // realm 차이로 instanceof 불가

console.log('\n=== 소프트 삭제 상수 ===');
r.check('삭제 플래그', ctx.DELETED_FLAG, 'Y');
r.check('정리 유예일', ctx.PURGE_AFTER_DAYS, 30);

r.done();
