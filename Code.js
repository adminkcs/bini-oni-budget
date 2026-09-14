/**
 * ==============================================================================
 * ★ 0. 프로젝트 공통 상수 및 날짜 유틸
 * [STEP2] "Asia/Seoul" 하드코딩과 Session.getScriptTimeZone() 혼용을 TZ 상수로 통일.
 *         appsscript.json의 timeZone과 반드시 같은 값을 유지해야 한다.
 * ==============================================================================
 */
var TZ = "Asia/Seoul";

var SHEET_LOG = "가계부_내역";
var SHEET_INCOME = "수입";
var SHEET_REGULAR = "정기_수입지출_설정_및_휴일기준";
var SHEET_CATEGORY = "분류_설정";

var SHEET_RUNLOG = "실행로그";
var SHEET_BUDGET = "예산_설정";   // [STEP3B] 년월 / 대분류 / 예산액

var NOTE_PREFIX_EXPENSE = "정기지출 자동입력";
var NOTE_PREFIX_INCOME = "정기수입 자동입력";
var WEIGHT_HEADER = "정렬가중치";
var TODAY_BG = "#fff2cc";

/**
 * ★ [STEP3] 거래 시트 컬럼 정의 (가계부_내역 / 수입 공통)
 *   A~H는 기존 순서를 그대로 유지하고, 감사·소프트삭제 컬럼만 뒤에 추가한다.
 *   시트에 컬럼을 실제로 만들려면 [가계부 도구 > 1회성 감사 컬럼 추가] 를 실행한다.
 */
var COL = {
  ID: 1, DATE: 2, MAIN: 3, SUB: 4, CONTENT: 5,
  AMOUNT: 6, PAYMENT: 7, NOTE: 8,
  CREATED_BY: 9, CREATED_AT: 10, UPDATED_AT: 11, DELETED: 12
};
var TXN_HEADERS = [
  "일련번호", "날짜", "대분류", "소분류", "내용",
  "금액", "결제수단", "비고",
  "입력자", "입력시각", "수정시각", "삭제여부"
];
var TXN_COL_COUNT = TXN_HEADERS.length; // 12
var SYSTEM_ACTOR = "SYSTEM";            // 정기 자동입력의 입력자 표기
var DELETED_FLAG = "Y";
var PURGE_AFTER_DAYS = 30;              // 소프트 삭제 행의 실제 정리 유예 기간

/**
 * ★ 시트↔Date 변환의 기준 시간대
 * [STEP2-fix] 스프레드시트 시간대와 스크립트 시간대(TZ)가 다르면 날짜가 하루 밀린다.
 *   Apps Script의 new Date(y,m,d)는 '스크립트' 시간대 자정을 만들지만,
 *   그 값이 셀에 저장될 때는 '스프레드시트' 시간대로 환산되기 때문이다.
 *   (실제 사례: 스크립트 Asia/Seoul(+9) + 시트 태평양 서머타임(-7) = 16시간 차 ->
 *    2026-09-11 00:00 요청이 2026-09-10 08:00 으로 저장됨)
 *   따라서 모든 날짜 변환은 '스프레드시트 시간대'를 기준으로 한다.
 */
var _sheetTzCache = null;
function getSheetTz() {
  if (_sheetTzCache) return _sheetTzCache;
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    _sheetTzCache = ss ? ss.getSpreadsheetTimeZone() : TZ;
    if (_sheetTzCache && _sheetTzCache !== TZ) {
      Logger.log("[경고] 스프레드시트 시간대(" + _sheetTzCache + ")가 스크립트 시간대(" + TZ +
                 ")와 다릅니다. 날짜는 스프레드시트 시간대 기준으로 처리하지만, " +
                 "파일 > 설정 > 시간대를 '" + TZ + "'로 맞추는 것을 권장합니다.");
    }
  } catch (e) {
    _sheetTzCache = TZ;
  }
  return _sheetTzCache || TZ;
}

/**
 * 특정 시점의 해당 시간대 UTC 오프셋(분). 서머타임이 반영된 실효 오프셋을 반환한다.
 */
function getTzOffsetMinutes(instant, tz) {
  var z = Utilities.formatDate(instant, tz, "Z"); // 예: "+0900", "-0700"
  var sign = z.charAt(0) === '-' ? -1 : 1;
  return sign * (Number(z.substr(1, 2)) * 60 + Number(z.substr(3, 2)));
}

/**
 * 날짜 값을 "yyyy-MM-dd" 문자열로 변환 (스프레드시트 시간대 기준)
 * [STEP2] Date 객체와 문자열이 섞여 있어도 동일한 키로 비교할 수 있게 한다.
 */
function fmtDate(v) {
  if (!v) return "";
  if (v instanceof Date) return Utilities.formatDate(v, getSheetTz(), "yyyy-MM-dd");
  var m = String(v).trim().match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : String(v).trim();
}

/**
 * "yyyy-MM-dd" 문자열을 '스프레드시트 시간대의 그날 00:00'에 해당하는 Date 객체로 변환
 * [STEP2-fix] new Date(y,m,d)는 스크립트 시간대 자정이라 시트 시간대와 다르면 날짜가 밀린다.
 *   UTC 자정을 기준으로 시트 시간대의 실효 오프셋만큼 보정해, 시트에 저장했을 때
 *   정확히 의도한 날짜의 자정이 되도록 만든다. (시간대가 같든 다르든 항상 안전)
 */
function toDateObject(v) {
  if (v instanceof Date) return v;
  var m = String(v).trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return null;
  var tz = getSheetTz();
  var utcMidnight = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0);
  var offsetMin = getTzOffsetMinutes(new Date(utcMidnight), tz);
  return new Date(utcMidnight - offsetMin * 60000);
}

/**
 * 오늘(스프레드시트 시간대 기준) 정보 일괄 반환
 */
function getTodayInfo() {
  var tz = getSheetTz();
  var now = new Date();
  var dateStr = Utilities.formatDate(now, tz, "yyyy-MM-dd");
  var parts = dateStr.split("-");
  var year = Number(parts[0]), month = Number(parts[1]), day = Number(parts[2]);
  var fullDayNames = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];
  var dowIndex = parseInt(Utilities.formatDate(now, tz, "u"), 10) % 7;
  return {
    year: year,
    month: month,
    day: day,
    dateStr: dateStr,
    dateObj: toDateObject(dateStr),
    fullDay: fullDayNames[dowIndex],
    lastDayOfMonth: new Date(Date.UTC(year, month, 0)).getUTCDate()
  };
}

/**
 * ==============================================================================
 * ★ 공통 헬퍼: 금액 부호 통일 (지출은 음수, 수입은 양수)
 * ==============================================================================
 */
function normalizeAmount(type, amount) {
  if (amount === null || amount === undefined || String(amount).trim() === '') return NaN;
  var num = Number(amount);
  if (isNaN(num)) return NaN;
  var absAmt = Math.abs(num);
  return type === '수입' ? absAmt : -absAmt;
}

/**
 * ==============================================================================
 * ★ 공통 헬퍼: 안전한 UUID 생성 (중복 체크)
 * ==============================================================================
 */
function generateUniqueUuid(sheet) {
  // [PERF] 저장할 때마다 A열 전체를 읽어 중복을 확인하던 로직을 제거했다.
  //   길이를 8 -> 12자로 늘리면 48비트가 되어 수백만 행에서도 충돌 확률이 무시 가능하고,
  //   만에 하나를 대비한 사후 검사(checkAndFixDuplicateUUIDs) 메뉴도 이미 있다.
  //   기존 8자 ID와 섞여도 문제되지 않는다(길이만 다른 문자열).
  return Utilities.getUuid().replace(/-/g, '').substring(0, 12);
}

/**
 * ==============================================================================
 * ★ 공통 헬퍼: 시트 하단 행 추가 (append 단일 진입점)
 * [STEP2] getLastRow()+1 계산이 여러 곳에 흩어져 있어 동시 실행 시 같은 행을
 *         가리켜 덮어쓰는 위험이 있었다. 호출자는 반드시 LockService 락을
 *         점유한 상태에서 호출해야 한다. B열 표시형식도 여기서 일괄 지정한다.
 * ==============================================================================
 */
