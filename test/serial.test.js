// 날짜 일련번호 → 'yyyy-MM-dd' (serialToYmd) 가 기존 경로(toDateObject → fmtDate)와 같은지
const { loadCode, runner, pad } = require('./_stub');
const r = runner();

const ymdOfSerial = s => {
  const d = new Date((Math.floor(s) - 25569) * 86400000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};
const serialOf = (y, m, d) => Date.UTC(y, m - 1, d) / 86400000 + 25569;

console.log('=== 알려진 값 ===');
{
  const ctx = loadCode();
  r.check('46296 = 2026-10-01', ctx.serialToYmd(46296), '2026-10-01');
  r.check('소수부(시각)는 버림', ctx.serialToYmd(46296.99), '2026-10-01');
  r.check('윤년 2028-02-29', ctx.serialToYmd(serialOf(2028, 2, 29)), '2028-02-29');
  r.check('연말 2026-12-31', ctx.serialToYmd(serialOf(2026, 12, 31)), '2026-12-31');
}

console.log('\n=== 기존 경로와 동일 (시트 시간대별) ===');
const serials = [];
for (let s = serialOf(2025, 12, 25); s <= serialOf(2027, 1, 5); s += 7) serials.push(s, s + 0.5);
serials.push(serialOf(2026, 3, 8), serialOf(2026, 11, 1)); // 미국 서머타임 전환일
for (const tz of ['Asia/Seoul', 'America/Los_Angeles', 'UTC', 'Asia/Kolkata', 'Pacific/Kiritimati']) {
  const ctx = loadCode(tz);
  const diff = serials.filter(s => ctx.serialToYmd(s) !== ctx.fmtDate(ctx.toDateObject(ymdOfSerial(s))));
  r.check(`시트 TZ ${tz}: ${serials.length}개 일치`, diff.length, 0);
}

r.done();
