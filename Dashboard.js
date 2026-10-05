/**
 * ==============================================================================
 * ★ 스크립트 속성 점검
 *
 * [보안] 예전에는 이 함수가 실제 이메일과 Drive 폴더 ID를 코드에 하드코딩해 두고
 *   그대로 속성에 써 넣었다. 민감값을 코드에서 빼내려고 만든 함수가 정작 값을
 *   코드에 박아두고 있었던 셈이다. 저장소를 원격에 올리면 그대로 노출된다.
 *   이제 이 함수는 '값을 쓰지 않고' 설정 상태만 점검한다.
 *   실제 값은 편집기의 [프로젝트 설정 > 스크립트 속성]에서 직접 입력한다.
 *
 * 값 자체는 화면에 그대로 띄우지 않고 마스킹해 '설정 여부'만 확인시킨다.
 * ==============================================================================
 */
var REQUIRED_PROPS = {
  'ALLOWED_USERS': '접근 허용 이메일 JSON 배열. 예: ["a@example.com","b@example.com"]',
  'BACKUP_FOLDER_ID': '백업 파일을 저장할 Google Drive 폴더 ID'
};
var OPTIONAL_PROPS = {
  'ADMIN_EMAIL': '(선택) 실패 알림 수신 주소. 없으면 ALLOWED_USERS의 첫 번째를 사용'
};

/** 값을 그대로 노출하지 않도록 마스킹한다 */
function maskPropValue(key, value) {
  if (!value) return '(없음)';
  if (key === 'ALLOWED_USERS') {
    try {
      const list = JSON.parse(value);
      return list.length + '개 등록 (' + list.map(function (e) {
        const at = String(e).indexOf('@');
        return at > 1 ? String(e).charAt(0) + '***' + String(e).substring(at) : '***';
      }).join(', ') + ')';
    } catch (e) { return '(형식 오류 — JSON 배열이어야 합니다)'; }
  }
  return String(value).substring(0, 6) + '…' + String(value).length + '자';
}