function appendRowsSafely(sheet, rows) {
  if (!sheet || !rows || rows.length === 0) return 0;

  // [STEP3] 감사 컬럼 마이그레이션 전 시트에는 A~H만 기록한다.
  //         마이그레이션을 잊어도 헤더 없는 열에 값이 흘러들어가지 않도록 방어.
  var headerWidth = sheet.getLastColumn();
  if (headerWidth > 0 && headerWidth < rows[0].length) {
    rows = rows.map(function (r) { return r.slice(0, headerWidth); });
  }

  var startRow = sheet.getLastRow() + 1;
  sheet.getRange(startRow, 1, rows.length, rows[0].length).setValues(rows);
  // [PERF] 행마다 setNumberFormat을 2번 호출하던 것을 제거했다.
  //   표시형식은 ensureTxnColumnFormats()가 열 전체에 한 번 지정하므로 새 행이 자동으로 상속한다.
  return rows.length;
}

/**
 * ==============================================================================
 * ★ [STEP3] 감사(Audit) 유틸
 * 누가 언제 넣고 고쳤는지 남긴다. 부부 공동 사용이라 입력 주체 기록이 필요하다.
 * ==============================================================================
 */

/** 현재 조작 주체. 식별 불가 시 UNKNOWN (배포 설정에 따라 빈 문자열이 올 수 있음) */
function getActor() {
  // [PERF] 권한 검사에서 이미 조회한 이메일을 재사용한다 (실행당 Session 호출 1회)
  try {
    var email = (typeof getCurrentEmail === 'function')
      ? getCurrentEmail()
      : Session.getActiveUser().getEmail();
    return email ? email : "UNKNOWN";
  } catch (e) {
    return "UNKNOWN";
  }
}

/** 감사 컬럼까지 채운 거래 행 배열을 만든다 (길이 TXN_COL_COUNT) */
function buildTxnRow(opts) {
  var row = new Array(TXN_COL_COUNT).fill("");
  row[COL.ID - 1] = opts.id;
  row[COL.DATE - 1] = opts.date;
  row[COL.MAIN - 1] = opts.main;
  row[COL.SUB - 1] = opts.sub;
  row[COL.CONTENT - 1] = opts.content;
  row[COL.AMOUNT - 1] = opts.amount;
  row[COL.PAYMENT - 1] = opts.payment;
  row[COL.NOTE - 1] = opts.note;
  row[COL.CREATED_BY - 1] = opts.actor;
  row[COL.CREATED_AT - 1] = opts.at || new Date();
  row[COL.UPDATED_AT - 1] = "";
  row[COL.DELETED - 1] = "";
  return row;
}

/** 수정 시 감사 컬럼(수정시각)만 갱신한다. 입력자/입력시각은 보존한다. */
function touchUpdatedAt(sheet, rowIndex) {
  if (!sheet || sheet.getLastColumn() < COL.UPDATED_AT) return; // 마이그레이션 전이면 건너뜀
  var cell = sheet.getRange(rowIndex, COL.UPDATED_AT);
  cell.setValue(new Date());
  cell.setNumberFormat("yyyy-MM-dd HH:mm:ss");
}

/**
 * ==============================================================================
 * ★ [STEP3] 실행 로그 기록
 * 트리거가 며칠째 실패해도 아무도 모르던 문제를 막는다.
 * ==============================================================================
 */
function logRun(functionName, result, count, message) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_RUNLOG);
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_RUNLOG);
      sheet.getRange(1, 1, 1, 5).setValues([["실행시각", "함수명", "결과", "처리건수", "메시지"]]);
      sheet.setFrozenRows(1);
    }
    sheet.appendRow([new Date(), functionName, result, count, String(message || "").substring(0, 500)]);
    sheet.getRange(sheet.getLastRow(), 1).setNumberFormat("yyyy-MM-dd HH:mm:ss");

    // 로그 시트가 무한히 커지지 않도록 최근 500건만 유지
    var maxRows = 501;
    if (sheet.getLastRow() > maxRows) {
      sheet.deleteRows(2, sheet.getLastRow() - maxRows);
    }
  } catch (e) {
    Logger.log("[실행로그 기록 실패] " + e.message);
  }
}

/** 관리자 이메일 (Script Property ADMIN_EMAIL 우선, 없으면 ALLOWED_USERS 첫 번째) */
function getAdminEmail() {
  try {
    var props = PropertiesService.getScriptProperties();
    var direct = props.getProperty('ADMIN_EMAIL');
    if (direct) return direct;
    var allowed = JSON.parse(props.getProperty('ALLOWED_USERS') || '[]');
    return allowed.length > 0 ? allowed[0] : "";
  } catch (e) {
    return "";
  }
}

/** 트리거 실패를 메일로 알린다. 알림 실패가 본 작업을 막지 않도록 예외를 삼킨다. */
function notifyFailure(functionName, err) {
  var to = getAdminEmail();
  Logger.log("[실패] " + functionName + " : " + (err && err.message ? err.message : err));
  if (!to) return;
  try {
    MailApp.sendEmail({
      to: to,
      subject: "[가계부] " + functionName + " 실행 실패",
      body: "함수: " + functionName + "\n" +
            "시각: " + Utilities.formatDate(new Date(), getSheetTz(), "yyyy-MM-dd HH:mm:ss") + "\n" +
            "오류: " + (err && err.message ? err.message : String(err)) + "\n\n" +
            "스택:\n" + (err && err.stack ? err.stack : "(없음)") + "\n\n" +
            "스프레드시트: " + SpreadsheetApp.getActiveSpreadsheet().getUrl()
    });
  } catch (e) {
    Logger.log("[알림 메일 발송 실패] " + e.message);
  }
}

/**
 * ==============================================================================
 * ★ 정기 항목 실행 조건 판정
 * [STEP2] 말일 처리 규칙 확정:
 *   - 지정일 칸에 "말일" 입력 -> 매월 마지막 날 실행
 *   - 지정일이 29/30/31인데 해당 월에 그 날짜가 없으면 -> 그 달의 말일에 실행
 *     (건너뛰지 않는다. 월세/카드대금이 짧은 달에 누락되면 안 되고,
 *      은행 자동이체도 관례상 말일에 집행된다)
 *   - "요일"이 포함되면 기존과 동일하게 요일 기준으로만 판정한다
 *     (일자와 혼재해도 기존 동작을 그대로 유지)
 * ※ 휴일/공휴일 보정은 이번 범위에서 제외. CalendarApp을 사용하지 않으며
 *   정기 설정 시트의 휴일 관련 컬럼은 읽지 않는다.
 * ==============================================================================
 */
function matchesRegularSchedule(targetSetting, today) {
  if (targetSetting === null || targetSetting === undefined) return false;
  var str = String(targetSetting).trim();
  if (str === "") return false;

  // 요일 지정이 있으면 요일로만 판정 (기존 동작 유지)
  if (str.indexOf("요일") !== -1) {
    return str.indexOf(today.fullDay) !== -1;
  }

  // "말일" 키워드
  if (str.indexOf("말일") !== -1) {
    return today.day === today.lastDayOfMonth;
  }

  var nums = str.match(/\d+/g);
  if (!nums) return false;
  for (var i = 0; i < nums.length; i++) {
    var d = parseInt(nums[i], 10);
    if (isNaN(d) || d < 1 || d > 31) continue;
    if (d === today.day) return true;
    // 말일 보정: 지정일이 이 달에 존재하지 않으면 말일에 실행
    if (d > today.lastDayOfMonth && today.day === today.lastDayOfMonth) return true;
  }
  return false;
}

/**
 * 정기 설정 시트 정렬용 가중치 계산
 * 오늘 실행 대상(-1000) -> 일자 지정(1~31) -> 말일(32) -> 요일(101~107) -> 기타(900) -> 미설정(999)
 */
function getRegularSortWeight(targetSetting, today) {
  if (matchesRegularSchedule(targetSetting, today)) return -1000;
  if (targetSetting === null || targetSetting === undefined) return 999;
  var str = String(targetSetting).trim();
  if (str === "") return 999;

  if (str.indexOf("요일") === -1) {
    if (str.indexOf("말일") !== -1) return 32;
    var nums = str.match(/\d+/g);
    if (nums) {
      var n = parseInt(nums[0], 10);
      if (!isNaN(n)) return n;
    }
  }

  var dayWeight = {
    "월요일": 101, "화요일": 102, "수요일": 103, "목요일": 104,
    "금요일": 105, "토요일": 106, "일요일": 107,
    "월": 101, "화": 102, "수": 103, "목": 104, "금": 105, "토": 106, "일": 107
  };
  var earliestPos = -1, matchedWeight = 900;
  for (var day in dayWeight) {
    var pos = str.indexOf(day);
    if (pos !== -1 && (earliestPos === -1 || pos < earliestPos)) {
      earliestPos = pos;
      matchedWeight = dayWeight[day];
    }
  }
  return earliestPos === -1 ? 900 : matchedWeight;
}

