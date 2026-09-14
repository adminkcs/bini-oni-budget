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

function doGet(e) {
  try {
    assertAuthorized();
  } catch(err) {
    return HtmlService.createHtmlOutput('<div style="padding: 24px; font-family: sans-serif; text-align: center;"><h3>' + err.message + '</h3></div>').setTitle('접근 차단');
  }

  const view = e.parameter.view;
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
    return toSafeJson(getDashboardData());
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
  try { assertAuthorized(); } catch(e) { return { _error: e.message }; } 

  const ss = SpreadsheetApp.getActiveSpreadsheet();
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

  // [PERF] 실측 결과 비용은 데이터 양이 아니라 'Sheets 백엔드 왕복 횟수'에 비례한다.
  //   2행짜리 시트도 0.5초가 걸렸다 (호출 1회당 약 450~550ms).
  //   그래서 호출 수를 최소화한다.
  //     - getSheets() 1회로 전체 시트를 받아 이름으로 매핑 (getSheetByName 반복 제거)
  //     - 시트당 getDataRange().getValues() 단 1회
  //       (이전에는 빈 시트 확인용 getLastRow/getLastColumn까지 불러 시트마다 3회였다.
  //        values.length 로 판별하면 추가 호출이 필요 없다)
  const sheetByName = {};
  ss.getSheets().forEach(function (sh) { sheetByName[sh.getName()] = sh; });

  TARGET_TABS.forEach(function (tabName) {
    const sheet = sheetByName[tabName];
    if (!sheet) { result[tabName] = []; return; }

    const values = sheet.getDataRange().getValues();
    if (values.length < 1) { result[tabName] = []; return; }
    const headers = values[0];
    const data = [];

    // [STEP3] 소프트 삭제된 행을 제외하기 위해 '삭제여부' 컬럼 위치를 찾는다
    const deletedIdx = headers.indexOf('삭제여부');
    // [PERF] 거래 시트는 A~H까지만 내려보낸다 (삭제여부는 필터용으로만 읽고 전송하지 않음)
    const isTxn = TXN_SHEETS.indexOf(tabName) !== -1;
    const colCount = isTxn ? Math.min(headers.length, COL.NOTE) : headers.length;

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
        if (val instanceof Date) val = fmtDateCached(val);
        if (val !== '' && val !== null) isEmptyRow = false;
        rowData[headers[j]] = val;
      }
      // [PERF] _row는 프런트에서 사용처가 없고 정렬 후에는 의미도 없어 전송하지 않는다
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
  const regSheet = sheetByName[SHEET_REGULAR];
  if (regSheet) {
    const regRows = regSheet.getDataRange().getValues();
    for (let i = 1; i < regRows.length; i++) {
      const sub = String(regRows[i][COL.SUB - 1] || '').trim();  // D열 = 소분류
      if (sub) result['_정기소분류'].push(sub);
    }
  }

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
    const row = [entry.일련번호, dateObj, mainCat, subCat, content, finalAmount, payment, note];
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