function setupScriptProperties() {
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();
  const lines = [];
  const missing = [];

  Object.keys(REQUIRED_PROPS).forEach(function (k) {
    if (all[k]) lines.push('✅ ' + k + ' : ' + maskPropValue(k, all[k]));
    else { lines.push('❌ ' + k + ' : 미설정'); missing.push(k); }
  });
  Object.keys(OPTIONAL_PROPS).forEach(function (k) {
    lines.push((all[k] ? '✅ ' : '· ') + k + ' : ' + (all[k] ? maskPropValue(k, all[k]) : '미설정 (선택)'));
  });

  let msg = lines.join('\n');
  if (missing.length > 0) {
    msg += '\n\n[설정 방법]\n' +
           '확장 프로그램 > Apps Script > ⚙️ 프로젝트 설정 > 스크립트 속성 > 속성 추가\n\n' +
           missing.map(function (k) { return '· ' + k + '\n    ' + REQUIRED_PROPS[k]; }).join('\n');
  } else {
    msg += '\n\n필수 속성이 모두 설정되어 있습니다.';
  }

  Logger.log('[스크립트 속성 점검]\n' + msg);
  try {
    SpreadsheetApp.getUi().alert('스크립트 속성 점검', msg, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) { /* 트리거 등 UI 없는 환경 */ }
  return { ok: missing.length === 0, missing: missing };
}

/**
 * [PERF] Session.getActiveUser()는 호출 비용이 있는데 저장 1건에 2번(권한검사 + 입력자 기록)
 *   호출되고 있었다. 실행당 1회만 조회해 재사용한다. (실행 컨텍스트는 요청마다 새로 뜨므로
 *   사용자가 섞일 위험은 없다)
 */
var _currentEmailCache = null;
function getCurrentEmail() {
  if (_currentEmailCache !== null) return _currentEmailCache;
  try {
    _currentEmailCache = Session.getActiveUser().getEmail() || '';
  } catch (e) {
    _currentEmailCache = '';
  }
  return _currentEmailCache;
}

function assertAuthorized() {
  const userEmail = getCurrentEmail();
  const propsStr = PropertiesService.getScriptProperties().getProperty('ALLOWED_USERS');
  
  if (!propsStr) {
    throw new Error('초기 설정 미완료: setupScriptProperties()를 1회 실행하세요.');
  }
  
  let allowedUsers = [];
  try { allowedUsers = JSON.parse(propsStr); } catch(e) {}
  
  if (allowedUsers.indexOf(userEmail) === -1) {
    throw new Error('접근 권한이 없습니다.');
  }
}

/**
 * 홈 화면 아이콘(파비콘) URL.
 * 저장소 assets/ 의 공개 파일을 가리킨다. 이미지를 교체하면 이 URL은 그대로 두고
 * assets/icon-192.png 만 바꿔 커밋하면 된다(캐시 때문에 반영에 시간이 걸릴 수 있음).
 */
var ICON_URL = 'https://raw.githubusercontent.com/adminkcs/bini-oni-budget/main/assets/icon-192.png';

/**
 * ==============================================================================
 * ★ [계측] 첫 화면 로딩 구간별 소요 시간
 * 한 번의 doGet 실행 안에서만 쓰는 전역이다(실행마다 새로 뜨므로 사용자 간에 섞이지 않는다).
 * 서버 구간은 SERVER_PERF로 페이지에 심어 보내고, 브라우저가 화면을 다 그린 뒤
 * 브라우저 구간과 합쳐 logPageLoad()로 '로딩_로그' 시트에 1행을 남긴다.
 * ==============================================================================
 */
var _loadPerf = { start: 0, auth: 0, dataAuth: 0, batchGet: 0, batchGetOk: true, parse: 0, data: 0, serialize: 0, kb: 0, rows: {}, view: '', router: null };

function getDoGetStart() { return _loadPerf.start || Date.now(); }

/** 템플릿 맨 끝에서 호출된다. 이 시점까지가 서버 처리 시간이다. */
function getServerPerfJson() {
  const p = _loadPerf;
  const end = Date.now();
  const total = end - p.start;
  const out = {
    view: p.view, start: p.start, end: end, total: total,
    auth: p.auth, dataAuth: p.dataAuth, batchGet: p.batchGet, batchGetOk: p.batchGetOk,
    batchGetError: p.batchGetError || '',
    parse: p.parse, serialize: p.serialize, kb: p.kb, rows: p.rows,
    template: Math.max(0, total - p.auth - p.data - p.serialize),
    router: p.router
  };
  console.log('[로딩계측] 서버 ' + JSON.stringify(out));
  return toSafeJson(out);
}

/** 라우터가 붙여 보낸 시각(rs/r0/rt/rm)을 숫자로만 받아 둔다 */
function readRouterParams(p) {
  const num = function (v) { const n = Number(v); return isFinite(n) && n > 0 ? n : 0; };
  if (!p || !p.rt) return null;
  return { rs: num(p.rs), r0: num(p.r0), rt: num(p.rt), rm: p.rm === '1' };
}

var SHEET_LOADLOG = '로딩_로그';
var LOADLOG_MAX_ROWS = 1000;
var LOADLOG_FIELDS = [
  '화면', '진입', '총소요', '라우터', '서버+전달', '서버합계', '구글/네트워크',
  '권한확인', '시트조회', '데이터가공', '직렬화', '템플릿',
  '스크립트시작', 'DOM준비', '데이터반영', '렌더', 'Chart.js',
  'HTML용량KB', '거래건수', '네트워크', '기기'
];

/** 브라우저가 화면을 다 그린 뒤 비동기로 호출한다. 실패해도 화면에는 영향이 없다. */
function logPageLoad(m) {
  try { assertAuthorized(); } catch (e) { return { ok: false }; }
  try {
    m = m || {};
    const cell = function (v) {
      if (typeof v === 'number') return isFinite(v) ? Math.round(v) : '';
      if (typeof v === 'string') return v.substring(0, 60);
      return '';
    };
    const row = [new Date(), getCurrentEmail()]
      .concat(LOADLOG_FIELDS.map(function (k) { return cell(m[k]); }))
      .concat([String(JSON.stringify(m.상세 || {})).substring(0, 3000)]);
    console.log('[로딩계측] ' + JSON.stringify(row));

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SHEET_LOADLOG);
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_LOADLOG);
      sheet.getRange(1, 1, 1, row.length).setValues([['시각', '사용자'].concat(LOADLOG_FIELDS, ['상세'])]);
      sheet.setFrozenRows(1);
      sheet.getRange('A:A').setNumberFormat('yyyy-MM-dd HH:mm:ss');
    }
    sheet.appendRow(row);
    const last = sheet.getLastRow();
    if (last > LOADLOG_MAX_ROWS + 1) sheet.deleteRows(2, last - LOADLOG_MAX_ROWS - 1);
    return { ok: true };
  } catch (e) {
    console.log('[로딩계측] 기록 실패: ' + (e && e.message ? e.message : e));
    return { ok: false };
  }
}

