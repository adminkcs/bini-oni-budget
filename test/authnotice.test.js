// 권한 재승인 안내: 권한 오류 판정(Code.js) + 배너 HTML(Common.html)
const { loadCode, loadCommon, runner } = require('./_stub');
const r = runner();

console.log('=== isPermissionError ===');
{
  const ctx = loadCode();
  const real = 'sheets.spreadsheets.values.batchGet을(를) 호출할 수 있는 권한이 없습니다. 필요한 권한은 (https://www.googleapis.com/auth/drive || ...';
  r.check('실제 오류 문구', ctx.isPermissionError(real), true);
  r.check('영문 scope 오류', ctx.isPermissionError('Request had insufficient authentication scopes.'), true);
  r.check('시트 없음 오류는 아님', ctx.isPermissionError('Unable to parse range: 예산_설정'), false);
  r.check('빈 값', ctx.isPermissionError(''), false);
}

console.log('\n=== authNoticeHtml ===');
{
  const ctx = loadCommon();
  r.check('안내 없음 → 빈 문자열', ctx.authNoticeHtml(null), '');

  const withUrl = ctx.authNoticeHtml({ url: 'https://script.google.com/macros/auth?a=1&b=2' });
  r.check('승인 버튼', withUrl.includes('권한 다시 승인하기'), true);
  r.check('URL 이스케이프', withUrl.includes('href="https://script.google.com/macros/auth?a=1&amp;b=2"'), true);

  const noUrl = ctx.authNoticeHtml({ url: null });
  r.check('URL 없으면 연결 관리 안내', noUrl.includes('https://myaccount.google.com/connections'), true);

  const bad = ctx.authNoticeHtml({ url: 'javascript:alert(1)' });
  r.check('https 아닌 URL은 쓰지 않음', bad.includes('javascript:'), false);
  r.check('대신 연결 관리 안내', bad.includes('myaccount.google.com/connections'), true);
}

r.done();
