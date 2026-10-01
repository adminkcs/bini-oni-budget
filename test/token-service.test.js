// 열쇠 교환소(token-service/Code.js) 보안 규칙
const fs = require('fs'), vm = require('vm'), path = require('path');
const { runner } = require('./_stub');
const r = runner();

const b64url = o => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const idToken = claims => `h.${b64url(claims)}.s`;

function load(props, tokenResponse) {
  const calls = [], logs = [];
  const ctx = {
    console: { log: s => logs.push(String(s)) }, Logger: { log() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; }, getProperties: () => props }) },
    UrlFetchApp: { fetch: (url, opts) => { calls.push({ url, opts }); return { getResponseCode: () => tokenResponse.code, getContentText: () => JSON.stringify(tokenResponse.body) }; } },
    Utilities: {
      base64Decode: s => Array.from(Buffer.from(s, 'base64')),
      newBlob: bytes => ({ getDataAsString: () => Buffer.from(bytes).toString('utf8') }),
      formatDate: () => '10-02 07:00:00'
    },
    ContentService: { createTextOutput: s => ({ s, setMimeType() { return this; } }), MimeType: { JSON: 'json' } }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'token-service', 'Code.js'), 'utf8'), ctx);
  return { ctx, calls, logs };
}

const PROPS = { CLIENT_ID: 'cid', CLIENT_SECRET: 'secret', ALLOWED_EMAILS: '["me@example.com","fam@example.com"]' };
const okBody = (claims, scope, extra) => ({ code: 200, body: Object.assign({
  access_token: 'AT', expires_in: 3599, scope: scope || 'https://www.googleapis.com/auth/drive.file openid https://www.googleapis.com/auth/userinfo.email',
  id_token: idToken(claims)
}, extra || {}) });

console.log('=== 설정·요청 검사 ===');
r.check('설정 없으면 거절', load({}, okBody({})).ctx.handleTokenRequest_({ action: 'code', code: 'c' }).error, 'not_configured');
r.check('이상한 요청 거절', load(PROPS, okBody({})).ctx.handleTokenRequest_({ action: 'steal' }).error, 'bad_request');

console.log('\n=== 로그인(코드 교환) ===');
{
  const { ctx, calls } = load(PROPS, okBody({ email: 'me@example.com', email_verified: true }, null, { refresh_token: 'RT' }));
  const res = ctx.handleTokenRequest_({ action: 'code', code: 'abc' });
  r.check('허용 계정은 토큰 발급', res.access_token, 'AT');
  r.check('장기 열쇠 전달', res.refresh_token, 'RT');
  r.check('이메일 전달', res.email, 'me@example.com');
  r.check('Google 토큰 주소로만 요청', calls[0].url, 'https://oauth2.googleapis.com/token');
  r.check('비밀값은 Google 요청에만 포함', calls[0].opts.payload.client_secret, 'secret');
  r.check('응답에는 비밀값 없음', JSON.stringify(res).includes('secret'), false);
  r.check('팝업 로그인 redirect_uri', calls[0].opts.payload.redirect_uri, 'postmessage');
}
r.check('허용 외 계정 거절', load(PROPS, okBody({ email: 'stranger@example.com' })).ctx.handleTokenRequest_({ action: 'code', code: 'c' }).error, 'not_allowed');
r.check('이메일 미확인 계정 거절', load(PROPS, okBody({ email: 'me@example.com', email_verified: false })).ctx.handleTokenRequest_({ action: 'code', code: 'c' }).error, 'not_allowed');
r.check('넓은 권한 섞이면 거절', load(PROPS, okBody({ email: 'me@example.com' },
  'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive')).ctx.handleTokenRequest_({ action: 'code', code: 'c' }).error, 'scope_not_allowed');
r.check('Google 오류 전달', load(PROPS, { code: 400, body: { error: 'invalid_grant' } }).ctx.handleTokenRequest_({ action: 'code', code: 'c' }).error, 'invalid_grant');

console.log('\n=== 갱신 ===');
{
  const { ctx, calls } = load(PROPS, okBody({ email: 'fam@example.com' }));
  const res = ctx.handleTokenRequest_({ action: 'refresh', refresh_token: 'RT' });
  r.check('갱신 성공', res.access_token, 'AT');
  r.check('grant_type', calls[0].opts.payload.grant_type, 'refresh_token');
}
r.check('갱신 응답 이메일이 허용 외면 거절', load(PROPS, okBody({ email: 'x@y.z' })).ctx.handleTokenRequest_({ action: 'refresh', refresh_token: 'RT' }).error, 'not_allowed');
r.check('갱신 응답에 이메일이 없으면 허용', load(PROPS, { code: 200, body: { access_token: 'AT', expires_in: 3599, scope: 'https://www.googleapis.com/auth/drive.file' } })
  .ctx.handleTokenRequest_({ action: 'refresh', refresh_token: 'RT' }).access_token, 'AT');

console.log('\n=== doPost ===');
{
  const { ctx } = load(PROPS, okBody({}));
  r.check('잘못된 JSON도 안전하게 처리', JSON.parse(ctx.doPost({ postData: { contents: '{bad' } }).s).error, 'bad_request');
}

console.log('\n=== 실행 기록 ===');
const post = (ctx, body) => ctx.doPost({ postData: { contents: JSON.stringify(body) } });
{
  const { ctx, logs } = load(PROPS, okBody({ email: 'me@example.com' }, null, { refresh_token: 'RT-SECRET' }));
  post(ctx, { action: 'code', code: 'CODE-SECRET' });
  r.check('로그인 성공 기록', logs[0], '로그인 성공 | me@example.com');
  r.check('기록에 토큰·코드·비밀값 없음', /AT|RT-SECRET|CODE-SECRET|secret/.test(logs.join(' ')), false);
}
{
  const { ctx, logs } = load(PROPS, okBody({ email: 'stranger@example.com' }));
  post(ctx, { action: 'refresh', refresh_token: 'RT' });
  r.check('거절 사유와 계정 기록', logs[0], '갱신 거절(not_allowed) | stranger@example.com');
}
{
  const { ctx, logs } = load(PROPS, { code: 400, body: { error: 'invalid_grant' } });
  post(ctx, { action: 'refresh', refresh_token: 'RT' });
  r.check('끊긴 열쇠 기록', logs[0], '갱신 거절(invalid_grant) | 계정 모름');
}
{
  const props = Object.assign({}, PROPS);
  const { ctx } = load(props, okBody({ email: 'fam@example.com' }));
  for (let i = 0; i < 35; i++) post(ctx, { action: 'refresh', refresh_token: 'RT' });
  const saved = JSON.parse(props.RECENT_LOG);
  r.check('최근 기록 보관(최신 먼저)', saved[0], '10-02 07:00:00 갱신 성공 | fam@example.com');
  r.check('최근 기록은 30줄까지만', saved.length, 30);
}

r.done();
