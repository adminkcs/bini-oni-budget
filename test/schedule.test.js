// 정기 항목 실행 조건(말일 처리 포함) 및 날짜 유틸 회귀 테스트
const { loadCode, runner, pad } = require('./_stub');

const ctx = loadCode('Asia/Seoul');
const r = runner();

const day = (y, m, d, dow) => ({
  year: y, month: m, day: d, fullDay: dow,
  lastDayOfMonth: new Date(Date.UTC(y, m, 0)).getUTCDate(),
  dateStr: `${y}-${pad(m)}-${pad(d)}`
});
const t = (desc, setting, today, expected) =>
  r.check(`${desc}  [지정일:"${setting}" / ${today.dateStr}(말일${today.lastDayOfMonth}) ${today.fullDay}]`,
          ctx.matchesRegularSchedule(setting, today), expected);

console.log('--- 말일 보정: 지정일 31 ---');
t('2월 말일에 실행',        '31', day(2026, 2, 28, '토요일'), true);
t('2월 27일엔 미실행',      '31', day(2026, 2, 27, '금요일'), false);
t('윤년 2월 29일에 실행',   '31', day(2028, 2, 29, '화요일'), true);
t('윤년 2월 28일엔 미실행', '31', day(2028, 2, 28, '월요일'), false);
t('4월(30일) 말일에 실행',  '31', day(2026, 4, 30, '목요일'), true);
t('3월 31일 정확히 일치',   '31', day(2026, 3, 31, '화요일'), true);
t('3월 30일엔 미실행',      '31', day(2026, 3, 30, '월요일'), false);

console.log('\n--- 말일 보정: 지정일 30 ---');
t('2월 말일에 실행',      '30', day(2026, 2, 28, '토요일'), true);
t('4월 30일 정확히 일치', '30', day(2026, 4, 30, '목요일'), true);
t('3월 30일 정확히 일치', '30', day(2026, 3, 30, '월요일'), true);
t('3월 31일엔 미실행',    '30', day(2026, 3, 31, '화요일'), false);

console.log('\n--- "말일" 키워드 ---');
t('2월 말일',  '말일', day(2026, 2, 28, '토요일'), true);
t('2월 27일',  '말일', day(2026, 2, 27, '금요일'), false);
t('12월 31일', '말일', day(2026, 12, 31, '목요일'), true);

console.log('\n--- 요일 지정 (기존 동작 유지) ---');
t('월요일 일치',    '매주 월요일',    day(2026, 9, 14, '월요일'), true);
t('화요일 불일치',  '매주 월요일',    day(2026, 9, 15, '화요일'), false);
t('요일 우선 판정', '매주 월요일 31', day(2026, 2, 28, '토요일'), false);

console.log('\n--- 복수 일자 / 예외값 ---');
t('5,15,25 중 15일', '5, 15, 25', day(2026, 9, 15, '화요일'), true);
t('5,15,25 중 20일', '5, 15, 25', day(2026, 9, 20, '일요일'), false);
t('숫자형 25 입력',  25,          day(2026, 9, 25, '금요일'), true);
t('빈 문자열',       '',          day(2026, 9, 25, '금요일'), false);
t('null',            null,        day(2026, 9, 25, '금요일'), false);
t('범위초과 0',      '0',         day(2026, 9, 30, '수요일'), false);
t('범위초과 99',     '99',        day(2026, 9, 30, '수요일'), false);

console.log('\n--- 정렬 가중치 (오늘=9/15 기준) ---');
const today = day(2026, 9, 15, '화요일');
r.check('오늘 해당 항목이 최상단', ctx.getRegularSortWeight('15', today), -1000);
r.check('일자 5',      ctx.getRegularSortWeight('5', today), 5);
r.check('일자 25',     ctx.getRegularSortWeight('25', today), 25);
r.check('말일은 일자 뒤', ctx.getRegularSortWeight('말일', today), 32);
r.check('요일은 그 뒤', ctx.getRegularSortWeight('매주 월요일', today), 101);
r.check('미설정은 최후', ctx.getRegularSortWeight('', today), 999);

console.log('\n--- toDateObject (시트 시간대 자정인지) ---');
r.check('"2026-09-11"', ctx.Utilities.formatDate(ctx.toDateObject('2026-09-11'), 'Asia/Seoul', 'yyyy-MM-dd HH:mm'), '2026-09-11 00:00');
r.check('"2026-1-5" (한자리 월/일)', ctx.Utilities.formatDate(ctx.toDateObject('2026-1-5'), 'Asia/Seoul', 'yyyy-MM-dd HH:mm'), '2026-01-05 00:00');
r.check('잘못된 문자열은 null', ctx.toDateObject('없는날짜'), null);
r.check('fmtDate 왕복', ctx.fmtDate(ctx.toDateObject('2026-09-11')), '2026-09-11');

r.done();
