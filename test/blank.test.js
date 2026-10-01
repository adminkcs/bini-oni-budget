// 빈 셀 판정 — batchGet은 중간의 빈 행을 []로 돌려줘 값이 undefined가 된다
const { loadCode, runner } = require('./_stub');
const r = runner();
const ctx = loadCode();

console.log('=== isBlankCell ===');
[[undefined, true], [null, true], ['', true], ['   ', true],
 [0, false], ['0', false], ['급여', false], [false, false]]
  .forEach(([v, want]) => r.check(`${JSON.stringify(v) ?? 'undefined'}`, ctx.isBlankCell(v), want));

console.log('\n=== batchGet 빈 행([]) 판정 ===');
{
  const emptyRow = [];
  const blank = [0, 1, 2, 3, 4, 5, 6, 7].every(j => ctx.isBlankCell(emptyRow[j]));
  r.check('[] 행은 빈 행', blank, true);
}

r.done();
