/**
 * 정적 웹: 저장·수정·삭제 규칙 (브라우저가 Sheets API로 직접 쓴다).
 * 서버 saveTransaction / updateTransaction / deleteTransaction(Dashboard.js)과 같은 검증 문구·같은 행 구성을 따른다.
 * test/web-write.test.js가 서버 규칙과의 일치를 검증한다.
 */
(function (root) {
  var SHEET_LOG = '가계부_내역', SHEET_INCOME = '수입';
  var DELETED_FLAG = 'Y';

  function sheetOf(kind) { return kind === '지출' ? SHEET_LOG : SHEET_INCOME; }

  function missing(v) { return !v || String(v).trim() === '' || v === 'undefined'; }

  /** 저장·수정 공통 검증. 서버와 같은 순서·같은 문구. 통과하면 null */
  function validate(entry) {
    if (!entry || (entry.구분 !== '지출' && entry.구분 !== '수입')) return '구분 오류';
    if (!entry.날짜 || !/^\d{4}-\d{2}-\d{2}$/.test(entry.날짜)) return '날짜 형식이 올바르지 않습니다(YYYY-MM-DD).';
    if (missing(entry.대분류)) return '대분류가 누락되었습니다.';
    if (missing(entry.소분류)) return '소분류가 누락되었습니다.';
    if (missing(entry.결제수단)) return '결제수단이 누락되었습니다.';
    var amt = Number(entry.금액);
    if (isNaN(amt) || amt <= 0) return '금액은 0보다 큰 숫자여야 합니다.';
    return null;
  }

  /** 지출은 음수, 수입은 양수 (서버 normalizeAmount와 동일) */
  function normalizeAmount(kind, amount) {
    if (amount === null || amount === undefined || String(amount).trim() === '') return NaN;
    var n = Number(amount);
    if (isNaN(n)) return NaN;
    return kind === '수입' ? Math.abs(n) : -Math.abs(n);
  }

  function clean(entry) {
    return {
      main: String(entry.대분류).trim(), sub: String(entry.소분류).trim(),
      content: String(entry.내용 || '').trim(), payment: String(entry.결제수단).trim(),
      note: String(entry.비고 || '').trim(), amount: normalizeAmount(entry.구분, entry.금액)
    };
  }

  /**
   * 글자 그대로 쓰기 (서버 asText와 같은 규칙). USER_ENTERED는 "3/4"→날짜, "50%"→0.5, "=…"→수식,
   * 숫자만 있는 일련번호→숫자로 바꾸므로 글자 칸 앞에 작은따옴표를 붙인다. 따옴표는 셀 값에 남지 않는다.
   */
  function asText(v) {
    if (v === null || v === undefined) return v;
    var s = String(v);
    return s === '' ? s : "'" + s;
  }

  /** 서버 generateUniqueUuid와 같은 형식(12자리 16진수) */
  function newId() {
    var hex = (root.crypto && root.crypto.randomUUID) ? root.crypto.randomUUID() : String(Math.random()) + Date.now();
    return hex.replace(/[^0-9a-f]/gi, '').toLowerCase().slice(0, 12).padEnd(12, '0');
  }

  function pad(n) { return String(n).padStart(2, '0'); }
  /** 'yyyy-MM-dd HH:mm:ss' (기기 시각 = 가족 모두 한국 시간) */
  function stamp(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' +
           pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }

  /** 새 행 A~L (일련번호 … 비고, 입력자, 입력시각, 수정시각, 삭제여부). 날짜·시각은 USER_ENTERED로 날짜 값이 된다 */
  function newRow(entry, id, actor, now) {
    var c = clean(entry);
    return [asText(id), entry.날짜, asText(c.main), asText(c.sub), asText(c.content), c.amount, asText(c.payment), asText(c.note),
            actor || 'UNKNOWN', stamp(now), '', ''];
  }

  /** 수정 A~H. 입력자/입력시각(I/J)은 보존하고 수정시각(K)은 따로 쓴다 */
  function updateRow(entry) {
    var c = clean(entry);
    return [asText(entry.일련번호), entry.날짜, asText(c.main), asText(c.sub), asText(c.content), c.amount, asText(c.payment), asText(c.note)];
  }

  /** 서버 toClientTxn과 같은 모양 */
  function clientTxn(entry, id) {
    var c = clean(entry);
    return { 일련번호: String(id), 날짜: entry.날짜, 대분류: c.main, 소분류: c.sub, 내용: c.content,
             금액: c.amount, 결제수단: c.payment, 비고: c.note, 구분: entry.구분 };
  }

  /** A열 값 배열에서 id와 같은 행 번호(1부터, 머리글 제외)를 모두 찾는다 */
  function findRows(colA, id) {
    var rows = [], target = String(id);
    for (var i = 1; i < colA.length; i++) if (String((colA[i] || [])[0]) === target) rows.push(i + 1);
    return rows;
  }

  var api = { SHEET_LOG: SHEET_LOG, SHEET_INCOME: SHEET_INCOME, DELETED_FLAG: DELETED_FLAG, sheetOf: sheetOf,
              validate: validate, normalizeAmount: normalizeAmount, asText: asText, newId: newId, stamp: stamp,
              newRow: newRow, updateRow: updateRow, clientTxn: clientTxn, findRows: findRows };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SheetsWrite = api;
})(typeof window !== 'undefined' ? window : globalThis);