/**
 * ==============================================================================
 * ★ 멱등성 키 수집 (같은 날 같은 정기항목 재입력 방지)
 * [STEP2] 트리거 재시도나 수동 재실행 시 중복 입력되던 문제를 막는다.
 *   - 신규 형식: 비고 "정기지출 자동입력#<정기항목ID>" -> "날짜|ID" 키
 *   - 구 형식:   비고 "정기지출 자동입력" (ID 없음)    -> "날짜|~내용" 키로 보완
 *     (형식 변경 직후 첫 실행에서 기존 입력분이 중복되지 않게 하는 하위호환 처리)
 * ==============================================================================
 */
function buildRegularDoneKeys(sheet, todayStr) {
  var keys = {};
  if (!sheet) return keys;
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return keys;

  var values = sheet.getRange(2, 1, lastRow - 1, 8).getValues();
  for (var i = 0; i < values.length; i++) {
    var note = String(values[i][7] || "");
    if (note.indexOf(NOTE_PREFIX_EXPENSE) !== 0 && note.indexOf(NOTE_PREFIX_INCOME) !== 0) continue;
    var dStr = fmtDate(values[i][1]);
    if (dStr !== todayStr) continue;

    var hashPos = note.indexOf("#");
    if (hashPos !== -1) {
      keys[dStr + "|" + note.substring(hashPos + 1).trim()] = true;
    }
    keys[dStr + "|~" + String(values[i][4] || "").trim()] = true;
  }
  return keys;
}

/**
 * ==============================================================================
 * ★ 1. 매일 자동 이체 및 주 단위 정기 결제 자동 기입 함수
 * [STEP2] 변경점
 *   - LockService 락 적용 (대시보드 저장과 겹칠 때 덮어쓰기 방지)
 *   - 말일 처리 및 "말일" 키워드 지원
 *   - 멱등성 확보 (오늘 이미 입력된 항목은 건너뜀)
 *   - B열에 Date 객체 기록 (문자열/Date 혼용으로 인한 정렬 붕괴 해소)
 *   - 배경색 직접 칠하기 제거 -> 조건부서식으로 대체 (sortRegularSheet)
 * ==============================================================================
 */
function insertRegularExpenses() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    Logger.log("[정기입력] 다른 작업이 실행 중이어서 중단합니다.");
    return;
  }

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var regularSheet = ss.getSheetByName(SHEET_REGULAR);
    var categorySheet = ss.getSheetByName(SHEET_CATEGORY);
    var logSheet = ss.getSheetByName(SHEET_LOG);
    var incomeSheet = ss.getSheetByName(SHEET_INCOME);

    if (!regularSheet || !categorySheet || !logSheet || !incomeSheet) {
      Logger.log("[오류] 필수 시트를 찾을 수 없어 스크립트를 종료합니다.");
      return;
    }

    var today = getTodayInfo();

    // 소분류 -> 대분류 매핑 (먼저 정의된 것을 유지해 뒤에서 덮어쓰지 않음)
    var catData = categorySheet.getDataRange().getValues();
    var catMap = {};
    for (var i = 1; i < catData.length; i++) {
      var mc = catData[i][0], sc = catData[i][1];
      if (sc && !catMap[sc]) catMap[sc] = mc;
    }

    var doneExpense = buildRegularDoneKeys(logSheet, today.dateStr);
    var doneIncome = buildRegularDoneKeys(incomeSheet, today.dateStr);

    var regData = regularSheet.getDataRange().getValues();
    var expRows = [], incRows = [];
    var skippedDup = 0, skippedAmt = 0;

    for (var r = 1; r < regData.length; r++) {
      var regId = String(regData[r][0] || "").trim();
      var itemName = regData[r][1];
      var type = regData[r][2];
      var subCategory = regData[r][3];
      var targetSetting = regData[r][4];
      var amount = regData[r][5];
      var payment = regData[r][6];

      if (!matchesRegularSchedule(targetSetting, today)) continue;

      var isIncome = (type === '수입');
      var finalAmount = normalizeAmount(isIncome ? '수입' : '지출', amount);
      if (isNaN(finalAmount)) {
        Logger.log("[경고] 금액이 올바르지 않아 건너뜁니다. 항목명: " + itemName);
        skippedAmt++;
        continue;
      }

      // 멱등성 검사
      var keys = isIncome ? doneIncome : doneExpense;
      var idKey = today.dateStr + "|" + regId;
      var nameKey = today.dateStr + "|~" + String(itemName || "").trim();
      if ((regId && keys[idKey]) || keys[nameKey]) {
        Logger.log("[건너뜀] 오늘 이미 입력된 정기 항목: " + itemName);
        skippedDup++;
        continue;
      }

      var prefix = isIncome ? NOTE_PREFIX_INCOME : NOTE_PREFIX_EXPENSE;
      var noteText = regId ? (prefix + "#" + regId) : prefix;
      var mainCat = catMap[subCategory] ? catMap[subCategory] : type;
      var subCat = subCategory ? subCategory : "기타";
      var targetSheet = isIncome ? incomeSheet : logSheet;

      // [STEP3] 감사 컬럼 포함. 자동입력이므로 입력자는 SYSTEM으로 기록한다.
      var newRow = buildTxnRow({
        id: generateUniqueUuid(targetSheet),
        date: today.dateObj,
        main: mainCat,
        sub: subCat,
        content: itemName,
        amount: finalAmount,
        payment: payment,
        note: noteText,
        actor: SYSTEM_ACTOR
      });
      if (isIncome) incRows.push(newRow); else expRows.push(newRow);

      // 같은 실행 안에서의 중복도 차단
      if (regId) keys[idKey] = true;
      keys[nameKey] = true;
    }

    var added = appendRowsSafely(logSheet, expRows) + appendRowsSafely(incomeSheet, incRows);
    if (expRows.length > 0) sortLogSheetByDate();

    SpreadsheetApp.flush();
    sortRegularSheet(regularSheet);

    var summary = "추가 " + added + "건 (지출 " + expRows.length +
                  " / 수입 " + incRows.length + "), 중복 건너뜀 " + skippedDup +
                  "건, 금액오류 건너뜀 " + skippedAmt + "건";
    Logger.log("[정기입력] " + summary);
    logRun("insertRegularExpenses", "성공", added, summary); // [STEP3] 실행 로그

  } catch (err) {
    // [STEP3] 트리거가 조용히 실패하지 않도록 로그 시트 기록 + 관리자 메일 알림
    logRun("insertRegularExpenses", "실패", 0, err && err.message ? err.message : String(err));
    notifyFailure("insertRegularExpenses", err);
  } finally {
    lock.releaseLock();
  }
}

/**
 * ==============================================================================
 * ★ 정기 설정 시트 정렬
 * [STEP2] 기존에는 setValues/setBackgrounds로 값과 배경색만 옮겨서
 *         데이터 유효성 검사(드롭다운)·숫자 서식·메모·수식이 따라가지 않았고,
 *         몇 번 정렬하면 값과 드롭다운이 어긋났다.
 *
 *         해결 방식 (a) 채택 — '정렬가중치' 보조 컬럼에 가중치를 기록하고
 *         Range.sort()로 시트 자체를 정렬한다. Range.sort()는 행 단위로
 *         서식·유효성·메모를 함께 이동시키므로 유실이 발생하지 않는다.
 *         (b) 필터뷰 방식은 사용자가 뷰를 바꾸면 정렬이 보이지 않아 제외했다.
 *
 *         오늘 실행 항목 표시(#fff2cc)는 셀에 직접 칠하지 않고 조건부서식으로
 *         대체해, 정렬 후에도 색과 행이 어긋나지 않게 한다.
 * ==============================================================================
 */
function sortRegularSheet(sheet) {
  if (!sheet) return;
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return;

  var today = getTodayInfo();
  var weightCol = ensureWeightColumn(sheet);

  // 과거 방식으로 셀에 직접 칠해진 #fff2cc 제거 (조건부서식으로 대체됨)
  var dataRange = sheet.getRange(2, 1, lastRow - 1, weightCol);
  var bgs = dataRange.getBackgrounds();
  var bgChanged = false;
  for (var r = 0; r < bgs.length; r++) {
    for (var c = 0; c < bgs[r].length; c++) {
      if (String(bgs[r][c]).toLowerCase() === TODAY_BG) { bgs[r][c] = null; bgChanged = true; }
    }
  }
  if (bgChanged) dataRange.setBackgrounds(bgs);

  // E열(지정일) 기준 가중치 기록
  var settings = sheet.getRange(2, 5, lastRow - 1, 1).getValues();
  var weights = [];
  for (var i = 0; i < settings.length; i++) {
    weights.push([getRegularSortWeight(settings[i][0], today)]);
  }
  sheet.getRange(2, weightCol, weights.length, 1).setValues(weights);

  // 시트 자체 정렬 (서식/유효성/메모 동반 이동)
  sheet.getRange(2, 1, lastRow - 1, weightCol).sort({ column: weightCol, ascending: true });

  applyTodayHighlightRule(sheet, weightCol);
}

