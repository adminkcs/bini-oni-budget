/**
 * 정적 웹 시험판: Sheets API batchGet 결과 → 대시보드 데이터 형태로 변환.
 * 서버 getDashboardData(Dashboard.js)와 같은 규칙을 따른다 (test/web-data.test.js가 동일성 검증).
 * 브라우저에서는 window.SheetsData, Node 테스트에서는 module.exports로 쓴다.
 */
(function (root) {
  var TXN_TABS = ['가계부_내역', '수입'];
  var TABS = ['가계부_내역', '수입', '분류_설정', '예산_설정'];
  var REG_TAB = '정기_수입지출_설정_및_휴일기준';
  var DATE_HEADERS = ['날짜', '년월'];
  var TXN_COL_COUNT = 8;   // A~H (일련번호~비고)
  var REG_SUB_IDX = 3;     // 정기 시트 D열 = 소분류
  var DELETED_FLAG = 'Y';

  function isBlank(v) {
    return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
  }

  function serialToYmd(serial) {
    var d = new Date((Math.floor(serial) - 25569) * 86400000);
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') +
           '-' + String(d.getUTCDate()).padStart(2, '0');
  }

  function tabToRows(tab, values) {
    if (!values || values.length < 1) return [];
    var headers = values[0];
    var deletedIdx = headers.indexOf('삭제여부');
    var isTxn = TXN_TABS.indexOf(tab) !== -1;
    var colCount = isTxn ? Math.min(headers.length, TXN_COL_COUNT) : headers.length;
    var dateCols = [];
    headers.forEach(function (h, i) { if (DATE_HEADERS.indexOf(h) !== -1) dateCols.push(i); });

    var out = [];
    for (var i = 1; i < values.length; i++) {
      var row = values[i] || [];
      if (deletedIdx !== -1 && String(row[deletedIdx]).trim().toUpperCase() === DELETED_FLAG) continue;
      var rowData = {};
      var empty = true;
      for (var j = 0; j < colCount; j++) {
        var val = row[j];
        if (dateCols.indexOf(j) !== -1 && typeof val === 'number') val = serialToYmd(val);
        if (!isBlank(val)) empty = false;
        if (val !== undefined) rowData[headers[j]] = val;
      }
      if (isTxn && isBlank(rowData['날짜'])) continue;
      if (!empty) out.push(rowData);
    }
    return out;
  }

  /** valuesByTab: { 시트명: values[][] } → { 시트명: 행객체[], _정기소분류: [] } */
  function toDashboardData(valuesByTab) {
    var result = {};
    TABS.forEach(function (t) { result[t] = tabToRows(t, valuesByTab[t] || []); });
    var reg = valuesByTab[REG_TAB] || [];
    result['_정기소분류'] = [];
    for (var i = 1; i < reg.length; i++) {
      var sub = String((reg[i] || [])[REG_SUB_IDX] || '').trim();
      if (sub) result['_정기소분류'].push(sub);
    }
    return result;
  }

  var RANGES = TABS.concat([REG_TAB]).map(function (n) { return "'" + n + "'"; });

  var api = { TABS: TABS, REG_TAB: REG_TAB, RANGES: RANGES, isBlank: isBlank,
              serialToYmd: serialToYmd, tabToRows: tabToRows, toDashboardData: toDashboardData };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SheetsData = api;
})(this);