/**
 * 재승인 안내 정보. Apps Script가 승인 필요(REQUIRED)로 판단하면 승인 URL을 준다.
 * URL을 얻지 못하면 url=null — 화면이 '연결 관리에서 삭제 후 다시 열기' 수동 절차를 안내한다.
 * 이름 끝의 _ 로 google.script.run에서 호출되지 않게 한다.
 */
function buildAuthNotice_() {
  let url = null;
  try {
    const info = ScriptApp.getAuthorizationInfo(ScriptApp.AuthMode.FULL);
    if (info.getAuthorizationStatus() === ScriptApp.AuthorizationStatus.REQUIRED) url = info.getAuthorizationUrl();
  } catch (e) {
    Logger.log('[재승인 안내] 승인 상태 확인 실패: ' + (e && e.message ? e.message : e));
  }
  return { url: url };
}

function doGet(e) {
  _loadPerf.start = Date.now();
  try {
    assertAuthorized();
  } catch(err) {
    return HtmlService.createHtmlOutput('<div style="padding: 24px; font-family: sans-serif; text-align: center;"><h3>' + err.message + '</h3></div>').setTitle('접근 차단');
  }
  _loadPerf.auth = Date.now() - _loadPerf.start;

  const view = e.parameter.view;
  _loadPerf.view = view || 'router';
  _loadPerf.router = readRouterParams(e.parameter);
  let templateName = 'Router'; 

  if (view === 'pc') templateName = 'Index';
  else if (view === 'mobile') templateName = 'Mobile';

  return HtmlService.createTemplateFromFile(templateName).evaluate()
    // [STEP3] maximum-scale / user-scalable=no 제거 - 확대 차단은 접근성 위반
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0')
    // [아이콘] Android(갤럭시)는 '홈 화면에 추가' 시 파비콘을 아이콘으로 쓴다.
    //   HtmlService에는 <link> 태그를 넣을 방법이 없고(우리 HTML은 샌드박스 iframe 안이라
    //   최상위 문서의 head에 닿지 않는다) setFaviconUrl()이 유일한 경로다.
    //   이미지는 이 저장소의 공개 URL에서 제공한다. 비공개 저장소면 익명 접근이 막혀
    //   404가 되므로 아이콘이 뜨지 않는다.
    .setFaviconUrl(ICON_URL)
    // [주의] addMetaTag는 Apps Script가 허용한 이름만 받는다.
    //   'theme-color'를 넣었다가 doGet 전체가
    //   "지정한 메타태그는 이 컨텍스트에서 허용되지 않습니다"로 실패했다.
    //   viewport 외에는 추가하지 말 것. 주소창 색상은 포기한다.
    // [STEP3] ALLOWALL -> DEFAULT. 외부 사이트 iframe 삽입 허용은 클릭재킹 노출이며
    //         이 앱은 독립 URL로만 사용한다. (시트 내 임베드가 필요해지면 되돌릴 것)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT)
    .setTitle('비니네 오니네 가계부');
}

/**
 * ==============================================================================
 * ★ [PERF] 초기 로딩용 데이터 부트스트랩
 * 기존에는 HTML을 받은 뒤(①) 화면에서 다시 getDashboardData를 호출해(②) 왕복이 2회였다.
 * doGet은 이미 서버에서 실행되므로 그 자리에서 데이터를 페이지에 심어 ②를 없앤다.
 *
 * [보안] <?!= ?> 는 이스케이프 없이 출력되고 JSON.stringify는 <, >, / 를 건드리지 않는다.
 *   시트 값에 "</script>" 가 들어오면 스크립트 블록이 끊겨 XSS가 성립하므로
 *   반드시 toSafeJson()으로 유니코드 이스케이프한 뒤 출력해야 한다.
 *   (렌더링 시점의 escapeHtml()은 계층이 달라 이 문제를 막지 못한다)
 * ==============================================================================
 */