/**
 * '정렬가중치' 보조 컬럼을 확보한다 (없으면 마지막 열 뒤에 생성 후 숨김).
 * 기존 컬럼 순서는 건드리지 않는다.
 */
function ensureWeightColumn(sheet) {
  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  for (var c = 0; c < headers.length; c++) {
    if (String(headers[c]).trim() === WEIGHT_HEADER) return c + 1;
  }
  var col = lastCol + 1;
  sheet.getRange(1, col).setValue(WEIGHT_HEADER);
  sheet.hideColumns(col);
  return col;
}

/**
 * 오늘 실행 항목(가중치 -1000) 행을 조건부서식으로 강조한다. 중복 규칙 누적을 방지한다.
 */
function applyTodayHighlightRule(sheet, weightCol) {
  var letter = columnToLetter(weightCol);
  var formula = '=$' + letter + '2=-1000';
  var maxRows = sheet.getMaxRows();
  if (maxRows < 2) return;

  var rule = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied(formula)
    .setBackground(TODAY_BG)
    .setRanges([sheet.getRange(2, 1, maxRows - 1, weightCol)])
    .build();

  var kept = [];
  var existing = sheet.getConditionalFormatRules();
  for (var i = 0; i < existing.length; i++) {
    var bc = existing[i].getBooleanCondition();
    var isOurs = false;
    if (bc && bc.getCriteriaType() === SpreadsheetApp.BooleanCriteria.CUSTOM_FORMULA) {
      var vals = bc.getCriteriaValues();
      if (vals && vals.length > 0 && String(vals[0]).indexOf('=-1000') !== -1) isOurs = true;
    }
    if (!isOurs) kept.push(existing[i]);
  }
  kept.push(rule);
  sheet.setConditionalFormatRules(kept);
}

function columnToLetter(col) {
  var s = "";
  while (col > 0) {
    var m = (col - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    col = Math.floor((col - m) / 26);
  }
  return s;
}

/**
 * ==============================================================================
 * ★ 2. 사용자 셀 수정 시 자동 실행 이벤트 트리거 (onEdit)
 * [STEP2] 셀을 편집할 때마다 전체 시트를 재정렬하면 입력 중인 행이 화면에서
 *         사라지는 문제가 있어 자동 정렬 호출을 제거했다.
 *         정렬은 onOpen 커스텀 메뉴 [가계부 도구 > 내역 정렬]에서 수동 실행한다.
 * ==============================================================================
 */
function onEdit(e) {
  if (!e || !e.range) return;
  var sheet = e.range.getSheet();
  var startRow = e.range.getRow();
  var startCol = e.range.getColumn();
  var numRows = e.range.getNumRows();
  var numCols = e.range.getNumColumns();
  var sheetName = sheet.getName();
  if (startRow <= 1) return;
  var endCol = startCol + numCols - 1;

  if (sheetName !== SHEET_LOG && sheetName !== SHEET_INCOME && sheetName !== SHEET_REGULAR) return;
  if (startCol > 8 || endCol < 2) return;

  if (numRows > 200) {
    SpreadsheetApp.getActiveSpreadsheet().toast("처리 대상이 200행을 초과하여 ID 자동 부여를 중단합니다.");
    return;
  }

  var idRange = sheet.getRange(startRow, 1, numRows, 1);
  var currentIds = idRange.getValues();
  var needsIdGeneration = false;

  // 빈칸이 1개라도 있을 때만 A열 전체 읽기 수행 (불필요한 스캔 방지)
  for (var r = 0; r < numRows; r++) {
    if (!currentIds[r][0] || String(currentIds[r][0]).trim() === "") {
      needsIdGeneration = true;
      break;
    }
  }
  if (!needsIdGeneration) return;

  var existingIds = new Set();
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().forEach(function (row) {
      if (row[0]) existingIds.add(String(row[0]));
    });
  }

  var hasUpdates = false;
  for (var r2 = 0; r2 < numRows; r2++) {
    if (!currentIds[r2][0] || String(currentIds[r2][0]).trim() === "") {
      var newUuid = Utilities.getUuid().substring(0, 8);
      while (existingIds.has(newUuid)) {
        newUuid = Utilities.getUuid().substring(0, 8);
      }
      currentIds[r2][0] = newUuid;
      existingIds.add(newUuid);
      hasUpdates = true;
    }
  }
  if (hasUpdates) idRange.setValues(currentIds);
}

/**
 * ==============================================================================
 * ★ 3. 가계부 내역 정렬
 * [STEP2] 날짜 내림차순 + 동일 날짜는 일련번호 오름차순의 2차 정렬키를 적용해
 *         같은 날 여러 건의 순서가 실행마다 뒤바뀌지 않게 안정화했다.
 * ==============================================================================
 */
function sortLogSheetByDate() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var logSheet = ss.getSheetByName(SHEET_LOG);
  if (!logSheet) return;
  var lastRow = logSheet.getLastRow();
  if (lastRow <= 1) return;
  logSheet.getRange(2, 1, lastRow - 1, logSheet.getLastColumn())
    .sort([{ column: 2, ascending: false }, { column: 1, ascending: true }]);
}

/**
 * ==============================================================================
 * ★ [PERF] 스케줄 정렬 (매시간)
 * 저장/수정마다 시트를 전체 정렬하면 행 수에 비례해 느려져 저장 경로에서 제거했다.
 * 대신 1시간에 한 번 정렬해 시트를 직접 볼 때의 가독성을 유지한다.
 * 사용자 저장과 겹치지 않도록 락을 잡고, 잡히지 않으면 다음 시간에 다시 시도한다.
 * (매시간 실행이라 성공 로그는 남기지 않는다. 실행로그가 이 건으로 가득 차지 않게.)
 * ==============================================================================
 */
function scheduledSortLogSheet() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    Logger.log("[정렬] 다른 작업 실행 중이라 건너뜁니다. 다음 시간에 재시도합니다.");
    return;
  }
  try {
    sortLogSheetByDate();
  } catch (e) {
    logRun("scheduledSortLogSheet", "실패", 0, e && e.message ? e.message : String(e));
    notifyFailure("scheduledSortLogSheet", e);
  } finally {
    lock.releaseLock();
  }
}

/**
 * ==============================================================================
 * ★ (신규) 스프레드시트 커스텀 메뉴
 * [STEP2] onEdit 자동 정렬을 제거한 대신 수동 실행 경로를 제공한다.
 *         아카이빙/마이그레이션 함수들도 여기서만 실행되도록 모아두었다.
 * ==============================================================================
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('가계부 도구')
    .addItem('내역 정렬', 'sortLogSheetByDate')
    .addItem('정기 항목 수동 실행', 'insertRegularExpenses')
    .addItem('중복 일련번호 검사', 'checkAndFixDuplicateUUIDs')
    .addItem('분류 설정 점검', 'validateCategorySheet')
    .addItem('예산 시트 만들기', 'ensureBudgetSheet')           // [STEP3B]
    .addItem('스크립트 속성 점검', 'setupScriptProperties')      // 민감값을 코드에서 뺀 뒤 상태 확인용
    .addSeparator()
    .addItem('삭제 대기 행 정리', 'purgeDeletedRows')          // [STEP3] 소프트 삭제 정리
    .addItem('트리거 설치/재설치', 'installTriggers')          // [STEP3] 배포 재현성
    .addSeparator()
    .addItem('[1회성] 감사 컬럼 추가', 'migrateAddAuditColumns') // [STEP3]
    .addItem('[1회성] 날짜 타입 정규화', 'normalizeExistingDates')
    .addItem('[1회성] 금액 부호 정규화', 'fixExistingAmountSigns')
    .addSeparator()
    .addItem('[주의] 과거 데이터 이관', 'archiveOldTransactions')
    .addToUi();
}

/**
 * ==============================================================================
 * ★ (1회성) B열 날짜를 문자열 -> Date 객체로 일괄 변환
 * [STEP2] 자동입력은 문자열, 수동입력은 Date가 섞여 range.sort()가 타입별로
 *         분리 정렬되어 순서가 깨지던 문제의 근본 해소용 마이그레이션.
 *         수식 셀은 건드리지 않고, 변환 건수를 로그로 남긴다.
 * ==============================================================================
 */
