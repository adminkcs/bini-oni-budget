/**
 * 정적 웹 시험판(읽기 전용) 어댑터.
 * Mobile.html + Common.html을 그대로 쓰고, Apps Script 대신 브라우저가 Sheets API로 직접 읽는다.
 *  - 설정(OAuth 클라이언트 ID, 스프레드시트 ID)은 주소의 #cid=..&sid=.. 로 한 번 받아 브라우저에 저장한다.
 *    저장소가 공개라 ID를 코드에 넣지 않는다.
 *  - 마지막으로 받은 데이터를 저장해 두었다가 다음 접속 때 먼저 그린다(가끔 접속해도 즉시 표시).
 *  - 저장/수정/삭제는 막는다(google.script.run 대체 + 버튼 차단).
 */
(function () {
  var SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
  var KEY_CFG = 'bob.cfg', KEY_TOKEN = 'bob.token', KEY_SNAPSHOT = 'bob.snapshot';
  var READONLY_MSG = '읽기 전용 시험판에서는 저장·수정·삭제를 할 수 없습니다.';
  var t = { nav: (performance.timeOrigin || Date.now()) };

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

  // ---------- 읽기 전용: Apps Script 호출 대체 ----------
  function ensureScriptStub() {
    window.google = window.google || {};
    if (window.google.script) return;
    function runner(onOk, onFail) {
      return new Proxy({}, {
        get: function (_, name) {
          if (name === 'withSuccessHandler') return function (f) { return runner(f, onFail); };
          if (name === 'withFailureHandler') return function (f) { return runner(onOk, f); };
          return function () {
            if (name === 'logPageLoad') return;
            if (onFail) onFail({ message: READONLY_MSG });
          };
        }
      });
    }
    window.google.script = { run: runner(null, null) };
  }

  document.addEventListener('click', function (e) {
    if (e.target.closest('.btn-edit-action, .btn-delete-action')) {
      e.stopPropagation();
      if (typeof showToast === 'function') showToast(READONLY_MSG, true);
    }
  }, true);

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
      s.onload = function () { ensureScriptStub(); resolve(); };
      s.onerror = function () { reject(new Error('Google 로그인 스크립트를 불러오지 못했습니다.')); };
      document.head.appendChild(s);
    });
    return gisLoaded;
  }

  function cachedToken() {
    var tk = load(KEY_TOKEN);
    return tk && tk.exp - Date.now() > 60000 ? tk.value : null;
  }

  function requestToken(cfg) {
    return loadGis().then(function () {
      return new Promise(function (resolve, reject) {
        var client = google.accounts.oauth2.initTokenClient({
          client_id: cfg.cid,
          scope: SCOPE,
          callback: function (resp) {
            if (resp.error) { reject(new Error(resp.error_description || resp.error)); return; }
            save(KEY_TOKEN, { value: resp.access_token, exp: Date.now() + (Number(resp.expires_in) || 3600) * 1000 });
            resolve(resp.access_token);
          },
          error_callback: function (err) { reject(new Error((err && err.message) || '로그인이 취소되었습니다.')); }
        });
        client.requestAccessToken({ prompt: '' });
      });
    });
  }

  // ---------- Sheets 읽기 ----------
  function fetchSheets(cfg, token) {
    var params = new URLSearchParams({ valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'SERIAL_NUMBER' });
    SheetsData.RANGES.forEach(function (r) { params.append('ranges', r); });
    var url = 'https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(cfg.sid) + '/values:batchGet?' + params;
    return fetch(url, { headers: { Authorization: 'Bearer ' + token } }).then(function (res) {
      if (res.status === 401) { drop(KEY_TOKEN); throw Object.assign(new Error('로그인이 만료되었습니다.'), { relogin: true }); }
      if (!res.ok) return res.text().then(function (body) { throw new Error('시트 읽기 실패(' + res.status + '): ' + body.slice(0, 200)); });
      return res.json();
    }).then(function (json) {
      var byTab = {};
      (json.valueRanges || []).forEach(function (vr, i) {
        byTab[SheetsData.TABS.concat([SheetsData.REG_TAB])[i]] = vr.values || [];
      });
      return SheetsData.toDashboardData(byTab);
    });
  }

  // ---------- 흐름 ----------
  function render(data) {
    document.getElementById('loading-overlay').style.display = 'none';
    onDataLoaded(data);
  }

  function refresh(cfg, interactive) {
    var token = cachedToken();
    var started = Date.now();
    var getToken = token ? Promise.resolve(token)
      : interactive ? requestToken(cfg)
      : Promise.reject(Object.assign(new Error('로그인이 필요합니다.'), { relogin: true }));
    status('최신 데이터 불러오는 중…');
    return getToken.then(function (tk) {
      t.token = Date.now();
      return fetchSheets(cfg, tk);
    }).then(function (data) {
      t.fetched = Date.now();
      save(KEY_SNAPSHOT, { at: Date.now(), data: data });
      render(data);
      t.fresh = Date.now();
      var msg = '최신 데이터 · 시트 읽기 ' + ((t.fetched - t.token) / 1000).toFixed(1) + '초' +
        (t.cached ? ' · 저장본 표시 ' + ((t.cached - t.nav) / 1000).toFixed(1) + '초' : '') +
        ' · 최신 표시 ' + ((t.fresh - t.nav) / 1000).toFixed(1) + '초';
      console.log('[시험판 계측]', JSON.stringify({ 저장본표시: t.cached ? t.cached - t.nav : null, 토큰: t.token - started,
        시트읽기: t.fetched - t.token, 최신표시: t.fresh - t.nav }));
      status(msg, { label: '로그아웃', onClick: logout });
    }).catch(function (err) {
      var snap = load(KEY_SNAPSHOT);
      var base = snap ? ago(Date.now() - snap.at) + ' 저장본 표시 중 · ' : '';
      if (err.relogin) status(base + '최신 데이터를 보려면 로그인하세요.', { label: 'Google 로그인', onClick: function () { refresh(cfg, true); } });
      else status(base + err.message, { label: '다시 시도', onClick: function () { refresh(cfg, true); } });
      if (!snap) document.getElementById('loading-overlay').style.display = 'none';
    });
  }

  function logout() {
    var tk = load(KEY_TOKEN);
    [KEY_TOKEN, KEY_SNAPSHOT].forEach(drop);
    try { if (tk && window.google && google.accounts) google.accounts.oauth2.revoke(tk.value, function () {}); } catch (e) {}
    location.reload();
  }

  function start() {
    ensureScriptStub();
    var cfg = readConfigFromHash();
    if (!cfg) {
      document.getElementById('loading-overlay').style.display = 'none';
      status('설정이 없습니다. 안내받은 시험판 주소(#cid=…&sid=…)로 한 번 열어 주세요.');
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
    refresh(cfg, false);
  }

  // 이미 열린 페이지에서 시험판 주소(#cid=…)를 다시 연 경우에도 설정을 받는다
  window.addEventListener('hashchange', function () {
    if (/[#&]cid=/.test(location.hash)) { readConfigFromHash(); location.reload(); }
  });

  // Common.html의 loadData를 대체한다 (DOMContentLoaded에서 이 이름으로 호출된다)
  window.loadData = start;
})();