function toSafeJson(obj) {
  return escapeForScriptTag(JSON.stringify(obj));
}

/** 이미 만들어진 JSON 문자열을 <script> 안에 넣어도 안전하게 이스케이프한다 */
function escapeForScriptTag(json) {
  return String(json)
    .replace(/</g, '\\u003c')      // </script> 로 블록을 끊는 것을 차단
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028') // JS에서 줄바꿈으로 해석되는 문자
    .replace(/\u2029/g, '\\u2029');
}

/**
 * 템플릿에서 호출된다. 실패해도 페이지 전체가 죽지 않도록 null을 반환해
 * 프런트가 기존 비동기 경로로 자동 폴백하게 한다.
 */
function getBootstrapJson() {
  try {
    const t0 = Date.now();
    const data = getDashboardData();
    const t1 = Date.now();
    const json = toSafeJson(data);
    _loadPerf.data = t1 - t0;
    _loadPerf.serialize = Date.now() - t1;
    _loadPerf.kb = Math.round(json.length / 1024);
    return json;
  } catch (e) {
    Logger.log('[부트스트랩 실패] ' + (e && e.message ? e.message : e));
    return 'null';
  }
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function getDashboardData(includeArchive = false) {
  // [회귀수정] 에러 사유를 삼키지 않고 _error 플래그에 담아 반환
  const tAuth = Date.now();
  try { assertAuthorized(); } catch(e) { return { _error: e.message }; }
  _loadPerf.dataAuth = Date.now() - tAuth;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const spreadsheetId = ss.getId();
  const result = {};

  // [PERF] 조회 대상에서 '정기_수입지출_설정_및_휴일기준'을 제외했다.
  //        프런트에서 단 한 곳도 사용하지 않는데 시트 전체를 읽어 내려보내고 있었다.
  const TARGET_TABS = [SHEET_LOG, SHEET_INCOME, SHEET_CATEGORY, SHEET_BUDGET];

  if (includeArchive) {
    TARGET_TABS.push('가계부_내역_보관함', '수입_보관함');
  }

  // [PERF] 거래 시트는 프런트가 쓰는 A~H만 내려보낸다.
  //        입력자/입력시각/수정시각은 화면에서 쓰지 않는데 행마다 Utilities.formatDate를
  //        호출하고 있어 행 수 × 3회의 포맷 비용과 불필요한 payload가 발생했다.
  const TXN_SHEETS = [SHEET_LOG, SHEET_INCOME, '가계부_내역_보관함', '수입_보관함'];
  const dateCache = {}; // [PERF] 같은 날짜가 반복되므로 포맷 결과를 재사용

  function fmtDateCached(d) {
    const key = d.getTime();
    let s = dateCache[key];
    if (s === undefined) { s = fmtDate(d); dateCache[key] = s; }
    return s;
  }

  // [STEP3] 날짜값이 들어갈 수 있는 컬럼명. batchGet 경로에서 Date 타입이 사라지고
  //   순수 숫자(SERIAL_NUMBER)로 오기 때문에, instanceof Date 대신 헤더명으로 판별한다.
  const DATE_HEADER_NAMES = ['날짜', '년월'];

  // [PERF] 실측 결과 비용은 데이터 양이 아니라 'Sheets 백엔드 왕복 횟수'에 비례한다.
  //   2행짜리 시트도 0.5초가 걸렸다 (호출 1회당 약 250~1100ms, 변동폭이 크다).
  //   개별 SpreadsheetApp 호출을 시트마다 하면 6개 시트 = 최대 2.5초가 걸렸다.
  //   Advanced Sheets API의 batchGet은 여러 range를 HTTP 요청 1번으로 묶는다.
  //   valueRenderOption: UNFORMATTED_VALUE로 숫자에 천단위 콤마 등 서식이 섞이는 걸 막고,
  //   dateTimeRenderOption: SERIAL_NUMBER로 날짜를 원시 일련번호로 받아 serialToYmd로
  //   getValues() 경로와 같은 'yyyy-MM-dd' 문자열로 만든다.
  //   요청한 시트 중 하나라도 없으면 batchGet 전체가 실패하므로, 실패 시엔 기존
  //   SpreadsheetApp 방식(시트별 개별 조회)으로 폴백한다.
  const REG_TAB = SHEET_REGULAR;
  const ALL_TABS = TARGET_TABS.concat([REG_TAB]);
  let valuesByTab = null;
  const tBatch = Date.now();
  try {
    const resp = Sheets.Spreadsheets.Values.batchGet(spreadsheetId, {
      ranges: ALL_TABS.map(function (name) { return "'" + name + "'"; }),
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'SERIAL_NUMBER'
    });
    valuesByTab = {};
    (resp.valueRanges || []).forEach(function (vr, i) {
      valuesByTab[ALL_TABS[i]] = vr.values || [];
    });
  } catch (e) {
    Logger.log('[getDashboardData] batchGet 실패(' + e.message + ') → 개별 조회로 폴백');
    _loadPerf.batchGetOk = false;
    _loadPerf.batchGetError = String((e && e.message) || e).substring(0, 300);
    // 접속자 계정에 스프레드시트 승인 범위가 빠져 있으면 화면에 재승인 안내를 띄운다
    if (isPermissionError(_loadPerf.batchGetError)) result._authNotice = buildAuthNotice_();
  }
  _loadPerf.batchGet = Date.now() - tBatch;
  const tParse = Date.now();  // 폴백 시에는 시트별 개별 조회 시간도 여기에 포함된다

  // [폴백 전용] batchGet이 실패했을 때만 채워지는 시트 맵. 성공 시엔 호출되지 않는다.
  const sheetByName = {};
  function ensureSheetMap() {
    if (Object.keys(sheetByName).length === 0) {
      ss.getSheets().forEach(function (sh) { sheetByName[sh.getName()] = sh; });
    }
  }

  TARGET_TABS.forEach(function (tabName) {
    let values;
    if (valuesByTab) {
      values = valuesByTab[tabName] || [];
    } else {
      ensureSheetMap();
      const sheet = sheetByName[tabName];
      if (!sheet) { result[tabName] = []; return; }
      values = sheet.getDataRange().getValues();
    }
    if (values.length < 1) { result[tabName] = []; return; }
    const headers = values[0];
    const data = [];

    // [STEP3] 소프트 삭제된 행을 제외하기 위해 '삭제여부' 컬럼 위치를 찾는다
    const deletedIdx = headers.indexOf('삭제여부');
    // [PERF] 거래 시트는 A~H까지만 내려보낸다 (삭제여부는 필터용으로만 읽고 전송하지 않음)
    const isTxn = TXN_SHEETS.indexOf(tabName) !== -1;
    const colCount = isTxn ? Math.min(headers.length, COL.NOTE) : headers.length;

    // [STEP3] 이 시트에서 날짜로 취급할 컬럼 인덱스 (헤더명 기준)
    const dateColIdxs = [];
    headers.forEach(function (h, idx) { if (DATE_HEADER_NAMES.indexOf(h) !== -1) dateColIdxs.push(idx); });

    for (let i = 1; i < values.length; i++) {
      const row = values[i];
      // [STEP3] 삭제 표시(Y)된 행은 대시보드에 내려보내지 않는다
      if (deletedIdx !== -1 && String(row[deletedIdx]).trim().toUpperCase() === DELETED_FLAG) continue;

      const rowData = {};
      let isEmptyRow = true;

      for (let j = 0; j < colCount; j++) {
        let val = row[j];
        // [STEP2-fix] 스프레드시트 시간대 기준으로 포맷.
        //             스크립트 시간대로 포맷하면 두 시간대가 다를 때 날짜가 하루 밀린다.
        if (val instanceof Date) {
          val = fmtDateCached(val);
        } else if (dateColIdxs.indexOf(j) !== -1 && typeof val === 'number') {
          // batchGet 경로: 날짜 컬럼이 SERIAL_NUMBER(순수 숫자)로 온 경우만 변환.
          //   사용자가 텍스트로 입력한 값(문자열)은 그대로 둔다(기존 동작과 동일).
          // [PERF] 일련번호는 시간대가 없어 Date를 거치지 않고 바로 문자열로 만든다.
          //   (예전엔 Date로 만들었다 다시 포맷해 시간대 조회 1회 + 날짜당 formatDate 2회가 들었다)
          val = serialToYmd(val);
        }
        if (!isBlankCell(val)) isEmptyRow = false;
        rowData[headers[j]] = val;
      }
      // [PERF] _row는 프런트에서 사용처가 없고 정렬 후에는 의미도 없어 전송하지 않는다
      // 거래 시트는 날짜 없는 행을 보내지 않는다 (화면도 buildAllTransactions에서 날짜 없는 행을 버린다)
      if (isTxn && isBlankCell(rowData['날짜'])) continue;
      if (!isEmptyRow) data.push(rowData);
    }
    result[tabName] = data;
  });

  // [퀵등록] '자주 쓰는 항목'은 소분류 단위로 집계하며, 정기 등록분은 제외한다.
  //   그 판별을 위해 정기 시트의 '소분류'(D열) 한 컬럼만 가볍게 읽어 내려보낸다.
  //   성능을 위해 이 시트는 조회 대상(TARGET_TABS)에서 제외돼 있으므로 전체를 읽지 않는다.
  // [PERF] getLastRow + getRange = 왕복 2회였다. getDataRange 1회로 줄인다.
  //   정기 시트는 설정 시트라 행이 적어 전체를 읽어도 부담이 없다.
  result['_정기소분류'] = [];
  let regRows;
  if (valuesByTab) {
    regRows = valuesByTab[REG_TAB] || [];
  } else {
    ensureSheetMap();
    const regSheet = sheetByName[REG_TAB];
    regRows = regSheet ? regSheet.getDataRange().getValues() : [];
  }
  for (let i = 1; i < regRows.length; i++) {
    const sub = String(regRows[i][COL.SUB - 1] || '').trim();  // D열 = 소분류
    if (sub) result['_정기소분류'].push(sub);
  }

  _loadPerf.parse = Date.now() - tParse;
  TARGET_TABS.forEach(function (t) { _loadPerf.rows[t] = (result[t] || []).length; });
  return result;
}

/**
 * [PERF] 일련번호로 행 번호를 찾는다. A열만 읽어 전 컬럼 스캔 비용을 없앤다.
 * 중복 검출을 위해 매칭되는 모든 행을 반환한다.
 */
function findRowsById(sheet, id) {
  // [PERF] 비용은 데이터 양이 아니라 Sheets 왕복 횟수에 비례한다(호출당 약 200~500ms).
  //   getLastRow + getRange 로 2회 부르던 것을 getDataRange 1회로 줄인다.
  //   A열만 필요하지만 왕복 1회가 열 몇 개보다 훨씬 비싸다.
  const values = sheet.getDataRange().getValues();
  const target = String(id);
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][COL.ID - 1]) === target) rows.push(i + 1);
  }
  return rows;
}

