/**
 * 가계부 웹(GitHub Pages)용 OAuth 열쇠 교환소 — 별도 Apps Script 프로젝트.
 *
 * 웹페이지는 클라이언트 보안 비밀번호를 가질 수 없으므로, 로그인 코드 → 토큰 교환과
 * 장기 열쇠(refresh token) → 새 1시간 토큰 갱신만 여기서 대신한다.
 * 이 프로젝트의 권한은 외부 요청(script.external_request) 하나뿐이라 시트·드라이브에 접근하지 못한다.
 *
 * 스크립트 속성(편집기 > 프로젝트 설정 > 스크립트 속성)에 직접 입력한다. 코드·저장소에 넣지 않는다.
 *   CLIENT_ID      웹 OAuth 클라이언트 ID
 *   CLIENT_SECRET  웹 OAuth 클라이언트 보안 비밀번호
 *   ALLOWED_EMAILS 허용 계정 JSON 배열. 예: ["a@gmail.com","b@gmail.com"]
 */
var TOKEN_URL = 'https://oauth2.googleapis.com/token';

// 이 범위 밖의 권한이 섞인 토큰은 내주지 않는다 (가계부 파일 하나 + 로그인 이메일)
var ALLOWED_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/userinfo.email',
  'openid',
  'email'
];

function doPost(e) {
  var body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (x) { body = {}; }
  return ContentService.createTextOutput(JSON.stringify(handleTokenRequest_(body)))
    .setMimeType(ContentService.MimeType.JSON);
}

/** 웹 요청 1건 처리. 결과는 { access_token, expires_in, scope, refresh_token, email } 또는 { error } */
function handleTokenRequest_(body) {
  var props = PropertiesService.getScriptProperties();
  var cid = props.getProperty('CLIENT_ID');
  var secret = props.getProperty('CLIENT_SECRET');
  var allowed = parseList_(props.getProperty('ALLOWED_EMAILS'));
  if (!cid || !secret || allowed.length === 0) return { error: 'not_configured' };

  var payload;
  if (body.action === 'code' && body.code) {
    payload = { grant_type: 'authorization_code', code: String(body.code), redirect_uri: 'postmessage' };
  } else if (body.action === 'refresh' && body.refresh_token) {
    payload = { grant_type: 'refresh_token', refresh_token: String(body.refresh_token) };
  } else {
    return { error: 'bad_request' };
  }
  payload.client_id = cid;
  payload.client_secret = secret;

  var res = UrlFetchApp.fetch(TOKEN_URL, { method: 'post', payload: payload, muteHttpExceptions: true });
  var json = {};
  try { json = JSON.parse(res.getContentText() || '{}'); } catch (x) { json = {}; }
  if (res.getResponseCode() !== 200 || !json.access_token) return { error: json.error || 'token_error' };

  var extra = String(json.scope || '').split(/\s+/).filter(function (s) { return s && ALLOWED_SCOPES.indexOf(s) === -1; });
  if (extra.length > 0) return { error: 'scope_not_allowed' };

  var email = emailFromIdToken_(json.id_token);
  // 로그인(코드 교환)은 반드시 허용 계정이어야 한다. 갱신 응답에 이메일이 오면 그때도 확인한다.
  if (body.action === 'code' && allowed.indexOf(email) === -1) return { error: 'not_allowed' };
  if (email && allowed.indexOf(email) === -1) return { error: 'not_allowed' };

  return {
    access_token: json.access_token,
    expires_in: json.expires_in,
    scope: json.scope,
    refresh_token: json.refresh_token || null,
    email: email || null
  };
}

function parseList_(s) {
  try { var v = JSON.parse(s || '[]'); return Array.isArray(v) ? v.map(String) : []; } catch (x) { return []; }
}

/** Google 토큰 응답의 id_token(JWT)에서 이메일을 꺼낸다. Google에서 TLS로 직접 받은 값이라 서명 검증은 생략한다 */
function emailFromIdToken_(idToken) {
  if (!idToken) return '';
  try {
    var part = String(idToken).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    while (part.length % 4) part += '=';
    var claims = JSON.parse(Utilities.newBlob(Utilities.base64Decode(part)).getDataAsString());
    return claims.email_verified === false ? '' : String(claims.email || '');
  } catch (x) {
    return '';
  }
}

/** 편집기에서 한 번 실행해 외부 요청 권한을 승인하고, 설정 상태를 확인한다 */
function checkSetup() {
  var p = PropertiesService.getScriptProperties().getProperties();
  UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo', { muteHttpExceptions: true }); // 권한 승인 유도
  Logger.log('CLIENT_ID: ' + (p.CLIENT_ID ? '설정됨' : '없음') +
             ' / CLIENT_SECRET: ' + (p.CLIENT_SECRET ? '설정됨' : '없음') +
             ' / ALLOWED_EMAILS: ' + parseList_(p.ALLOWED_EMAILS).length + '개');
}