function normalizeExistingDates() {
  var ui = null;
  try {
    ui = SpreadsheetApp.getUi();
    var res = ui.alert('날짜 타입 정규화',
      'B열의 문자열 날짜를 Date 객체로 일괄 변환합니다.\n\n' +
      '실행 전 백업을 권장합니다. ([일일백업]은 매일 자동 생성됩니다)\n\n진행하시겠습니까?',
      ui.ButtonSet.YES_NO);
    if (res !== ui.Button.YES) return;
  } catch (e) {
    Logger.log("메뉴에서 실행해 주세요 (트리거 환경 차단).");
    return;
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var targets = [SHEET_LOG, SHEET_INCOME, '가계부_내역_보관함', '수입_보관함'];
  var total = 0, skippedFormula = 0, skippedBad = 0;
  var report = [];

  for (var t = 0; t < targets.length; t++) {
    var sheet = ss.getSheetByName(targets[t]);
    if (!sheet || sheet.getLastRow() <= 1) continue;

    var range = sheet.getRange(2, 2, sheet.getLastRow() - 1, 1);
    var formulas = range.getFormulas();
    var values = range.getValues();
    var changed = 0;

    for (var i = 0; i < values.length; i++) {
      if (formulas[i][0] !== '') { skippedFormula++; continue; }
      var v = values[i][0];
      if (v instanceof Date) continue;
      if (v === '' || v === null) continue;

      var d = toDateObject(v);
      if (!d) {
        Logger.log("[" + targets[t] + "] " + (i + 2) + "행 날짜를 해석할 수 없습니다: " + v);
        skippedBad++;
        continue;
      }
      values[i][0] = d;
      changed++;
    }

    if (changed > 0) {
      range.setValues(values);
      range.setNumberFormat("yyyy-MM-dd");
      total += changed;
    }
    report.push(targets[t] + ": " + changed + "건");
  }

  var msg = "날짜 타입 정규화 완료. 총 " + total + "건 변환\n" + report.join("\n") +
            "\n\n수식 셀 건너뜀: " + skippedFormula + "건\n해석 실패 건너뜀: " + skippedBad + "건";
  Logger.log(msg);
  if (ui) ui.alert("완료", msg, ui.ButtonSet.OK);
}

/**
 * ==============================================================================
 * ★ (신규) 분류_설정 시트 점검 — 중복 소분류 탐지
 * [STEP2] 같은 소분류명이 서로 다른 대분류에 존재하면 소분류->대분류 매핑이
 *         마지막 값으로 덮어써져 잘못된 대분류로 기록된다.
 *         코드 쪽은 '먼저 정의된 매핑 유지'로 바꿨고, 이 함수로 원인을 찾는다.
 * ==============================================================================
 */
function validateCategorySheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_CATEGORY);
  var ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch (e) { ui = null; }

  if (!sheet || sheet.getLastRow() <= 1) {
    Logger.log("[점검] 분류_설정 시트가 없거나 비어 있습니다.");
    if (ui) ui.alert("점검 결과", "분류_설정 시트가 없거나 비어 있습니다.", ui.ButtonSet.OK);
    return;
  }

  var data = sheet.getDataRange().getValues();
  var seen = {};      // 소분류 -> { main, row }
  var dups = [];

  for (var i = 1; i < data.length; i++) {
    var main = String(data[i][0] || "").trim();
    var sub = String(data[i][1] || "").trim();
    if (!sub) continue;

    if (seen[sub] && seen[sub].main !== main) {
      dups.push("· '" + sub + "' : [" + seen[sub].main + "] " + seen[sub].row +
                "행  vs  [" + main + "] " + (i + 1) + "행");
    } else if (!seen[sub]) {
      seen[sub] = { main: main, row: i + 1 };
    }
  }

  var msg;
  if (dups.length === 0) {
    msg = "중복 소분류가 없습니다. (소분류 " + Object.keys(seen).length + "개 확인)";
  } else {
    msg = "서로 다른 대분류에 같은 소분류가 " + dups.length + "건 있습니다.\n" +
          "매핑이 먼저 정의된 쪽으로 고정되므로 정리가 필요합니다.\n\n" + dups.join("\n");
  }
  Logger.log("[점검] " + msg);
  if (ui) ui.alert("분류 설정 점검", msg, ui.ButtonSet.OK);
}

// [회귀수정] 이관전용 백업 함수 생성 (일일/주간 백업 정책과 격리)

/**
 * ==============================================================================
 * ★ [PERF] 거래 시트의 표시형식을 '열 전체'에 한 번 지정한다.
 * 새로 추가되는 행이 서식을 상속하므로 저장 경로에서 setNumberFormat을 호출하지 않아도 된다.
 * 여러 번 실행해도 안전하다.
 * ==============================================================================
 */
function ensureTxnColumnFormats(sheet) {
  if (!sheet) return;
  var maxRows = sheet.getMaxRows();
  if (maxRows < 2) return;
  sheet.getRange(2, COL.DATE, maxRows - 1, 1).setNumberFormat("yyyy-MM-dd");
  if (sheet.getMaxColumns() >= COL.UPDATED_AT) {
    sheet.getRange(2, COL.CREATED_AT, maxRows - 1, 2).setNumberFormat("yyyy-MM-dd HH:mm:ss");
  }
}

/**
 * ==============================================================================
 * ★ [STEP3B] 예산 시트 생성/점검
 * '예산_설정' 시트를 만들고 헤더와 설명을 세팅한다. 이미 있으면 건드리지 않는다.
 *   년월: "2026-09" 형식 (해당 월에만 적용)
 *   대분류: '분류_설정'의 대분류명과 정확히 일치해야 매칭된다
 *   예산액: 양수로 입력 (지출 예산)
 * ==============================================================================
 */
function ensureBudgetSheet() {
  var ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch (e) { ui = null; }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_BUDGET);
  var created = false;

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_BUDGET);
    created = true;
  }

  // 헤더가 비어 있을 때만 세팅 (기존 데이터 보호)
  if (String(sheet.getRange(1, 1).getValue()).trim() === "") {
    sheet.getRange(1, 1, 1, 3).setValues([["년월", "대분류", "예산액"]]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, 3).setFontWeight("bold");
    sheet.setColumnWidth(1, 100);
    sheet.setColumnWidth(2, 160);
    sheet.setColumnWidth(3, 120);
    sheet.getRange("C2:C").setNumberFormat("#,##0");
  }

  // 대분류 드롭다운을 '분류_설정'의 대분류 목록으로 구성
  var catSheet = ss.getSheetByName(SHEET_CATEGORY);
  if (catSheet && catSheet.getLastRow() > 1) {
    var mains = [];
    catSheet.getRange(2, 1, catSheet.getLastRow() - 1, 1).getValues().forEach(function (r) {
      var v = String(r[0] || "").trim();
      if (v && mains.indexOf(v) === -1) mains.push(v);
    });
    if (mains.length > 0) {
      var rule = SpreadsheetApp.newDataValidation().requireValueInList(mains, true).setAllowInvalid(true).build();
      sheet.getRange(2, 2, Math.max(sheet.getMaxRows() - 1, 1), 1).setDataValidation(rule);
    }
  }

  var msg = (created ? "'" + SHEET_BUDGET + "' 시트를 만들었습니다.\n\n" : "'" + SHEET_BUDGET + "' 시트가 이미 있습니다.\n\n") +
    "입력 예시\n" +
    "  년월      대분류        예산액\n" +
    "  2026-09   생활 소비     600000\n" +
    "  2026-09   주거          800000\n\n" +
    "· 년월은 'YYYY-MM' 형식으로 입력합니다.\n" +
    "· 대분류는 분류_설정의 이름과 정확히 같아야 합니다(드롭다운 제공).\n" +
    "· 예산액은 양수로 입력합니다.\n" +
    "· 입력 후 대시보드를 새로고침하면 집행률이 표시됩니다.";
  Logger.log("[예산 시트] " + msg);
  if (ui) ui.alert("예산 시트", msg, ui.ButtonSet.OK);
  sheet.activate();
}

/**
 * ==============================================================================
 * ★ [STEP3] (1회성) 감사 + 소프트삭제 컬럼 추가 마이그레이션
 * '가계부_내역'/'수입' 시트에 I:입력자 J:입력시각 K:수정시각 L:삭제여부 헤더를 만든다.
 * 기존 A~H 순서는 건드리지 않고 뒤에만 덧붙이며, 여러 번 실행해도 안전하다(멱등).
 * ==============================================================================
 */