/**
 * [PERF] 클라이언트가 전체 재조회 없이 로컬 반영할 수 있도록
 * 프런트의 거래 객체 형태(buildAllTransactions의 결과)와 동일하게 맞춰 반환한다.
 */
function toClientTxn(kind, id, dateStr, main, sub, content, amount, payment, note) {
  return {
    일련번호: String(id), 날짜: dateStr, 대분류: main, 소분류: sub, 내용: content,
    금액: amount, 결제수단: payment, 비고: note, 구분: kind
  };
}

function saveTransaction(entry) {
  try { assertAuthorized(); } catch(e) { return { ok: false, message: e.message }; }
  
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, message: '다른 사용자가 처리 중입니다.' };

  try {
    if (!entry || (entry.구분 !== '지출' && entry.구분 !== '수입')) return { ok: false, message: "구분 오류" };
    
    if (!entry.날짜 || !/^\d{4}-\d{2}-\d{2}$/.test(entry.날짜)) return { ok: false, message: '날짜 형식이 올바르지 않습니다(YYYY-MM-DD).' };
    if (!entry.대분류 || String(entry.대분류).trim() === '' || entry.대분류 === 'undefined') return { ok: false, message: '대분류가 누락되었습니다.' };
    if (!entry.소분류 || String(entry.소분류).trim() === '' || entry.소분류 === 'undefined') return { ok: false, message: '소분류가 누락되었습니다.' };
    if (!entry.결제수단 || String(entry.결제수단).trim() === '' || entry.결제수단 === 'undefined') return { ok: false, message: '결제수단이 누락되었습니다.' };
    
    const rawAmt = Number(entry.금액);
    if (isNaN(rawAmt) || rawAmt <= 0) return { ok: false, message: '금액은 0보다 큰 숫자여야 합니다.' };

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const mainCat = String(entry.대분류).trim();
    const subCat = String(entry.소분류).trim();
    const content = String(entry.내용 || '').trim();
    const payment = String(entry.결제수단).trim();
    const note = String(entry.비고 || '').trim();
    
    const sheetName = entry.구분 === '지출' ? SHEET_LOG : SHEET_INCOME;
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) return { ok: false, message: sheetName + " 탭을 찾을 수 없습니다." };

    const uuid = generateUniqueUuid(sheet);
    const finalAmount = normalizeAmount(entry.구분, entry.금액);
    if (isNaN(finalAmount)) return { ok: false, message: '금액 변환 중 오류가 발생했습니다.' };

    // [STEP2] B열 날짜를 Date 객체로 통일 (문자열/Date 혼용에 의한 정렬 붕괴 방지)
    const dateObj = toDateObject(entry.날짜);
    if (!dateObj) return { ok: false, message: '날짜를 해석할 수 없습니다.' };

    // [STEP2] append 단일 진입점(appendRowsSafely) 사용 - 행 계산 중복 제거 + B열 표시형식 지정
    // [STEP3] 감사 컬럼(입력자/입력시각) 포함
    const row = buildTxnRow({
      id: uuid, date: dateObj, main: mainCat, sub: subCat, content: content,
      amount: finalAmount, payment: payment, note: note, actor: getActor()
    });
    appendRowsSafely(sheet, [row]);

    // [PERF] 저장할 때마다 시트를 전체 정렬하던 호출을 제거했다.
    //   대시보드는 클라이언트에서 정렬하므로 화면과 무관하고, 행 수에 비례해 느려졌다.
    //   시트를 직접 볼 때의 정렬은 [가계부 도구 > 내역 정렬] 메뉴로 수행한다.
    // [PERF] 저장된 행을 그대로 반환해 클라이언트가 전체 재조회 없이 반영하게 한다.
    return { ok: true, txn: toClientTxn(entry.구분, uuid, entry.날짜, mainCat, subCat, content, finalAmount, payment, note) };

  } catch (err) {
    return { ok: false, message: '저장 중 오류: ' + err.message };
  } finally {
    lock.releaseLock();
  }
}

