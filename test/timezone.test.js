// 스프레드시트 시간대 != 스크립트 시간대 상황 회귀 테스트 (STEP2-fix)
// 실제 사고: 시트 (GMT-08:00) 태평양(9월엔 서머타임 -07:00) + 스크립트 Asia/Seoul(+09:00)
//            -> 16시간 차로 2026-09-11 요청이 2026-09-10 08:00 으로 저장됨
const { loadCode, runner, pad } = require('./_stub');
const r = runner();

console.log('=== toDateObject: 시트에 저장했을 때 의도한 날짜가 되는가 ===');
for (const tz of ['Asia/Seoul', 'America/Los_Angeles', 'UTC', 'Asia/Kolkata', 'Pacific/Kiritimati']) {
  const ctx = loadCode(tz);
  const d = ctx.toDateObject('2026-09-11');
  r.check(`시트 TZ ${tz}`, ctx.Utilities.formatDate(d, tz, 'yyyy-MM-dd HH:mm'), '2026-09-11 00:00');
}

console.log('\n=== 버그 재현: 수정 전 방식(스크립트 TZ 자정 고정) ===');
{
  const ctx = loadCode('America/Los_Angeles');
  const buggy = new Date(Date.UTC(2026, 8, 11) - 540 * 60000); // Asia/Seoul 자정
  r.check('하루 밀림이 재현되어야 함', ctx.Utilities.formatDate(buggy, 'America/Los_Angeles', 'yyyy-MM-dd HH:mm'), '2026-09-10 08:00');
}

console.log('\n=== getTodayInfo / fmtDate 왕복 ===');
for (const tz of ['Asia/Seoul', 'America/Los_Angeles']) {
  const ctx = loadCode(tz);
  const t = ctx.getTodayInfo();
  r.check(`시트 TZ ${tz} — dateObj를 다시 포맷하면 dateStr과 같아야 함`, ctx.fmtDate(t.dateObj), t.dateStr);
  r.check(`시트 TZ ${tz} — 말일 계산`, t.lastDayOfMonth, new Date(Date.UTC(t.year, t.month, 0)).getUTCDate());
}

console.log('\n=== 말일 계산 경계 ===');
[[2026, 2, 28], [2028, 2, 29], [2026, 4, 30], [2026, 12, 31]].forEach(([y, m, exp]) =>
  r.check(`${y}-${pad(m)} 말일`, new Date(Date.UTC(y, m, 0)).getUTCDate(), exp));

r.done();