function migrateAddAuditColumns() {
  var ui = null;
  try {
    ui = SpreadsheetApp.getUi();
    var res = ui.alert('감사 컬럼 추가',
      "'가계부_내역'과 '수입' 시트에 아래 컬럼을 추가합니다.\n\n" +
      "  I:입력자  J:입력시각  K:수정시각  L:삭제여부\n\n" +
      '기존 A~H 컬럼은 그대로 유지됩니다. 진행하시겠습니까?',
      ui.ButtonSet.YES_NO);
    if (res !== ui.Button.YES) return;
  } catch (e) {
    Logger.log("메뉴에서 실행해 주세요 (트리거 환경 차단).");
    return;
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var targets = [SHEET_LOG, SHEET_INCOME];
  var report = [];

  targets.forEach(function (name) {
    var sheet = ss.getSheetByName(name);
    if (!sheet) { report.push(name + ": 시트 없음"); return; }

    // 필요한 만큼 열 확보
    if (sheet.getMaxColumns() < TXN_COL_COUNT) {
      sheet.insertColumnsAfter(sheet.getMaxColumns(), TXN_COL_COUNT - sheet.getMaxColumns());
    }

    var headers = sheet.getRange(1, 1, 1, TXN_COL_COUNT).getValues()[0];
    var added = [];
    for (var c = COL.CREATED_BY; c <= COL.DELETED; c++) {
      if (String(headers[c - 1]).trim() === "") {
        sheet.getRange(1, c).setValue(TXN_HEADERS[c - 1]);
        added.push(TXN_HEADERS[c - 1]);
      }
    }

    // 기존 행의 입력자/입력시각은 알 수 없으므로 비워 둔다(허위 기록 방지).
    // [PERF] 표시형식을 '열 전체'에 지정해 두면 새 행이 자동으로 상속하므로
    //        저장할 때마다 setNumberFormat을 호출할 필요가 없어진다.
    ensureTxnColumnFormats(sheet);
    report.push(name + ": " + (added.length > 0 ? added.join(", ") + " 추가" : "이미 적용됨"));
  });

  var msg = report.join("\n") +
    "\n\n기존 행의 입력자/입력시각은 알 수 없어 비워 두었습니다. " +
    "앞으로 등록·수정되는 건부터 기록됩니다.";
  Logger.log("[감사 컬럼 마이그레이션] " + msg);
  logRun("migrateAddAuditColumns", "성공", targets.length, msg);
  if (ui) ui.alert("완료", msg, ui.ButtonSet.OK);
}

/**
 * ==============================================================================
 * ★ [STEP3] 소프트 삭제된 행을 실제로 정리
 * deleteTransaction은 행을 지우지 않고 L열에 'Y'를 기록한다(복구 가능 + 범위 수식 보호).
 * 이 함수가 유예 기간(PURGE_AFTER_DAYS)이 지난 행만 실제 삭제한다.
 * ==============================================================================
 */
function purgeDeletedRows() {
  var ui = null;
  try {
    ui = SpreadsheetApp.getUi();
    var res = ui.alert('삭제 대기 행 정리',
      PURGE_AFTER_DAYS + '일이 지난 삭제 표시(Y) 행을 실제로 제거합니다.\n\n진행하시겠습니까?',
      ui.ButtonSet.YES_NO);
    if (res !== ui.Button.YES) return;
  } catch (e) {
    Logger.log("메뉴에서 실행해 주세요 (트리거 환경 차단).");
    return;
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) { Logger.log("[정리] 다른 작업 실행 중"); return; }

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var cutoff = Date.now() - PURGE_AFTER_DAYS * 24 * 60 * 60 * 1000;
    var total = 0, report = [];

    [SHEET_LOG, SHEET_INCOME].forEach(function (name) {
      var sheet = ss.getSheetByName(name);
      if (!sheet || sheet.getLastRow() < 2) return;
      if (sheet.getLastColumn() < COL.DELETED) { report.push(name + ": 삭제여부 컬럼 없음"); return; }

      var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, TXN_COL_COUNT).getValues();
      var toDelete = [];
      for (var i = 0; i < values.length; i++) {
        if (String(values[i][COL.DELETED - 1]).trim().toUpperCase() !== DELETED_FLAG) continue;
        var marked = values[i][COL.UPDATED_AT - 1];
        // 수정시각이 없으면 기준을 알 수 없으므로 보수적으로 남긴다
        if (!(marked instanceof Date)) continue;
        if (marked.getTime() <= cutoff) toDelete.push(i + 2);
      }
      // 아래쪽부터 지워야 행 번호가 밀리지 않는다
      for (var d = toDelete.length - 1; d >= 0; d--) sheet.deleteRow(toDelete[d]);
      total += toDelete.length;
      report.push(name + ": " + toDelete.length + "건 제거");
    });

    var msg = report.join("\n") || "정리할 행이 없습니다.";
    Logger.log("[삭제 행 정리] " + msg);
    logRun("purgeDeletedRows", "성공", total, msg);
    if (ui) ui.alert("완료", msg, ui.ButtonSet.OK);

  } catch (err) {
    logRun("purgeDeletedRows", "실패", 0, err.message);
    if (ui) ui.alert("오류", err.message, ui.ButtonSet.OK);
  } finally {
    lock.releaseLock();
  }
}

/**
 * ==============================================================================
 * ★ [STEP3] 시간 기반 트리거 설치 (배포 재현성)
 * 트리거는 clasp 관리 대상이 아니어서 재배포 시 재현이 어려웠다. 코드로 고정한다.
 * 같은 함수의 기존 트리거는 제거 후 재생성하므로 여러 번 실행해도 중복되지 않는다.
 * ==============================================================================
 */
function installTriggers() {
  var ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch (e) { ui = null; }

  var plan = [
    { fn: 'insertRegularExpenses', hour: 0, desc: '정기 항목 자동입력 (매일 00~01시)' },
    { fn: 'makeBackup', hour: 3, desc: '스프레드시트 백업 (매일 03~04시)' },
    // [PERF] 저장 경로에서 뺀 시트 정렬을 매시간 스케줄로 대신한다
    { fn: 'scheduledSortLogSheet', everyHours: 1, desc: '가계부_내역 정렬 (매시간)' },
    // 이관 대상이 없으면 백업도 락도 잡지 않고 즉시 끝나므로 매월 돌아도 부담이 없다.
    // 실제 작업은 해가 바뀐 뒤 한 번만 일어난다. (백업 03시 이후로 배치)
    { fn: 'scheduledArchiveOldTransactions', monthDay: 2, hour: 4, desc: '과거 데이터 자동 이관 (매월 2일 04~05시)' }
  ];
  var managed = plan.map(function (p) { return p.fn; });

  var removed = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (managed.indexOf(t.getHandlerFunction()) !== -1) {
      ScriptApp.deleteTrigger(t);
      removed++;
    }
  });

  plan.forEach(function (p) {
    if (p.everyHours) {
      ScriptApp.newTrigger(p.fn).timeBased().everyHours(p.everyHours).create();
    } else if (p.monthDay) {
      ScriptApp.newTrigger(p.fn).timeBased().onMonthDay(p.monthDay).atHour(p.hour)
        .inTimezone(getSheetTz()).create();
    } else {
      ScriptApp.newTrigger(p.fn).timeBased().atHour(p.hour).everyDays(1)
        .inTimezone(getSheetTz()).create();
    }
  });

  var msg = "기존 트리거 " + removed + "개 제거 후 재생성\n\n" +
            plan.map(function (p) { return "· " + p.desc; }).join("\n") +
            "\n\n시간대: " + getSheetTz() +
            "\n※ onEdit / onOpen은 단순 트리거라 설치가 필요 없습니다.";
  Logger.log("[트리거 설치] " + msg);
  logRun("installTriggers", "성공", plan.length, msg);
  if (ui) ui.alert("트리거 설치 완료", msg, ui.ButtonSet.OK);
}

/**
 * [보안] 백업 폴더 ID를 코드에 폴백으로 남겨두면 저장소에 그대로 노출된다.
 *   속성이 없으면 조용히 하드코딩된 폴더를 쓰는 대신 명확히 실패시킨다.
 *   (설정 누락을 숨기지 않는 편이 낫다. 호출부가 실행로그와 메일로 알린다)
 */
function getBackupFolderId() {
  var folderId = PropertiesService.getScriptProperties().getProperty('BACKUP_FOLDER_ID');
  if (!folderId) {
    throw new Error("BACKUP_FOLDER_ID 스크립트 속성이 설정되지 않았습니다. " +
                    "[가계부 도구 > 스크립트 속성 점검]에서 확인하세요.");
  }
  return folderId;
}