function updateTransaction(entry) {
  try { assertAuthorized(); } catch(e) { return { ok: false, message: e.message }; }
  
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, message: '다른 사용자가 처리 중입니다.' };

  try {
    if (!entry || (entry.구분 !== '지출' && entry.구분 !== '수입')) return { ok: false, message: "구분 오류" };
    if (!entry.일련번호) return { ok: false, message: '수정할 거래를 찾을 수 없습니다.' };
    
    if (!entry.날짜 || !/^\d{4}-\d{2}-\d{2}$/.test(entry.날짜)) return { ok: false, message: '날짜 형식이 올바르지 않습니다(YYYY-MM-DD).' };
    if (!entry.대분류 || String(entry.대분류).trim() === '' || entry.대분류 === 'undefined') return { ok: false, message: '대분류가 누락되었습니다.' };
    if (!entry.소분류 || String(entry.소분류).trim() === '' || entry.소분류 === 'undefined') return { ok: false, message: '소분류가 누락되었습니다.' };
    if (!entry.결제수단 || String(entry.결제수단).trim() === '' || entry.결제수단 === 'undefined') return { ok: false, message: '결제수단이 누락되었습니다.' };
    
    const rawAmt = Number(entry.금액);
    if (isNaN(rawAmt) || rawAmt <= 0) return { ok: false, message: '금액은 0보다 큰 숫자여야 합니다.' };

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheetName = entry.구분 === '지출' ? SHEET_LOG : SHEET_INCOME;
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) return { ok: false, message: sheetName + ' 탭을 찾을 수 없습니다.' };

    // [PERF] 행 하나를 찾자고 전 컬럼을 읽던 getDataRange()를 A열 단독 조회로 바꿨다.
    const targetRows = findRowsById(sheet, entry.일련번호);
    if (targetRows.length === 0) return { ok: false, message: '거래를 찾지 못했습니다.' };
    if (targetRows.length >= 2) return { ok: false, message: '일련번호가 중복되었습니다(' + targetRows.length + '건). 관리자 확인이 필요합니다.' };

    let targetRow = targetRows[0];

    const mainCat = String(entry.대분류).trim();
    const subCat = String(entry.소분류).trim();
    const content = String(entry.내용 || '').trim();
    const payment = String(entry.결제수단).trim();
    const note = String(entry.비고 || '').trim();
    const finalAmount = normalizeAmount(entry.구분, entry.금액);
    if (isNaN(finalAmount)) return { ok: false, message: '금액 변환 중 오류가 발생했습니다.' };

    // [STEP2] B열 날짜를 Date 객체로 통일 (문자열/Date 혼용에 의한 정렬 붕괴 방지)
    const dateObj = toDateObject(entry.날짜);
    if (!dateObj) return { ok: false, message: '날짜를 해석할 수 없습니다.' };

    // A~H만 덮어쓴다. 입력자/입력시각(I/J)은 보존해야 하므로 범위에 포함하지 않는다.
    // 글자 칸은 asText로 감싸 시트가 날짜·숫자·수식으로 해석하지 않게 한다
    const row = [asText(entry.일련번호), dateObj, asText(mainCat), asText(subCat), asText(content), finalAmount, asText(payment), asText(note)];
    sheet.getRange(targetRow, 1, 1, row.length).setValues([row]);
    sheet.getRange(targetRow, COL.DATE).setNumberFormat('yyyy-MM-dd'); // [STEP2] 표시형식 유지
    touchUpdatedAt(sheet, targetRow); // [STEP3] 수정시각만 갱신

    // [PERF] 저장 경로와 같은 이유로 시트 전체 정렬 호출을 제거했다.
    return { ok: true, txn: toClientTxn(entry.구분, entry.일련번호, entry.날짜, mainCat, subCat, content, finalAmount, payment, note) };

  } catch (err) {
    return { ok: false, message: '수정 중 오류: ' + err.message };
  } finally {
    lock.releaseLock();
  }
}

