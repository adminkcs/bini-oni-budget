/**
 * 정적 웹 어댑터 (GitHub Pages).
 * Mobile.html + Common.html을 그대로 쓰고, Apps Script 대신 브라우저가 Sheets API로 직접 읽고 쓴다.
 *  - 설정(OAuth 클라이언트 ID, 스프레드시트 ID)은 주소의 #cid=..&sid=.. 로 한 번 받아 브라우저에 저장한다.
 *    저장소가 공개라 ID를 코드에 넣지 않는다.
 *  - 마지막으로 받은 데이터를 저장해 두었다가 다음 접속 때 먼저 그린다.
 *  - 화면의 google.script.run 호출(저장·수정·삭제)을 Sheets API 쓰기로 바꿔 연결한다.
 */
(function () {
  var SCOPE = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/userinfo.email';
  var NEED_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
  var KEY_CFG = 'bob.cfg', KEY_TOKEN = 'bob.token', KEY_SNAPSHOT = 'bob.snapshot', KEY_EMAIL = 'bob.email';
  var SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets/';
  var t = { nav: (performance.timeOrigin || Date.now()) };
  var cfg = null;

  // ---------- 저장소(브라우저) ----------
  function load(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; } }
  function save(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* 용량 초과 등은 무시 */ } }
  function drop(key) { try { localStorage.removeItem(key); } catch (e) {} }

  function readConfigFromHash() {
    var h = new URLSearchParams(location.hash.slice(1));
    if (h.get('cid') && h.get('sid')) {
      save(KEY_CFG, { cid: h.get('cid'), sid: h.get('sid') });
      history.replaceState(null, '', location.pathname + location.search); // 주소창에서 ID를 지운다
    }
    return load(KEY_CFG);
  }

  // ---------- 상태 표시줄 ----------
  function status(text, action) {
    var el = document.getElementById('web-status');
    if (!el) {
      el = document.createElement('div');
      el.id = 'web-status';
      document.body.appendChild(el);
    }
    el.innerHTML = '<span>' + escapeHtml(text) + '</span>' +
      (action ? '<button type="button" id="web-status-btn">' + escapeHtml(action.label) + '</button>' : '');
    if (action) document.getElementById('web-status-btn').onclick = action.onClick;
  }

  function ago(ms) {
    var m = Math.round(ms / 60000);
    if (m < 1) return '방금';
    if (m < 60) return m + '분 전';
    var h = Math.round(m / 60);
    return h < 24 ? h + '시간 전' : Math.round(h / 24) + '일 전';
  }

  // ---------- Google 로그인(토큰) ----------
  var gisLoaded = null;
  function loadGis() {
    if (gisLoaded) return gisLoaded;
    gisLoaded = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = function () { installScriptRun(); resolve(); };
      s.onerror = function () { reject(new Error('Google 로그인 스크립트를 불러오지 못했습니다.')); };
      document.head.appendChild(s);
    });
    return gisLoaded;
  }

  /** 쓰기 권한까지 받은 토큰만 쓴다 (예전 읽기 전용 토큰이면 다시 로그인) */
  function cachedToken() {
    var tk = load(KEY_TOKEN);
    if (!tk || tk.exp - Date.now() <= 60000) return null;
    if (String(tk.scope || '').split(' ').indexOf(NEED_SCOPE) === -1) return null;
    return tk.value;
  }

  function requestToken() {
    return loadGis().then(function () {
      return new Promise(function (resolve, reject) {
        var client = google.accounts.oauth2.initTokenClient({
          client_id: cfg.cid,
          scope: SCOPE,
          callback: function (resp) {
            if (resp.error) { reject(new Error(resp.error_description || resp.error)); return; }
            if (String(resp.scope || '').split(' ').indexOf(NEED_SCOPE) === -1) {
              reject(new Error('Google 스프레드시트 권한을 허용해야 사용할 수 있습니다.')); return;
            }
            save(KEY_TOKEN, { value: resp.access_token, scope: resp.scope,
                              exp: Date.now() + (Number(resp.expires_in) || 3600) * 1000 });
            resolve(resp.access_token);
          },
          error_callback: function (err) { reject(new Error((err && err.message) || '로그인이 취소되었습니다.')); }
        });
        client.requestAccessToken({ prompt: '' });
      });
    });
  }

  function reloginError() { drop(KEY_TOKEN); return Object.assign(new Error('로그인이 만료되었습니다.'), { relogin: true }); }

  function api(path, opts) {
    var tk = cachedToken();
    if (!tk) return Promise.reject(reloginError());
    var o = Object.assign({}, opts || {});
    o.headers = Object.assign({ Authorization: 'Bearer ' + tk }, o.body ? { 'Content-Type': 'application/json' } : {});
    return fetch(path, o).then(function (res) {
      if (res.status === 401) throw reloginError();
      if (!res.ok) return res.text().then(function (b) { throw new Error('Google 시트 요청 실패(' + res.status + '): ' + b.slice(0, 200)); });
      return res.json();
    });
  }

  /** 입력자 기록용 이메일. 한 번 받아 저장해 둔다 */
  function userEmail() {
    var e = load(KEY_EMAIL);
    if (e) return Promise.resolve(e);
    return api('https://www.googleapis.com/oauth2/v3/userinfo').then(function (u) {
      if (u && u.email) save(KEY_EMAIL, u.email);
      return (u && u.email) || 'UNKNOWN';
    });
  }

  // ---------- Sheets 읽기 ----------
  function fetchSheets() {
    var params = new URLSearchParams({ valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'SERIAL_NUMBER' });
    SheetsData.RANGES.forEach(function (r) { params.append('ranges', r); });
    return api(SHEETS + encodeURIComponent(cfg.sid) + '/values:batchGet?' + params).then(function (json) {
      var byTab = {};
      var names = SheetsData.TABS.concat([SheetsData.REG_TAB]);
      (json.valueRanges || []).forEach(function (vr, i) { byTab[names[i]] = vr.values || []; });
      return SheetsData.toDashboardData(byTab);
    });
  }

  // ---------- Sheets 쓰기 (서버 save/update/deleteTransaction과 같은 결과를 돌려준다) ----------
  var W = window.SheetsWrite;
  function q(sheet, a1) { return encodeURIComponent("'" + sheet + "'!" + a1); }

  function writeSave(entry) {
    var err = W.validate(entry);
    if (err) return Promise.resolve({ ok: false, message: err });
    var id = W.newId();
    var sheet = W.sheetOf(entry.구분);
    return userEmail().then(function (actor) {
      var body = JSON.stringify({ values: [W.newRow(entry, id, actor, new Date())] });
      return api(SHEETS + encodeURIComponent(cfg.sid) + '/values/' + q(sheet, 'A:L') +
                 ':append?valueInputOption=USER_ENTERED', { method: 'POST', body: body });
    }).then(function () { return { ok: true, txn: W.clientTxn(entry, id) }; });
  }

  function findRow(sheet, id) {
    return api(SHEETS + encodeURIComponent(cfg.sid) + '/values/' + q(sheet, 'A:A')).then(function (j) {
      return W.findRows(j.values || [], id);
    });
  }

  function batchUpdate(data) {
    return api(SHEETS + encodeURIComponent(cfg.sid) + '/values:batchUpdate', {
      method: 'POST', body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data: data })
    });
  }

  function writeUpdate(entry) {
    var err = W.validate(entry);
    if (err) return Promise.resolve({ ok: false, message: err });
    if (!entry.일련번호) return Promise.resolve({ ok: false, message: '수정할 거래를 찾을 수 없습니다.' });
    var sheet = W.sheetOf(entry.구분);
    return findRow(sheet, entry.일련번호).then(function (rows) {
      if (rows.length === 0) return { ok: false, message: '거래를 찾지 못했습니다.' };
      if (rows.length >= 2) return { ok: false, message: '일련번호가 중복되었습니다(' + rows.length + '건). 관리자 확인이 필요합니다.' };
      var r = rows[0];
      return batchUpdate([
        { range: "'" + sheet + "'!A" + r + ':H' + r, values: [W.updateRow(entry)] },
        { range: "'" + sheet + "'!K" + r, values: [[W.stamp(new Date())]] }
      ]).then(function () { return { ok: true, txn: W.clientTxn(entry, entry.일련번호) }; });
    });
  }

  function writeDelete(entry) {
    if (!entry || !entry.구분 || !entry.일련번호) return Promise.resolve({ ok: false, message: '삭제할 정보 부족.' });
    var sheet = W.sheetOf(entry.구분);
    return findRow(sheet, entry.일련번호).then(function (rows) {
      if (rows.length === 0) return { ok: false, message: '삭제할 거래를 찾지 못했습니다.' };
      if (rows.length >= 2) return { ok: false, message: '일련번호가 중복되었습니다(' + rows.length + '건). 관리자 확인이 필요합니다.' };
      var r = rows[0];
      // 소프트 삭제: 삭제여부(L)=Y, 수정시각(K)=지금. 실제 행 정리는 서버 purgeDeletedRows가 맡는다
      return batchUpdate([
        { range: "'" + sheet + "'!K" + r + ':L' + r, values: [[W.stamp(new Date()), W.DELETED_FLAG]] }
      ]).then(function () { return { ok: true, removed: { 일련번호: String(entry.일련번호), 구분: entry.구분 } }; });
    });
  }

  var WRITERS = { saveTransaction: writeSave, updateTransaction: writeUpdate, deleteTransaction: writeDelete };

  /** Common.html이 부르는 google.script.run.with…Handler(…).함수(인자) 모양을 그대로 받는다 */
  function installScriptRun() {
    window.google = window.google || {};
    function runner(onOk, onFail) {
      return new Proxy({}, {
        get: function (_, name) {
          if (name === 'withSuccessHandler') return function (f) { return runner(f, onFail); };
          if (name === 'withFailureHandler') return function (f) { return runner(onOk, f); };
          return function (arg) {
            var fn = WRITERS[name];
            if (!fn) return; // logPageLoad 등 Apps Script 전용 호출은 무시
            fn(arg).then(function (res) {
              if (res && res.ok) refreshSnapshotQuietly();
              if (onOk) onOk(res);
            }).catch(function (e) {
              if (e.relogin) promptLogin();
              if (onFail) onFail({ message: e.relogin ? '로그인이 만료되었습니다. 하단에서 다시 로그인한 뒤 저장해 주세요.' : e.message });
            });
          };
        }
      });
    }
    window.google.script = { run: runner(null, null) };
  }

  // ---------- 흐름 ----------
  function render(data) {
    document.getElementById('loading-overlay').style.display = 'none';
    onDataLoaded(data);
  }

  /** 저장 뒤 화면은 그대로 두고, 다음 접속 때 보일 저장본만 최신으로 바꾼다 */
  var quietTimer = null;
  function refreshSnapshotQuietly() {
    clearTimeout(quietTimer);
    quietTimer = setTimeout(function () {
      fetchSheets().then(function (data) { save(KEY_SNAPSHOT, { at: Date.now(), data: data }); }).catch(function () {});
    }, 1500);
  }

  function promptLogin(prefix) {
    status((prefix || '') + '최신 데이터를 보고 저장하려면 로그인하세요.', { label: 'Google 로그인', onClick: function () { refresh(true); } });
  }

  function refresh(interactive) {
    var started = Date.now();
    var getToken = cachedToken() ? Promise.resolve() : interactive ? requestToken() : Promise.reject(reloginError());
    status('최신 데이터 불러오는 중…');
    return getToken.then(function () {
      t.token = Date.now();
      return fetchSheets();
    }).then(function (data) {
      t.fetched = Date.now();
      save(KEY_SNAPSHOT, { at: Date.now(), data: data });
      render(data);
      t.fresh = Date.now();
      console.log('[웹 계측]', JSON.stringify({ 저장본표시: t.cached ? t.cached - t.nav : null, 토큰: t.token - started,
        시트읽기: t.fetched - t.token, 최신표시: t.fresh - t.nav }));
      status('최신 데이터 · 시트 읽기 ' + ((t.fetched - t.token) / 1000).toFixed(1) + '초', { label: '로그아웃', onClick: logout });
      userEmail().catch(function () {});
    }).catch(function (err) {
      var snap = load(KEY_SNAPSHOT);
      var base = snap ? ago(Date.now() - snap.at) + ' 저장본 표시 중 · ' : '';
      if (err.relogin) promptLogin(base);
      else status(base + err.message, { label: '다시 시도', onClick: function () { refresh(true); } });
      if (!snap) document.getElementById('loading-overlay').style.display = 'none';
    });
  }

  function logout() {
    var tk = load(KEY_TOKEN);
    [KEY_TOKEN, KEY_SNAPSHOT, KEY_EMAIL].forEach(drop);
    try { if (tk && window.google && google.accounts) google.accounts.oauth2.revoke(tk.value, function () {}); } catch (e) {}
    location.reload();
  }

  function start() {
    installScriptRun();
    cfg = readConfigFromHash();
    if (!cfg) {
      document.getElementById('loading-overlay').style.display = 'none';
      status('설정이 없습니다. 안내받은 첫 접속 주소(#cid=…&sid=…)로 한 번 열어 주세요.');
      return;
    }
    var snap = load(KEY_SNAPSHOT);
    if (snap && snap.data) {
      render(snap.data);
      t.cached = Date.now();
      status(ago(Date.now() - snap.at) + ' 저장본 표시 중 · 최신 데이터 확인 중…');
    } else {
      document.getElementById('loading-overlay').style.display = 'flex';
    }
    // 로그인 창은 사용자가 누른 뒤에만 띄울 수 있어(팝업 차단), 토큰이 없으면 버튼을 보여 준다
    refresh(false);
  }

  // 이미 열린 페이지에서 첫 접속 주소(#cid=…)를 다시 연 경우에도 설정을 받는다
  window.addEventListener('hashchange', function () {
    if (/[#&]cid=/.test(location.hash)) { readConfigFromHash(); location.reload(); }
  });

  // Common.html의 loadData를 대체한다 (DOMContentLoaded에서 이 이름으로 호출된다)
  window.loadData = start;
})();