function makeArchiveBackup() {
  var folderId = getBackupFolderId();
  try {
    var folder = DriveApp.getFolderById(folderId);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var file = DriveApp.getFileById(ss.getId());
    var timeZone = TZ; // [STEP2] 하드코딩 -> 공통 상수
    var dateStr = Utilities.formatDate(new Date(), timeZone, "yyyy-MM-dd_HHmmss"); 
    var backupName = "[이관전백업] " + ss.getName() + "_" + dateStr;
    file.makeCopy(backupName, folder);
    
    return backupName; // 실패 시 복구 안내창 표출을 위해 이름 반환
  } catch (e) { 
    Logger.log("[오류] 이관 전 백업 에러: " + e.toString()); 
    throw new Error("이관 전 백업에 실패하여 중단합니다.");
  }
}

function makeBackup() {
  var made = 0;
  try {
    var folderId = getBackupFolderId();
    var folder = DriveApp.getFolderById(folderId);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var file = DriveApp.getFileById(ss.getId());
    var timeZone = getSheetTz();
    var now = new Date();
    var dateStr = Utilities.formatDate(now, timeZone, "yyyy-MM-dd");
    var isSunday = (parseInt(Utilities.formatDate(now, timeZone, "u"), 10) === 7);
    var isFirstDayOfMonth = (parseInt(Utilities.formatDate(now, timeZone, "d"), 10) === 1);
    var baseName = ss.getName();

    file.makeCopy("[일일백업] " + baseName + "_" + dateStr, folder); made++;
    if (isSunday) { file.makeCopy("[주간백업] " + baseName + "_" + dateStr, folder); made++; }
    if (isFirstDayOfMonth) { file.makeCopy("[월간백업] " + baseName + "_" + dateStr, folder); made++; }

    var trashed = cleanUpOldBackups(folder, baseName); // [STEP3] 이 문서의 백업만 정리하도록 이름 전달
    logRun("makeBackup", "성공", made, "생성 " + made + "건 / 정리 " + trashed + "건");

  } catch (e) {
    // [STEP3] 백업이 며칠째 실패해도 모르던 문제 방지
    logRun("makeBackup", "실패", made, e && e.message ? e.message : String(e));
    notifyFailure("makeBackup", e);
  }
}

/**
 * 백업 순환 정리
 * [STEP3] 변경점
 *  - 보관 개수 강화: 일 3->7, 주 1->4, 월 1->12 (두 달 전 데이터 복구가 불가능했음)
 *  - baseName(현재 스프레드시트 이름)이 포함된 파일만 대상으로 삼는다.
 *    같은 폴더에 다른 문서의 백업이 있으면 남의 백업을 지우던 문제를 막는다.
 */
function cleanUpOldBackups(folder, baseName) {
  var KEEP = { daily: 7, weekly: 4, monthly: 12, archive: 3 };

  var files = [];
  var fileIterator = folder.getFiles();
  while (fileIterator.hasNext()) {
    var f = fileIterator.next();
    var nm = f.getName();
    // [STEP3] 이 문서의 백업만 정리 대상에 포함
    if (baseName && nm.indexOf(baseName) === -1) continue;
    files.push({ file: f, name: nm, dateCreated: f.getDateCreated().getTime() });
  }

  var daily = [], weekly = [], monthly = [], legacy = [], archiveBackups = [];
  for (var i = 0; i < files.length; i++) {
    var name = files[i].name;
    if (name.indexOf("[일일백업]") === 0) daily.push(files[i]);
    else if (name.indexOf("[주간백업]") === 0) weekly.push(files[i]);
    else if (name.indexOf("[월간백업]") === 0) monthly.push(files[i]);
    else if (name.indexOf("[이관전백업]") === 0) archiveBackups.push(files[i]); // [회귀수정] 이관전백업 분류 분리
    else if (name.indexOf("[백업]") === 0) legacy.push(files[i]);
  }

  function sortByDateDesc(arr) { arr.sort(function(a, b) { return b.dateCreated - a.dateCreated; }); }
  sortByDateDesc(daily); sortByDateDesc(weekly); sortByDateDesc(monthly); sortByDateDesc(archiveBackups);

  var trashList = [];
  if (daily.length > KEEP.daily) trashList = trashList.concat(daily.slice(KEEP.daily));
  if (weekly.length > KEEP.weekly) trashList = trashList.concat(weekly.slice(KEEP.weekly));
  if (monthly.length > KEEP.monthly) trashList = trashList.concat(monthly.slice(KEEP.monthly));
  if (archiveBackups.length > KEEP.archive) trashList = trashList.concat(archiveBackups.slice(KEEP.archive));

  trashList = trashList.concat(legacy);
  for (var j = 0; j < trashList.length; j++) {
    trashList[j].file.setTrashed(true);
    Logger.log("[정리] 백업 삭제: " + trashList[j].name);
  }
  return trashList.length;
}

function checkAndFixDuplicateUUIDs() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = ['가계부_내역', '수입'];
  var seen = {}; 
  var changedCount = 0; 
  
  sheets.forEach(function(sName) {
    var sheet = ss.getSheetByName(sName);
    if (!sheet) return;
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      var id = String(data[i][0]).trim();
      if (!id) continue;
      if (seen[id]) {
        var newUuid = Utilities.getUuid().substring(0, 8);
        while (seen[newUuid]) {
          newUuid = Utilities.getUuid().substring(0, 8);
        }
        sheet.getRange(i + 1, 1).setValue(newUuid);
        seen[newUuid] = true; 
        changedCount++;
        Logger.log("[" + sName + "] 중복 UUID 수정됨: " + id + " -> " + newUuid);
      } else {
        seen[id] = true;
      }
    }
  });
  Logger.log("UUID 중복 검사 완료. 총 " + changedCount + "건 수정됨.");
}

function fixExistingAmountSigns() {
  Logger.log("실행 전 반드시 백업본을 만들었는지 확인하세요.");
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var changedCount = 0; 

  function fixSheet(sheetName, expectedSign) {
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet || sheet.getLastRow() <= 1) return;
    
    var range = sheet.getRange(2, 6, sheet.getLastRow() - 1, 1);
    var formulas = range.getFormulas(); 
    var values = range.getValues();
    var hasUpdates = false;

    for (var i = 0; i < values.length; i++) {
      var val = values[i][0];
      if (val === null || val === '' || formulas[i][0] !== '') continue;
      
      var num = Number(val);
      if (isNaN(num)) {
        Logger.log("[" + sheetName + "] " + (i + 2) + "행 금액이 숫자가 아닙니다. 건너뜁니다.");
        continue;
      }
      
      var correctVal = expectedSign === -1 ? -Math.abs(num) : Math.abs(num);
      if (num !== correctVal) {
        values[i][0] = correctVal;
        hasUpdates = true;
        changedCount++;
      }
    }
    if (hasUpdates) range.setValues(values);
  }

  fixSheet("가계부_내역", -1);
  fixSheet("수입", 1);
  Logger.log("부호 정상화 완료. 총 " + changedCount + "건 변경됨.");
}

/**
 * ==============================================================================
 * ★ (신규) 과거 데이터 아카이빙(이관) 함수 (동적 연도 계산)
 * [경고] STEP 2의 날짜 타입 통일 완료 전에는 실행하지 말 것
 * 쓰기 검증 후 원본 정리 / 실패 시 백업 수동 복구
 * ==============================================================================
 */
/**
 * ==============================================================================
 * ★ 과거 데이터 이관 — 핵심 로직 (UI 없음)
 * [경고] STEP 2의 날짜 타입 통일 완료 전에는 실행하지 말 것
 * 쓰기 검증 후 원본 정리 / 실패 시 백업 수동 복구
 *
 * 메뉴(archiveOldTransactions)와 트리거(scheduledArchiveOldTransactions)가
 * 공통으로 호출한다. 이 프로젝트에서 가장 위험한 로직이므로 한 벌만 유지한다.
 * 결과는 예외 대신 객체로 돌려주고, 사용자 통지 방식은 호출자가 정한다.
 *
 * 반환: { status, message, archived, processed[], backupFileName }
 *   status: 'none'(이관 대상 없음) | 'done' | 'formula'(수식 발견) | 'busy' | 'error'
 * ==============================================================================
 */