function deleteTransaction(entry) {
  try { assertAuthorized(); } catch(e) { return { ok: false, message: e.message }; } 
  
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, message: '다른 사용자가 처리 중입니다.' };

  try {
    if (!entry || !entry.구분 || !entry.일련번호) return { ok: false, message: '삭제할 정보 부족.' };

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheetName = entry.구분 === '지출' ? SHEET_LOG : SHEET_INCOME;
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) return { ok: false, message: sheetName + ' 탭을 찾을 수 없습니다.' };

    // [PERF] 행 하나를 찾자고 전 컬럼을 읽던 getDataRange()를 A열 단독 조회로 바꿨다.
    const targetRows = findRowsById(sheet, entry.일련번호);
    if (targetRows.length === 0) return { ok: false, message: '삭제할 거래를 찾지 못했습니다.' };
    if (targetRows.length >= 2) return { ok: false, message: '일련번호가 중복되었습니다(' + targetRows.length + '건). 관리자 확인이 필요합니다.' };

    // [STEP3] 소프트 삭제로 전환.
    //   deleteRow는 복구가 불가능하고 다른 시트의 범위 수식을 깨뜨린다.
    //   L열에 'Y'만 기록하고, 30일 지난 행은 purgeDeletedRows()가 실제로 정리한다.
    //   감사 컬럼 마이그레이션 전이라면 기존 동작(행 삭제)으로 폴백한다.
    if (sheet.getLastColumn() >= COL.DELETED) {
      sheet.getRange(targetRows[0], COL.DELETED).setValue(DELETED_FLAG);
      touchUpdatedAt(sheet, targetRows[0]); // 삭제 시각 = 정리 유예 기간 기준
    } else {
      sheet.deleteRow(targetRows[0]);
    }
    // [PERF] 클라이언트가 해당 건만 제거하면 되도록 식별자를 반환한다 (전체 재조회 불필요)
    return { ok: true, removed: { 일련번호: String(entry.일련번호), 구분: entry.구분 } };
  } catch (err) {
    return { ok: false, message: '삭제 중 오류: ' + err.message };
  } finally {
    lock.releaseLock();
  }
}