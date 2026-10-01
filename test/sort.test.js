// 거래내역 정렬: 오늘까지 최신순 → 미래 날짜(정기 일괄입력분) 최신순 → 날짜 없음
const { loadCommon, runner } = require('./_stub');
const r = runner();
const ctx = loadCommon();

const days = [1, 2, 3, 4, 5, 18, 19, 20].map(d => `2026-10-${String(d).padStart(2, '0')}`);
const order = (today, list) =>
  list.slice().sort(ctx.makeTxnDateComparator(today)).map(d => (d && d !== '-') ? Number(d.slice(8)) : '-').join(',');

console.log('=== 미래 날짜는 1일 아래로 ===');
r.check('오늘 3일', order('2026-10-03', days), '3,2,1,20,19,18,5,4');
r.check('오늘 4일', order('2026-10-04', days.filter(d => d !== '2026-10-05')), '4,3,2,1,20,19,18');
r.check('지난달 조회(전부 과거)는 기존 최신순', order('2026-11-15', days), '20,19,18,5,4,3,2,1');
r.check('날짜 없는 행은 맨 끝', order('2026-10-03', ['', '2026-10-05', '-', '2026-10-01']), '1,5,-,-');

console.log('\n=== 같은 날짜는 기존 순서 유지 ===');
{
  const rows = [{ 날짜: '2026-10-02', id: 'a' }, { 날짜: '2026-10-02', id: 'b' }, { 날짜: '2026-10-09', id: 'c' }];
  const cmp = ctx.makeTxnDateComparator('2026-10-03');
  r.check('a,b 순서 보존', rows.slice().sort((x, y) => cmp(x.날짜, y.날짜)).map(t => t.id).join(','), 'a,b,c');
}

r.done();