function archiveCore() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetNames = [SHEET_LOG, SHEET_INCOME];
  var now = new Date();
  var thresholdYear = now.getFullYear() - 1;

  function yearOf(dateVal) {
    if (dateVal instanceof Date) return dateVal.getFullYear();
    return parseInt(String(dateVal).split("-")[0], 10);
  }

  // [트리거 대응] 이관 대상이 하나도 없으면 백업도 락도 잡지 않고 바로 끝낸다.
  //   매월 돌더라도 평소에는 아무 비용이 없고, [이관전백업] 사본이 쌓이지 않는다.
  var hasTarget = false;
  for (var p = 0; p < sheetNames.length; p++) {
    var ps = ss.getSheetByName(sheetNames[p]);
    if (!ps || ps.getLastRow() <= 1) continue;
    var dates = ps.getRange(2, COL.DATE, ps.getLastRow() - 1, 1).getValues();
    for (var d = 0; d < dates.length; d++) {
      var yy = yearOf(dates[d][0]);
      if (!isNaN(yy) && yy < thresholdYear) { hasTarget = true; break; }
    }
    if (hasTarget) break;
  }
  if (!hasTarget) {
    return { status: 'none', message: thresholdYear + '년 이전 데이터가 없어 이관할 것이 없습니다.',
             archived: 0, processed: [], backupFileName: '' };
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return { status: 'busy', message: '다른 작업이 실행 중이라 이관을 건너뜁니다.',
             archived: 0, processed: [], backupFileName: '' };
  }

  var backupFileName = "";
  var processedSheets = [];
  var archivedCount = 0;

  try {
    // 사전 수식 검사 (백업 생성 전에 전 시트를 먼저 확인 — 하나라도 있으면 아무것도 하지 않는다)
    for (var s = 0; s < sheetNames.length; s++) {
      var checkSheet = ss.getSheetByName(sheetNames[s]);
      if (!checkSheet || checkSheet.getLastRow() <= 1) continue;

      var formulas = checkSheet.getDataRange().getFormulas();
      for (var r = 0; r < formulas.length; r++) {
        for (var c = 0; c < formulas[r].length; c++) {
          if (formulas[r][c] !== '') {
            return {
              status: 'formula',
              message: "[" + sheetNames[s] + "] 시트 내부에 수식이 포함되어 있어 원본 훼손 방지를 위해 이관을 중단했습니다.\n" +
                       "합계 수식 등은 별도 요약 시트로 분리한 뒤 다시 실행해 주세요.",
              archived: 0, processed: [], backupFileName: ''
            };
          }
        }
      }
    }

    backupFileName = makeArchiveBackup();

    for (var sIdx = 0; sIdx < sheetNames.length; sIdx++) {
      var sheetName = sheetNames[sIdx];
      var sheet = ss.getSheetByName(sheetName);
      if (!sheet || sheet.getLastRow() <= 1) continue;

      var data = sheet.getDataRange().getValues();
      var headers = data[0];
      var keepData = [headers];
      var archiveData = [headers];

      for (var i = 1; i < data.length; i++) {
        var row = data[i];
        var y = yearOf(row[COL.DATE - 1]);
        if (!isNaN(y) && y < thresholdYear) archiveData.push(row);
        else keepData.push(row);
      }

      if (archiveData.length > 1) {
        var archiveSheetName = sheetName + '_보관함';
        var archiveSheet = ss.getSheetByName(archiveSheetName);
        var beforeRowCount = 0;
        var isNewSheet = false;

        if (!archiveSheet) {
          archiveSheet = ss.insertSheet(archiveSheetName);
          archiveSheet.getRange(1, 1, archiveData.length, archiveData[0].length).setValues(archiveData);
          isNewSheet = true;
        } else {
          beforeRowCount = archiveSheet.getLastRow();
          var dataToAppend = archiveData.slice(1);
          archiveSheet.getRange(beforeRowCount + 1, 1, dataToAppend.length, dataToAppend[0].length).setValues(dataToAppend);
        }

        SpreadsheetApp.flush();

        // 보관함에 실제로 기대한 만큼 늘었는지 확인한 뒤에만 원본을 정리한다
        var afterRowCount = archiveSheet.getLastRow();
        var expectedIncrease = isNewSheet ? archiveData.length : archiveData.length - 1;
        if (afterRowCount - beforeRowCount !== expectedIncrease) {
          throw new Error("[" + sheetName + "] 보관함 쓰기 검증 실패. 원본을 유지합니다.");
        }

        // 롤백 불가 구간
        sheet.clearContents();
        sheet.getRange(1, 1, keepData.length, keepData[0].length).setValues(keepData);
        ensureTxnColumnFormats(sheet); // 서식 재적용 (clearContents 이후)

        archivedCount += archiveData.length - 1;
        processedSheets.push(sheetName);
      }
    }

    return {
      status: 'done',
      message: thresholdYear + '년 이전 ' + archivedCount + '건을 보관함으로 옮겼습니다.\n' +
               '대상 시트: ' + (processedSheets.length > 0 ? processedSheets.join(', ') : '없음') + '\n' +
               '백업: [' + backupFileName + ']',
      archived: archivedCount, processed: processedSheets, backupFileName: backupFileName
    };

  } catch (err) {
    return {
      status: 'error',
      message: '이관 작업 중 오류가 발생했습니다.\n\n' +
               '오류: ' + (err && err.message ? err.message : String(err)) + '\n\n' +
               '데이터 유실이 의심되면 아래 백업 파일로 수동 복구해 주세요:\n' +
               '파일명: [' + backupFileName + ']\n' +
               '이관 완료된 시트: ' + (processedSheets.length > 0 ? processedSheets.join(', ') : '없음'),
      archived: archivedCount, processed: processedSheets, backupFileName: backupFileName
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * ==============================================================================
 * ★ 과거 데이터 이관 — 메뉴 진입점 (사람이 확인하고 실행)
 * ==============================================================================
 */
function archiveOldTransactions() {
  var ui = null;
  try {
    ui = SpreadsheetApp.getUi();
    var res = ui.alert('과거 데이터 이관',
      '작년 이전 데이터를 보관함 시트로 이동합니다.\n\n진행하시겠습니까? (자동 백업 1회 진행됨)',
      ui.ButtonSet.YES_NO);
    if (res !== ui.Button.YES) return;
  } catch (e) {
    Logger.log("메뉴에서 실행해 주세요. 자동 실행은 scheduledArchiveOldTransactions를 사용합니다.");
    return;
  }

  var result = archiveCore();
  Logger.log('[이관] ' + result.status + ' - ' + result.message);
  logRun('archiveOldTransactions', result.status === 'error' ? '실패' : '성공', result.archived, result.message);

  var title = result.status === 'done' ? '이관 완료'
            : result.status === 'none' ? '이관할 데이터 없음'
            : result.status === 'formula' ? '이관 중단 (수식 발견)'
            : result.status === 'busy' ? '이관 건너뜀'
            : '오류: 수동 복구 안내';
  ui.alert(title, result.message, ui.ButtonSet.OK);
}

/**
 * ==============================================================================
 * ★ 과거 데이터 이관 — 트리거 진입점 (자동 실행)
 * makeBackup처럼 UI 없이 동작하고 결과는 실행로그 + 메일로 알린다.
 *
 * 매월 실행해도 부담이 없다. archiveCore가 이관 대상이 없으면 백업도 락도 잡지 않고
 * 즉시 끝내므로, 실제 작업은 해가 바뀐 뒤 한 번만 일어난다.
 *
 * [주의] 아무도 지켜보지 않는 상태에서 실행되므로, 실패 시 반드시 메일이 가도록 한다.
 *   clearContents 이후 구간은 롤백이 불가능해 [이관전백업]으로 수동 복구해야 한다.
 * ==============================================================================
 */
function scheduledArchiveOldTransactions() {
  var result;
  try {
    result = archiveCore();
  } catch (e) {
    logRun('scheduledArchiveOldTransactions', '실패', 0, e && e.message ? e.message : String(e));
    notifyFailure('scheduledArchiveOldTransactions', e);
    return;
  }

  Logger.log('[자동 이관] ' + result.status + ' - ' + result.message);

  // 이관 대상이 없는 평소 실행은 로그를 남기지 않는다 (실행로그가 이 건으로 차는 것 방지)
  if (result.status === 'none') return;

  logRun('scheduledArchiveOldTransactions',
         result.status === 'error' ? '실패' : '성공',
         result.archived, result.message);

  // 실제로 데이터를 옮겼거나 문제가 생긴 경우에만 메일로 알린다
  var to = getAdminEmail();
  if (!to) return;
  var subject = result.status === 'done' ? '[가계부] 과거 데이터 자동 이관 완료'
              : result.status === 'error' ? '[가계부] 과거 데이터 자동 이관 실패 — 확인 필요'
              : '[가계부] 과거 데이터 자동 이관 건너뜀';
  try {
    MailApp.sendEmail({
      to: to, subject: subject,
      body: result.message + '\n\n스프레드시트: ' + SpreadsheetApp.getActiveSpreadsheet().getUrl()
    });
  } catch (e) {
    Logger.log('[알림 메일 발송 실패] ' + e.message);
  }
}